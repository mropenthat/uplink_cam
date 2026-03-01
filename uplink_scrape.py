"""
Insecam scraper: country/listing page → view page → actual camera stream URL.

Flow:
  1. Go to a listing (e.g. http://www.insecam.org/en/bycountry/US/) and collect
     links to each camera's view page (e.g. http://www.insecam.org/en/view/1010813/).
  2. Visit each view page and extract the real stream URL from that page
     (e.g. http://66.27.116.187:80/mjpg/video.mjpg). That's what we save to cams.json.
  3. Cam id = view page id (e.g. 1010813) so it matches Insecam and thumbnails can use it.

Usage:
  python3 uplink_scrape.py 5                        # overwrite cams.json with 5 pages from byrating
  python3 uplink_scrape.py --add 200                # append up to 200 new cams (no duplicates)
  python3 uplink_scrape.py --country US --limit 6   # test: 6 US cams only (then drop --limit to scan all)
  python3 uplink_scrape.py --country US 10         # overwrite with 10 pages of US cameras
"""
import requests
from bs4 import BeautifulSoup
import json
import time
import random
import re
import os

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/120.0",
]

INSECAM_BASE = "http://www.insecam.org"

# Cyrillic → Latin for transliterating location names (same logic as app.js)
CYRILLIC_TO_LATIN = {
    "\u0410": "A", "\u0411": "B", "\u0412": "V", "\u0413": "G", "\u0414": "D", "\u0415": "E", "\u0416": "Zh", "\u0417": "Z",
    "\u0418": "I", "\u0419": "Y", "\u041a": "K", "\u041b": "L", "\u041c": "M", "\u041d": "N", "\u041e": "O", "\u041f": "P",
    "\u0420": "R", "\u0421": "S", "\u0422": "T", "\u0423": "U", "\u0424": "F", "\u0425": "Kh", "\u0426": "Ts", "\u0427": "Ch",
    "\u0428": "Sh", "\u0429": "Shch", "\u042a": "", "\u042b": "Y", "\u042c": "", "\u042d": "E", "\u042e": "Yu", "\u042f": "Ya",
    "\u0430": "a", "\u0431": "b", "\u0432": "v", "\u0433": "g", "\u0434": "d", "\u0435": "e", "\u0436": "zh", "\u0437": "z",
    "\u0438": "i", "\u0439": "y", "\u043a": "k", "\u043b": "l", "\u043c": "m", "\u043d": "n", "\u043e": "o", "\u043f": "p",
    "\u0440": "r", "\u0441": "s", "\u0442": "t", "\u0443": "u", "\u0444": "f", "\u0445": "kh", "\u0446": "ts", "\u0447": "ch",
    "\u0448": "sh", "\u0449": "shch", "\u044a": "", "\u044b": "y", "\u044c": "", "\u044d": "e", "\u044e": "yu", "\u044f": "ya",
    "\u0451": "e", "\u0401": "E",
}
# Common city names Insecam shows in Cyrillic → English
CYRILLIC_CITY_TO_ENGLISH = {
    "Лас-Вегас": "Las Vegas", "Лас Вегас": "Las Vegas", "Бока-Ратон": "Boca Raton", "Бока Ратон": "Boca Raton",
    "Олбани": "Albany", "Монтерей": "Monterey", "Эвансвилл": "Evansville", "Нью Йорк": "New York", "Нью-Йорк": "New York",
    "Сан-Франциско": "San Francisco", "Сан Франциско": "San Francisco",
    "Хальмстад": "Halmstad", "Таллинн": "Tallinn", "Таллин": "Tallinn", "Яссы": "Iași", "Роттердам": "Rotterdam",
    "Кишинёв": "Chișinău", "Кишинев": "Chisinau", "Тайбэй": "Taipei", "Сеул": "Seoul", "Асахи": "Asahi",
    "Дублин": "Dublin", "Кранфилд": "Cranfield", "Перманент": "Perm", "Глазов": "Glazov", "Неаполь": "Naples",
    "Мостар": "Mostar", "Нова Одеса": "Nova Odesa", "Долгосрочный Обзор": "Long View", "Салинас": "Salinas",
    "Париж": "Paris", "Вена": "Vienna", "Берлин": "Berlin", "Мадрид": "Madrid", "Рим": "Rome",
}


def _transliterate_cyrillic(s):
    if not s or not re.search(r"[\u0400-\u04FF]", s):
        return s
    return "".join(CYRILLIC_TO_LATIN.get(c, c) for c in s)


def normalize_location(raw):
    """
    Convert Insecam's location string to clean "City, Country" (or "City, Region, Country").
    Strips "Click here to enter...", extracts place and country, converts Cyrillic to English/Latin.
    """
    if not raw or not raw.strip():
        return "Unknown"
    s = raw.strip()
    # "Click here to enter the camera located in United States, region California, San Diego"
    m = re.search(r"located\s+in\s+([^,]+),\s*region\s+[^,]+,\s*(.+)$", s, re.I)
    if m:
        country, place = m.group(1).strip(), m.group(2).strip()
        result = f"{place}, {country}"
    else:
        # "Country, region Region, City" (e.g. already partially normalized or from listing)
        m2 = re.match(r"^([^,]+),\s*region\s+[^,]+,\s*(.+)$", s, re.I)
        if m2:
            country, place = m2.group(1).strip(), m2.group(2).strip()
            result = f"{place}, {country}"
        else:
            # "Live camera Axis in San Diego, United States" or similar
            in_m = re.search(r"\s+in\s+(.+)$", s, re.I)
            result = in_m.group(1).strip() if in_m else s
    # Replace known Cyrillic city names with English (before transliterating the rest)
    for cyr, eng in CYRILLIC_CITY_TO_ENGLISH.items():
        if cyr in result:
            result = result.replace(cyr, eng)
    # Transliterate any remaining Cyrillic to Latin
    result = _transliterate_cyrillic(result)
    return result.strip() or "Unknown"


def _headers():
    return {"User-Agent": random.choice(USER_AGENTS)}


def _listing_page_url(base_url, page):
    """Build listing URL with page param."""
    base_url = base_url.rstrip("/")
    sep = "&" if "?" in base_url else "?"
    return f"{base_url}{sep}page={page}"


def get_view_links_from_listing(base_url, page):
    """
    Fetch one listing page (e.g. bycountry/US/?page=1). Return list of:
    {view_url, view_id, location, listing_img_src}.
    listing_img_src = img src from listing (fallback if view page doesn't yield stream).
    """
    url = _listing_page_url(base_url, page)
    try:
        r = requests.get(url, headers=_headers(), timeout=15)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"[ERROR] Listing page failed: {e}")
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    items = soup.find_all("div", class_="thumbnail-item")
    out = []
    for item in items:
        a = item.find("a", href=True)
        img = item.find("img")
        if not a:
            continue
        href = a.get("href", "").strip()
        m = re.search(r"/view/(\d+)/?", href)
        if not m:
            continue
        view_id = int(m.group(1))
        view_url = href if href.startswith("http") else (INSECAM_BASE + href)
        location = (img.get("title") if img else None) or "Unknown"
        listing_img_src = (img.get("src") or "").strip() if img else None
        out.append({
            "view_url": view_url,
            "view_id": view_id,
            "location": location,
            "listing_img_src": listing_img_src,
        })
    return out


def get_stream_url_from_view_page(view_url):
    """
    Fetch camera view page (e.g. .../en/view/1010813/) and extract the actual
    stream URL. Look for img#image0 or img.detailimage with src to non-Insecam host.
    Returns (stream_url, location) or (None, None).
    """
    try:
        r = requests.get(view_url, headers=_headers(), timeout=15)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"[ERROR] View page failed: {e}")
        return None, None

    soup = BeautifulSoup(r.text, "html.parser")
    stream_url = None
    location = None

    # Prefer img#image0 or img with class containing detailimage (actual stream on view page)
    for img in soup.find_all("img", src=True):
        src = (img.get("src") or "").strip()
        if not src or "insecam" in src.lower():
            continue
        if src.startswith("http://") or src.startswith("https://"):
            stream_url = src
            location = (img.get("title") or "").strip() or None
            break

    if not stream_url:
        # Fallback: any external link that looks like a camera (view.shtml, mjpg, etc.)
        for a in soup.find_all("a", href=True):
            h = a.get("href", "").strip()
            if "insecam" in h.lower():
                continue
            if ("view.shtml" in h or "mjpg" in h or "video" in h) and (h.startswith("http://") or h.startswith("https://")):
                stream_url = h
                break

    return stream_url, location


def scrape_page_via_view_pages(base_url, page, existing_ids, existing_urls):
    """
    Scrape one listing page: get view links, then visit each view page and
    extract stream URL. Return list of new cam dicts (id = view id, url = stream from view page).
    """
    view_links = get_view_links_from_listing(base_url, page)
    new_list = []
    for v in view_links:
        view_id = v["view_id"]
        view_url = v["view_url"]
        location = v["location"]
        listing_fallback = v.get("listing_img_src")

        if view_id in existing_ids:
            continue

        stream_url, view_location = get_stream_url_from_view_page(view_url)
        if not stream_url and listing_fallback and listing_fallback not in existing_urls:
            stream_url = listing_fallback
        if not stream_url:
            print(f"[SKIP] No stream URL for view {view_id}")
            continue
        stream_url = stream_url.strip()
        if stream_url in existing_urls:
            continue

        clean_loc = normalize_location(view_location or location)
        entry = {
            "id": view_id,
            "url": stream_url,
            "location": clean_loc,
            "status": "ACTIVE",
            "last_seen": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        new_list.append(entry)
        existing_ids.add(view_id)
        existing_urls.add(stream_url)
        loc_short = clean_loc[:60]
        print(f"  [NEW] id={view_id} | {stream_url[:50]}... | {loc_short}")
        time.sleep(random.uniform(1, 2.5))

    return new_list


def scrape_signals(max_pages=10, base_url=None, limit=None):
    """Overwrite cams.json with cams from listing → view page flow. Uses byrating by default.
    If limit is set (e.g. 6), stop after that many cameras to test."""
    if base_url is None:
        base_url = "http://www.insecam.org/en/byrating/"
    existing_ids = set()
    existing_urls = set()
    all_cams = []

    for page in range(1, max_pages + 1):
        if limit is not None and len(all_cams) >= limit:
            break
        print(f"[SYSTEM] Scanning listing page {page}...")
        try:
            batch = scrape_page_via_view_pages(base_url, page, existing_ids, existing_urls)
            for c in batch:
                all_cams.append(c)
                if limit is not None and len(all_cams) >= limit:
                    break
            print(f"[SYSTEM]   Got {len(batch)} cameras from view pages (total so far: {len(all_cams)})")
            if limit is not None and len(all_cams) >= limit:
                break
            time.sleep(random.uniform(2, 4))
        except requests.RequestException as e:
            print(f"[ERROR] {e}")

    if limit is not None:
        all_cams = all_cams[:limit]
    cams_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cams.json")
    with open(cams_path, "w", encoding="utf-8") as f:
        json.dump(all_cams, f, indent=4, ensure_ascii=False)
    print(f"[SUCCESS] {len(all_cams)} camera node(s) written to cams.json (only these will show on the site).")
    return all_cams


def scrape_and_merge(add_count=200, max_pages=30):
    """Append new cams (no duplicates). Uses listing → view page for each source."""
    base_urls = [
        "http://www.insecam.org/en/bynew/",
        "http://www.insecam.org/en/byrating/",
        "http://www.insecam.org/en/bycountry/US/",
        "http://www.insecam.org/en/bycountry/JP/",
        "http://www.insecam.org/en/bycountry/GB/",
        "http://www.insecam.org/en/bycountry/DE/",
        "http://www.insecam.org/en/bycountry/BR/",
    ]
    existing = []
    existing_ids = set()
    existing_urls = set()
    cams_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cams.json")

    if os.path.isfile(cams_path):
        with open(cams_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        for c in existing:
            existing_ids.add(c.get("id"))
            u = (c.get("url") or "").strip()
            if u:
                existing_urls.add(u)
        print(f"[SYSTEM] Loaded {len(existing)} existing nodes. Targeting {add_count} new (no duplicates).")
    else:
        print(f"[SYSTEM] No existing cams.json. Will create new list.")

    new_signals = []
    for base_url in base_urls:
        if len(new_signals) >= add_count:
            break
        label = "bynew" if "bynew" in base_url else ("byrating" if "byrating" in base_url else base_url.rstrip("/").split("/")[-1] or "listing")
        print(f"[SYSTEM] Scanning source: {label}...")
        page = 1
        while len(new_signals) < add_count and page <= max_pages:
            print(f"[SYSTEM]   Page {page}...")
            try:
                batch = scrape_page_via_view_pages(base_url, page, existing_ids, existing_urls)
                new_signals.extend(batch)
                time.sleep(random.uniform(2, 4))
            except requests.RequestException as e:
                print(f"[ERROR] {e}")
            page += 1

    merged = existing + new_signals
    with open(cams_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=4, ensure_ascii=False)
    print(f"[SUCCESS] Added {len(new_signals)} new nodes (no duplicates). Total: {len(merged)}.")
    return merged


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    limit = None
    if "--limit" in args:
        i = args.index("--limit")
        if i + 1 < len(args):
            limit = int(args[i + 1])
        args = args[:i] + args[i + 2:]
    if args and args[0] == "--add":
        add_n = int(args[1]) if len(args) > 1 else 200
        scrape_and_merge(add_count=add_n)
    elif args and args[0] == "--country":
        country = (args[1] or "US").upper()
        pages = int(args[2]) if len(args) > 2 else 10
        base = f"http://www.insecam.org/en/bycountry/{country}/"
        scrape_signals(max_pages=pages, base_url=base, limit=limit)
    else:
        pages = int(args[0]) if args else 5
        scrape_signals(max_pages=pages, limit=limit)

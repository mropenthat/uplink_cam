import requests
from bs4 import BeautifulSoup
import json
import time
import random
import hashlib
import os

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/120.0",
]


def make_cam_id(stream_url):
    return int(hashlib.md5(stream_url.encode()).hexdigest()[:8], 16)


def scrape_signals(max_pages=10):
    base_url = "http://www.insecam.org/en/byrating/"
    signals = []

    for page in range(1, max_pages + 1):
        print(f"[SYSTEM] Scanning Frequency: Page {page}...")
        headers = {"User-Agent": random.choice(USER_AGENTS)}

        try:
            response = requests.get(
                f"{base_url}?page={page}", headers=headers, timeout=10
            )
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")

            cam_containers = soup.find_all("div", class_="thumbnail-item")

            for item in cam_containers:
                img_tag = item.find("img")
                if img_tag:
                    stream_url = img_tag.get("src")
                    if not stream_url:
                        continue
                    location = img_tag.get("title", "Unknown Coordinates")
                    cam_id = make_cam_id(stream_url)

                    signals.append({
                        "id": cam_id,
                        "url": stream_url,
                        "location": location,
                        "status": "ACTIVE",
                        "last_seen": time.strftime("%Y-%m-%d %H:%M:%S"),
                    })

            time.sleep(random.uniform(2, 4))

        except requests.RequestException as e:
            print(f"[ERROR] Signal Interrupted: {e}")

    with open("cams.json", "w") as f:
        json.dump(signals, f, indent=4)
    print(f"[SUCCESS] {len(signals)} camera nodes added to database.")
    return signals


def scrape_page_for_signals(base_url, page, existing_ids, existing_urls):
    """Scrape one page; return list of new cam dicts (not in existing_*)."""
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    url = base_url.rstrip("/") + ("&" if "?" in base_url else "?") + f"page={page}"
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    cam_containers = soup.find_all("div", class_="thumbnail-item")
    new_list = []
    for item in cam_containers:
        img_tag = item.find("img")
        if not img_tag:
            continue
        stream_url = img_tag.get("src")
        if not stream_url:
            continue
        stream_url = stream_url.strip()
        if stream_url in existing_urls:
            continue
        cam_id = make_cam_id(stream_url)
        if cam_id in existing_ids:
            continue
        location = img_tag.get("title", "Unknown Coordinates")
        new_list.append({
            "id": cam_id,
            "url": stream_url,
            "location": location,
            "status": "ACTIVE",
            "last_seen": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        existing_ids.add(cam_id)
        existing_urls.add(stream_url)
    return new_list


def scrape_and_merge(add_count=200, max_pages=30):
    """Load existing cams.json, scrape new feeds until we have add_count new (no duplicates), then merge and save."""
    # Multiple sources to maximize new (non-duplicate) feeds: bynew, byrating, then bycountry
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
        with open(cams_path, "r") as f:
            existing = json.load(f)
        for c in existing:
            existing_ids.add(c.get("id"))
            u = c.get("url", "").strip()
            if u:
                existing_urls.add(u)
        print(f"[SYSTEM] Loaded {len(existing)} existing nodes. Targeting {add_count} new (no duplicates).")
    else:
        print(f"[SYSTEM] No existing cams.json. Will create new list.")

    new_signals = []
    for base_url in base_urls:
        if len(new_signals) >= add_count:
            break
        if "bynew" in base_url:
            label = "bynew"
        elif "bycountry" in base_url:
            label = base_url.rstrip("/").split("/")[-1] or "bycountry"
        else:
            label = "byrating"
        print(f"[SYSTEM] Scanning source: {label}...")
        page = 1
        while len(new_signals) < add_count and page <= max_pages:
            print(f"[SYSTEM]   Page {page}...")
            try:
                batch = scrape_page_for_signals(base_url, page, existing_ids, existing_urls)
                new_signals.extend(batch)
                time.sleep(random.uniform(2, 4))
            except requests.RequestException as e:
                print(f"[ERROR] Signal Interrupted: {e}")
            page += 1

    merged = existing + new_signals
    with open(cams_path, "w") as f:
        json.dump(merged, f, indent=4)
    print(f"[SUCCESS] Added {len(new_signals)} new nodes (no duplicates). Total: {len(merged)}.")
    return merged


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--add":
        add_n = int(sys.argv[2]) if len(sys.argv) > 2 else 200
        scrape_and_merge(add_count=add_n)
    else:
        pages = int(sys.argv[1]) if len(sys.argv) > 1 else 5
        scrape_signals(pages)

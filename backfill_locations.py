"""
Backfill camera locations in cams.json using ipinfo.io for each cam that has an IP in its URL.
Corrects wrong or misspelled scraper locations (e.g. Filadelfiya → Philadelphia).

Usage:
  python3 backfill_locations.py              # update all cams with IPs, write cams.json
  python3 backfill_locations.py --dry-run   # only print what would change
  python3 backfill_locations.py --delay 1.2 # seconds between ipinfo requests (default 1.0)
"""
import json
import os
import re
import sys
import urllib.request
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAMS_PATH = os.path.join(SCRIPT_DIR, "cams.json")
IPINFO_URL = "https://ipinfo.io/{ip}/json"
USER_AGENT = "Mozilla/5.0 (compatible; UPLINK_SITE/1.0)"
TIMEOUT = 10


def extract_ip(url):
    """Extract first IPv4 address from URL string, or None."""
    if not url or not isinstance(url, str):
        return None
    m = re.search(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b", url)
    return m.group(1) if m else None


def fetch_ipinfo(ip):
    """Return dict with city, region, country (and optionally loc, org, etc.) or None on failure."""
    url = IPINFO_URL.format(ip=ip)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("error"):
                return None
            return data
    except Exception as e:
        print("  ipinfo error for {}: {}".format(ip, e), file=sys.stderr)
        return None


def location_from_ipinfo(data):
    """Build 'City, Region, Country' or 'City, Country' from ipinfo response."""
    if not data:
        return None
    parts = [data.get("city"), data.get("region"), data.get("country")]
    parts = [p for p in parts if p and str(p).strip()]
    if not parts:
        return None
    return ", ".join(parts)


def main():
    dry_run = "--dry-run" in sys.argv
    delay = 1.0
    for i, arg in enumerate(sys.argv[1:]):
        if arg == "--delay" and i + 2 < len(sys.argv):
            delay = float(sys.argv[i + 2])
            break

    if not os.path.isfile(CAMS_PATH):
        print("cams.json not found.", file=sys.stderr)
        sys.exit(1)

    with open(CAMS_PATH, "r", encoding="utf-8") as f:
        cams = json.load(f)

    if not isinstance(cams, list):
        print("cams.json is not a list.", file=sys.stderr)
        sys.exit(1)

    ip_to_location = {}  # cache: fetch each IP only once
    updated = 0
    skipped_no_ip = 0
    skipped_same = 0
    failed = 0

    for i, cam in enumerate(cams):
        if not isinstance(cam, dict):
            continue
        url = cam.get("url") or cam.get("embed_url") or ""
        ip = extract_ip(url)
        if not ip:
            skipped_no_ip += 1
            continue

        if ip in ip_to_location:
            new_loc = ip_to_location[ip]
        else:
            time.sleep(delay)
            data = fetch_ipinfo(ip)
            new_loc = location_from_ipinfo(data)
            if not new_loc:
                failed += 1
                continue
            ip_to_location[ip] = new_loc

        old_loc = (cam.get("location") or "").strip()
        if old_loc == new_loc:
            skipped_same += 1
            continue

        cam_id = cam.get("id", "?")
        print("  [{}] {}  →  {}".format(cam_id, old_loc or "(empty)", new_loc))
        cam["location"] = new_loc
        updated += 1

    if dry_run:
        print("(dry-run: no file written)")
    else:
        with open(CAMS_PATH, "w", encoding="utf-8") as f:
            json.dump(cams, f, indent=4, ensure_ascii=False)
        print("Wrote {}.".format(CAMS_PATH))

    print("Updated: {}, same: {}, no IP: {}, failed: {}.".format(
        updated, skipped_same, skipped_no_ip, failed))


if __name__ == "__main__":
    main()

"""
UPLINK_SITE thumbnail cache: grab one frame per camera and save to thumbnails/.
Run periodically (e.g. cron every 6h) so the Node Matrix shows static snippets.
Usage: python3 thumbnail_scraper.py [--limit 500] [--delay 0.5]
"""
import json
import os
import sys
import time
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
THUMBNAILS_DIR = os.path.join(SCRIPT_DIR, "thumbnails")
MAX_READ = 200 * 1024  # 200KB enough for one frame
TIMEOUT = 8
USER_AGENT = "Mozilla/5.0 (compatible; UPLINK_SITE/1.0)"


def normalize_url(url):
    if not url:
        return ""
    return url.replace("&amp;", "&")


def extract_one_image(body):
    """Return (content_type, bytes) for one JPEG or PNG, or (None, None)."""
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return ("image/png", body[:MAX_READ])
    soi = body.find(b"\xff\xd8")
    eoi = body.find(b"\xff\xd9", soi) if soi >= 0 else -1
    if soi >= 0 and eoi > soi:
        return ("image/jpeg", body[soi : eoi + 2])
    return (None, None)


def capture_snippet(cam_url, cam_id):
    """Fetch one frame from cam_url and save to thumbnails/{cam_id}.jpg (or .png)."""
    url = normalize_url(cam_url)
    if not url.startswith(("http://", "https://")):
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read(MAX_READ)
    except Exception as e:
        print(f"FAILED: Node_{cam_id} unreachable ({e})")
        return False
    ct, data = extract_one_image(body)
    if not ct or not data:
        print(f"FAILED: Node_{cam_id} no image frame")
        return False
    ext = "png" if ct == "image/png" else "jpg"
    path = os.path.join(THUMBNAILS_DIR, f"{cam_id}.{ext}")
    with open(path, "wb") as f:
        f.write(data)
    print(f"SUCCESS: Node_{cam_id} snippet captured.")
    return True


def main():
    os.chdir(SCRIPT_DIR)
    limit = 500
    delay = 0.3
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
        elif arg == "--delay" and i + 1 < len(args):
            delay = float(args[i + 1])

    if not os.path.exists("cams.json"):
        print("cams.json not found. Run from UPLINK_SITE directory.")
        sys.exit(1)
    os.makedirs(THUMBNAILS_DIR, exist_ok=True)

    with open("cams.json", "r", encoding="utf-8") as f:
        cams = json.load(f)
    if not cams:
        print("No cams in cams.json.")
        sys.exit(0)

    # Prefer snapshot-style URLs so we get more successes
    def score(u):
        if not u:
            return 0
        u = u.lower()
        if "snapshotjpeg" in u or "snapshot.cgi" in u or "image.jpg" in u:
            return 3
        if "video.jpg" in u or "nph-jpeg" in u or "/jpg/" in u:
            return 2
        return 1
    cams = sorted(cams, key=lambda c: (-score(c.get("url")), c.get("id", 0)))
    to_fetch = cams[:limit]
    print(f"Capturing snippets for {len(to_fetch)} nodes (limit={limit})...")
    ok = 0
    saved_ids = []
    for c in to_fetch:
        cam_id = c.get("id")
        url = c.get("url")
        if capture_snippet(url, cam_id):
            ok += 1
            saved_ids.append(str(cam_id))
        time.sleep(delay)
    list_path = os.path.join(THUMBNAILS_DIR, "list.json")
    with open(list_path, "w", encoding="utf-8") as f:
        json.dump(saved_ids, f)
    print(f"Done: {ok}/{len(to_fetch)} thumbnails saved to {THUMBNAILS_DIR}/ (list.json updated)")


if __name__ == "__main__":
    main()

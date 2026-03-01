#!/usr/bin/env python3
"""
Check which camera streams in cams.json return "no signal" (timeout, connection error, or invalid response).
Run from UPLINK_SITE directory: python3 check_streams.py

Usage:
  python3 check_streams.py              # check all, print report
  python3 check_streams.py --no-signal   # print only cam IDs with no signal (easy to copy)
  python3 check_streams.py --remove     # check all, then remove no-signal cams from cams.json
  python3 check_streams.py --timeout 5   # use 5 second timeout (default 8)
"""
import json
import os
import re
import sys
import urllib.request
from urllib.parse import urlparse, urlunparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAMS_JSON = os.path.join(SCRIPT_DIR, "cams.json")
DEFAULT_TIMEOUT = 8
USER_AGENT = "Mozilla/5.0 (compatible; UPLINK_SITE stream check)"


def get_live_stream_url(stored_url):
    """
    Return the URL the live viewer actually uses (mirrors app.js getLiveStreamUrl).
    For snapshot-only URLs the app rewrites to an MJPEG stream path; we must check that URL.
    """
    if not stored_url or not stored_url.strip():
        return stored_url
    url = stored_url.strip()
    u = url.lower()
    # Snapshot-only patterns that get rewritten for live view
    if "jpgmulreq" in u or "getoneshot" in u or "onvif/snapshot" in u:
        return url  # pass through
    if "snapshotjpeg" in u:
        parsed = urlparse(url)
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return origin + "/nphMotionJpeg?Resolution=640x480&Quality=Standard"
    if "image.jpg" in u or "image.jpeg" in u:
        parsed = urlparse(url)
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return origin + "/mjpg/video.mjpg"
    if "video.jpg" in u or "video.jpeg" in u:
        parsed = urlparse(url)
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        pathname = (parsed.path or "/").rstrip("/") or "/"
        new_path = re.sub(r"/video\.(jpg|jpeg)$", "/mjpg/video.mjpg", pathname, flags=re.I)
        return origin + new_path
    if "webcapture" in u and "command=snap" in u:
        parsed = urlparse(url)
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return origin + (parsed.path or "/")
    if "snapshot.cgi" in u or "nph-jpeg" in u:
        parsed = urlparse(url)
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return origin + "/nphMotionJpeg?Resolution=640x480&Quality=Standard"
    if "/jpg/" in u or "/jpeg/" in u:
        parsed = urlparse(url)
        origin = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
        return origin + "/mjpg/video.mjpg"
    return url


def check_url(url, timeout=DEFAULT_TIMEOUT):
    """Try to fetch URL; return (ok, message)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.getcode()
            body = resp.read(65536)  # first 64KB enough to see JPEG or stream start
        if code != 200:
            return False, "HTTP %s" % code
        if not body or len(body) < 2:
            return False, "empty body"
        # Accept JPEG start, PNG start, or multipart MJPEG (starts with boundary or --)
        if body[:2] == b"\xff\xd8" or body[:8] == b"\x89PNG\r\n\x1a\n":
            return True, "OK"
        if body[:2] == b"--" or "multipart" in (resp.headers.get("Content-Type") or "").lower():
            return True, "OK (stream)"
        if b"\xff\xd8" in body[:4096]:  # JPEG somewhere in first 4K
            return True, "OK"
        return False, "not JPEG/PNG/stream (starts with %r)" % body[:40]
    except urllib.error.HTTPError as e:
        return False, "HTTP %s" % e.code
    except urllib.error.URLError as e:
        return False, str(e.reason) if getattr(e, "reason", None) else str(e)
    except OSError as e:
        return False, str(e)
    except Exception as e:
        return False, str(e)


def main():
    timeout = DEFAULT_TIMEOUT
    only_no_signal = False
    do_remove = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--no-signal":
            only_no_signal = True
        elif args[i] == "--remove":
            do_remove = True
        elif args[i] == "--timeout" and i + 1 < len(args):
            timeout = int(args[i + 1])
            i += 1
        i += 1

    try:
        with open(CAMS_JSON, "r", encoding="utf-8") as f:
            cams = json.load(f)
    except Exception as e:
        print("Error loading %s: %s" % (CAMS_JSON, e), file=sys.stderr)
        sys.exit(1)

    no_signal = []
    no_signal_ids = set()
    ok_count = 0
    total = len(cams)

    for i, cam in enumerate(cams):
        cam_id = cam.get("id", "?")
        url = cam.get("url", "").strip()
        if not url or not url.startswith(("http://", "https://")):
            no_signal.append((cam_id, url, "invalid URL"))
            no_signal_ids.add(cam_id)
            continue
        # Check the URL the live viewer actually uses (may differ from stored URL for snapshot cams)
        live_url = get_live_stream_url(url)
        check_url_used = live_url if live_url != url else url
        ok, msg = check_url(check_url_used, timeout=timeout)
        if ok:
            ok_count += 1
            if not only_no_signal:
                print("[OK] id=%s" % cam_id)
        else:
            no_signal.append((cam_id, check_url_used, msg))
            no_signal_ids.add(cam_id)
            if not only_no_signal:
                print("[NO SIGNAL] id=%s %s" % (cam_id, msg))
            else:
                print(cam_id)

    if only_no_signal:
        return

    print()
    print("--- Summary ---")
    print("Total: %d  OK: %d  No signal: %d" % (total, ok_count, len(no_signal)))
    if no_signal:
        print()
        print("No signal (id, url, reason):")
        for cam_id, url, msg in no_signal:
            short = url if len(url) <= 70 else url[:67] + "..."
            print("  %s  %s  (%s)" % (cam_id, short, msg))

    if do_remove and no_signal_ids:
        kept = [c for c in cams if c.get("id") not in no_signal_ids]
        try:
            with open(CAMS_JSON, "w", encoding="utf-8") as f:
                json.dump(kept, f, indent=4, ensure_ascii=False)
            print()
            print("Removed %d no-signal cams from cams.json. Remaining: %d." % (len(no_signal_ids), len(kept)))
        except Exception as e:
            print("Error writing %s: %s" % (CAMS_JSON, e), file=sys.stderr)
            sys.exit(1)
    elif do_remove and not no_signal_ids:
        print()
        print("No cams to remove (all had signal).")


if __name__ == "__main__":
    main()

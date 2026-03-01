"""
UPLINK_SITE server: serves static files and /snapshot-proxy for SNAPSHOT capture.
Run: python3 server.py
Then open http://localhost:8080
"""
import http.server
import json
import urllib.request
import urllib.parse
import socketserver
import os
import re
import time as _t

PORT = int(os.environ.get("PORT", "8081"))
# One-frame timeout: avoid long-lived streams so Railway doesn't overload (concurrent connection limit).
FEED_PROXY_TIMEOUT = 8
FEED_PROXY_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Per-cam visit counts: cam_id -> total visits. Persisted to cam_visits.json.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAM_VISITS_PATH = os.path.join(SCRIPT_DIR, "cam_visits.json")
CAM_VISITS = {}

# Per-cam thumbs: cam_id -> {"up": N, "down": M}. Persisted to cam_thumbs.json.
CAM_THUMBS_PATH = os.path.join(SCRIPT_DIR, "cam_thumbs.json")
CAM_THUMBS = {}


def load_cam_visits():
    global CAM_VISITS
    try:
        with open(CAM_VISITS_PATH, "r", encoding="utf-8") as f:
            CAM_VISITS = json.load(f)
        if not isinstance(CAM_VISITS, dict):
            CAM_VISITS = {}
    except (FileNotFoundError, json.JSONDecodeError):
        CAM_VISITS = {}


def save_cam_visits():
    try:
        with open(CAM_VISITS_PATH, "w", encoding="utf-8") as f:
            json.dump(CAM_VISITS, f)
    except (OSError, IOError):
        pass


def load_cam_thumbs():
    global CAM_THUMBS
    try:
        with open(CAM_THUMBS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            CAM_THUMBS = {}
        else:
            # Normalize keys to string so lookup always matches (e.g. "123" not 123)
            CAM_THUMBS = {}
            for k, v in data.items():
                if isinstance(v, dict) and "up" in v and "down" in v:
                    CAM_THUMBS[str(k).strip()] = {
                        "up": int(v.get("up", 0)),
                        "down": int(v.get("down", 0)),
                    }
    except (FileNotFoundError, json.JSONDecodeError):
        CAM_THUMBS = {}


def save_cam_thumbs():
    try:
        with open(CAM_THUMBS_PATH, "w", encoding="utf-8") as f:
            json.dump(CAM_THUMBS, f, indent=0)
    except (OSError, IOError) as e:
        print("[cam_thumbs] save failed: %s" % e)


def is_safe_cam_id(cam_id):
    if not cam_id or not isinstance(cam_id, str):
        return False
    return bool(re.match(r"^\d{1,20}$", cam_id))


def is_safe_ip(ip):
    if not ip or not isinstance(ip, str):
        return False
    return bool(re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", ip))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Prevent normal window from serving old cached site (no private vs normal difference)
        path = self.path.split("?")[0]
        path_lower = path.lower()
        if path_lower in ("/", "/index.html") or path_lower.endswith(".html") or path_lower.endswith(".js") or path_lower.endswith(".css"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
        # Thumbnails and cams.json are saved data; allow browser cache.
        if path.startswith("/thumbnails/") and ".." not in path:
            self.send_header("Cache-Control", "public, max-age=86400")
        if path_lower == "/cams.json":
            self.send_header("Cache-Control", "public, max-age=300")
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = (parsed.path or "/").rstrip("/") or "/"

        if path == "/ipinfo" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            ip = (params.get("ip") or [""])[0].strip()
            if not is_safe_ip(ip):
                self.send_error(400, "Invalid ip")
                return
            try:
                req = urllib.request.Request(
                    "https://ipinfo.io/" + ip + "/json",
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "Mozilla/5.0 (compatible; UPLINK_SITE/1.0)",
                    },
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    body = resp.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, OSError):
                    pass
            except (BrokenPipeError, OSError):
                pass
            except Exception as e:
                try:
                    self.send_error(502, "IP info error: " + str(e))
                except (BrokenPipeError, OSError):
                    pass
            return

        if path == "/feed-proxy" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            url = params.get("url", [None])[0]
            if url and url.startswith(("http://", "https://")):
                try:
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": FEED_PROXY_USER_AGENT},
                    )
                    # One frame only + short timeout: avoid long-lived MJPEG streams so Railway doesn't overload.
                    with urllib.request.urlopen(req, timeout=FEED_PROXY_TIMEOUT) as resp:
                        body = resp.read(512 * 1024)
                        if body[:8] == b"\x89PNG\r\n\x1a\n":
                            self.send_response(200)
                            self.send_header("Content-Type", "image/png")
                            self.send_header("Cache-Control", "no-cache")
                            self.send_header("Content-Length", str(len(body)))
                            self.end_headers()
                            try:
                                self.wfile.write(body)
                            except (BrokenPipeError, OSError):
                                pass
                        else:
                            soi = body.find(b"\xff\xd8")
                            eoi = body.find(b"\xff\xd9", soi) if soi >= 0 else -1
                            if soi >= 0 and eoi > soi:
                                body = body[soi : eoi + 2]
                                self.send_response(200)
                                self.send_header("Content-Type", "image/jpeg")
                                self.send_header("Cache-Control", "no-cache")
                                self.send_header("Content-Length", str(len(body)))
                                self.end_headers()
                                try:
                                    self.wfile.write(body)
                                except (BrokenPipeError, OSError):
                                    pass
                            else:
                                try:
                                    self.send_error(502, "No JPEG frame")
                                except (BrokenPipeError, OSError):
                                    pass
                except (BrokenPipeError, OSError):
                    pass
                except Exception as e:
                    try:
                        self.send_error(504, "Proxy error: " + str(e))
                    except (BrokenPipeError, OSError):
                        pass
                return
            self.send_error(400, "Missing or invalid url")
            return

        # Stream proxy: forward live MJPEG (or other) stream for styled live-viewer page (no mixed content on HTTPS).
        # For snapshot-only URLs (jpgmulreq, GetOneShot, onvif/snapshot), poll the snapshot and serve as MJPEG stream.
        if path == "/stream-proxy" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            url = params.get("url", [None])[0]
            if url and url.startswith(("http://", "https://")):
                print("[stream-proxy] fetching: %s" % (url[:80] + "..." if len(url) > 80 else url))
                url_lower = url.lower()
                is_snapshot_only = (
                    "jpgmulreq" in url_lower
                    or "getoneshot" in url_lower
                    or "onvif/snapshot" in url_lower
                    or "cgi-bin/camera" in url_lower
                    or "out.jpg" in url_lower
                    or "webcapture.jpg" in url_lower
                )
                try:
                    if is_snapshot_only:
                        # Poll snapshot URL and emit as multipart MJPEG so the browser sees a live stream
                        print("[stream-proxy] snapshot-only mode (polling): %s" % (url[:80] + "..." if len(url) > 80 else url))
                        self.send_response(200)
                        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                        self.send_header("Cache-Control", "no-cache")
                        self.send_header("Connection", "close")
                        self.end_headers()
                        boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                        frame_count = 0
                        while True:
                            try:
                                # Cache-bust so camera returns a fresh frame. Some cameras reject extra params (webcapture.jpg, cgi-bin/camera).
                                if "cgi-bin/camera" in url_lower:
                                    sep = "&" if "?" in url else "?"
                                    poll_url = url + sep + "COUNTER=" + str(int(_t.time() * 1000))
                                elif "webcapture.jpg" in url_lower:
                                    poll_url = url  # use as-is; some reject _t=
                                else:
                                    sep = "&" if "?" in url else "?"
                                    poll_url = url + sep + "_t=" + str(int(_t.time() * 1000))
                                headers = {"User-Agent": FEED_PROXY_USER_AGENT}
                                # Some cameras require Referer from their own origin
                                try:
                                    base = urllib.parse.urlparse(poll_url)
                                    if base.scheme and base.netloc:
                                        headers["Referer"] = base.scheme + "://" + base.netloc + "/"
                                except Exception:
                                    pass
                                req = urllib.request.Request(poll_url, headers=headers)
                                with urllib.request.urlopen(req, timeout=15) as resp:
                                    body = resp.read(2 * 1024 * 1024)
                                # Accept raw JPEG/PNG, or extract JPEG from body (some CGIs send extra bytes)
                                out = None
                                if body and (body[:2] == b"\xff\xd8" or body[:8] == b"\x89PNG\r\n\x1a\n"):
                                    out = body
                                elif body and b"\xff\xd8" in body:
                                    soi = body.find(b"\xff\xd8")
                                    eoi = body.find(b"\xff\xd9", soi)
                                    if eoi >= 0:
                                        out = body[soi : eoi + 2]
                                if out:
                                    try:
                                        self.wfile.write(boundary)
                                        self.wfile.write(out)
                                        self.wfile.write(b"\r\n")
                                        self.wfile.flush()
                                        frame_count += 1
                                        if frame_count == 1:
                                            print("[stream-proxy] snapshot-only: first frame sent")
                                    except (BrokenPipeError, OSError):
                                        break
                                elif body and len(body) > 0:
                                    print("[stream-proxy] snapshot-only: got %d bytes but not a valid JPEG/PNG (starts with %r)" % (len(body), body[:50]))
                                # else: no valid frame this round; retry after sleep
                            except (BrokenPipeError, OSError):
                                break
                            except Exception as e:
                                print("[stream-proxy] snapshot poll error (retrying): %s" % e)
                                # Retry instead of breaking so transient errors don't kill the stream
                            _t.sleep(0.5)
                    else:
                        req = urllib.request.Request(url, headers={"User-Agent": FEED_PROXY_USER_AGENT})
                        resp = urllib.request.urlopen(req, timeout=15)
                        ct = resp.headers.get("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                        self.send_response(200)
                        self.send_header("Content-Type", ct)
                        self.send_header("Cache-Control", "no-cache")
                        self.send_header("Connection", "close")
                        self.end_headers()
                        while True:
                            chunk = resp.read(8192)
                            if not chunk:
                                break
                            try:
                                self.wfile.write(chunk)
                                self.wfile.flush()
                            except (BrokenPipeError, OSError):
                                break
                except (BrokenPipeError, OSError):
                    pass
                except Exception as e:
                    print("[stream-proxy] ERROR: %s" % e)
                    try:
                        self.send_error(504, "Stream proxy error: " + str(e))
                    except (BrokenPipeError, OSError):
                        pass
                return
            self.send_error(400, "Missing or invalid url")
            return

        if path == "/thumbnail" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            url = params.get("url", [None])[0]
            if url and url.startswith(("http://", "https://")):
                try:
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": "Mozilla/5.0 (compatible; UPLINK_SITE/1.0)"},
                    )
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        body = resp.read(512 * 1024)
                    if body[:8] == b"\x89PNG\r\n\x1a\n":
                        self.send_response(200)
                        self.send_header("Content-Type", "image/png")
                        self.send_header("Cache-Control", "no-cache")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        try:
                            self.wfile.write(body)
                        except (BrokenPipeError, OSError):
                            pass
                    else:
                        soi = body.find(b"\xff\xd8")
                        eoi = body.find(b"\xff\xd9", soi) if soi >= 0 else -1
                        if soi >= 0 and eoi > soi:
                            body = body[soi : eoi + 2]
                        else:
                            try:
                                self.send_error(404, "Thumbnail unavailable")
                            except (BrokenPipeError, OSError):
                                pass
                            return
                        self.send_response(200)
                        self.send_header("Content-Type", "image/jpeg")
                        self.send_header("Cache-Control", "no-cache")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        try:
                            self.wfile.write(body)
                        except (BrokenPipeError, OSError):
                            pass
                except (BrokenPipeError, OSError):
                    pass
                except Exception:
                    try:
                        self.send_error(404, "Thumbnail unavailable")
                    except (BrokenPipeError, OSError):
                        pass
                return
            self.send_error(400, "Missing or invalid url")
            return

        if path == "/snapshot-proxy" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            url = params.get("url", [None])[0]
            if url and url.startswith(("http://", "https://")):
                try:
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": "Mozilla/5.0 (compatible; UPLINK_SITE/1.0)"},
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        body = resp.read()
                        ct = resp.headers.get("Content-Type", "image/jpeg")
                        self.send_response(200)
                        self.send_header("Content-Type", ct)
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        try:
                            self.wfile.write(body)
                        except (BrokenPipeError, OSError):
                            pass
                except (BrokenPipeError, OSError):
                    pass
                except Exception as e:
                    try:
                        self.send_error(502, "Proxy error: " + str(e))
                    except (BrokenPipeError, OSError):
                        pass
                return
            self.send_error(400, "Missing or invalid url")
            return

        # Record a visit to a cam and return its total visit count
        if path == "/api/cam-visit":
            params = urllib.parse.parse_qs(parsed.query or "")
            cam_id = (params.get("cam_id") or [""])[0].strip()
            if not cam_id and params:
                # Handle double-encoded query (e.g. cam_id%3D123 → key "cam_id=123")
                for k, v in params.items():
                    if k.startswith("cam_id") and v and v[0]:
                        cam_id = str(v[0]).strip()
                        break
            if not is_safe_cam_id(cam_id):
                self.send_error(400, "Invalid cam_id")
                return
            CAM_VISITS[cam_id] = CAM_VISITS.get(cam_id, 0) + 1
            save_cam_visits()
            count = CAM_VISITS[cam_id]
            print("Cam visit: id=%s count=%s" % (cam_id, count))
            body = json.dumps({"cam_id": cam_id, "count": count}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, OSError):
                pass
            return

        # Get visit count for a cam (read-only, no increment)
        if path == "/api/cam-visit-count":
            params = urllib.parse.parse_qs(parsed.query or "")
            cam_id = (params.get("cam_id") or [""])[0].strip()
            if not cam_id and params:
                for k, v in params.items():
                    if k.startswith("cam_id") and v and v[0]:
                        cam_id = str(v[0]).strip()
                        break
            if not is_safe_cam_id(cam_id):
                self.send_error(400, "Invalid cam_id")
                return
            count = CAM_VISITS.get(cam_id, 0)
            body = json.dumps({"cam_id": cam_id, "count": count}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, OSError):
                pass
            return

        # Get thumbs up/down counts for a cam (read-only)
        if path == "/api/cam-thumbs":
            params = urllib.parse.parse_qs(parsed.query or "")
            cam_id = (params.get("cam_id") or [""])[0].strip()
            if not cam_id and params:
                for k, v in params.items():
                    if k.startswith("cam_id") and v and v[0]:
                        cam_id = str(v[0]).strip()
                        break
            if not is_safe_cam_id(cam_id):
                self.send_error(400, "Invalid cam_id")
                return
            key = str(cam_id).strip()
            rec = CAM_THUMBS.get(key, {})
            up = int(rec.get("up", 0))
            down = int(rec.get("down", 0))
            body = json.dumps({"cam_id": key, "up": up, "down": down}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, OSError):
                pass
            return

        # Record a thumbs up or down vote for a cam
        if path == "/api/cam-thumb":
            params = urllib.parse.parse_qs(parsed.query or "")
            cam_id = (params.get("cam_id") or [""])[0].strip()
            vote = (params.get("vote") or [""])[0].strip().lower()
            if not cam_id and params:
                for k, v in params.items():
                    if k.startswith("cam_id") and v and v[0]:
                        cam_id = str(v[0]).strip()
                        break
            if not is_safe_cam_id(cam_id):
                self.send_error(400, "Invalid cam_id")
                return
            if vote not in ("up", "down"):
                self.send_error(400, "Invalid vote (use vote=up or vote=down)")
                return
            key = str(cam_id).strip()
            rec = CAM_THUMBS.get(key, {"up": 0, "down": 0})
            rec["up"] = int(rec.get("up", 0))
            rec["down"] = int(rec.get("down", 0))
            rec[vote] = rec[vote] + 1
            CAM_THUMBS[key] = rec
            save_cam_thumbs()
            body = json.dumps({"cam_id": key, "up": rec["up"], "down": rec["down"]}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, OSError):
                pass
            return

        # Returns the list of cam ids that have a snapshot so the matrix can show only those and link thumbnail → stream by id.
        if path == "/api/thumbnail-ids":
            list_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "thumbnails", "list.json")
            try:
                with open(list_path, "r", encoding="utf-8") as f:
                    ids = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                ids = []
            body = json.dumps(ids).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, OSError):
                pass
            return

        return http.server.SimpleHTTPRequestHandler.do_GET(self)


class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    # Serve from the directory containing this script (so Render finds index.html)
    os.chdir(SCRIPT_DIR)
    load_cam_visits()
    load_cam_thumbs()
    with ReuseTCPServer(("", PORT), Handler) as httpd:
        print("Serving UPLINK_SITE at http://localhost:" + str(PORT))
        print("Feed proxy: /feed-proxy?url=... (for HTTPS)")
        print("Thumbnail: /thumbnail?url=... (matrix static previews)")
        print("Snapshot proxy: /snapshot-proxy?url=...")
        print("Cam visits: /api/cam-visit?cam_id=...")
        print("IP info: /ipinfo?ip=...")
        httpd.serve_forever()

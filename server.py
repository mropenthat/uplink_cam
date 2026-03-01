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

PORT = int(os.environ.get("PORT", "8080"))
# One-frame timeout: avoid long-lived streams so Railway doesn't overload (concurrent connection limit).
FEED_PROXY_TIMEOUT = 8
FEED_PROXY_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Per-cam visit counts: cam_id -> total visits. Persisted to cam_visits.json.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAM_VISITS_PATH = os.path.join(SCRIPT_DIR, "cam_visits.json")
CAM_VISITS = {}


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
        path = self.path.split("?")[0].lower()
        if path in ("/", "/index.html") or path.endswith(".html") or path.endswith(".js") or path.endswith(".css"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

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
        if path == "/stream-proxy" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            url = params.get("url", [None])[0]
            if url and url.startswith(("http://", "https://")):
                try:
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
        if path == "/api/cam-visit" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            cam_id = (params.get("cam_id") or [""])[0].strip()
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
        if path == "/api/cam-visit-count" and parsed.query:
            params = urllib.parse.parse_qs(parsed.query)
            cam_id = (params.get("cam_id") or [""])[0].strip()
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


if __name__ == "__main__":
    # Serve from the directory containing this script (so Render finds index.html)
    os.chdir(SCRIPT_DIR)
    load_cam_visits()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print("Serving UPLINK_SITE at http://localhost:" + str(PORT))
        print("Feed proxy: /feed-proxy?url=... (for HTTPS)")
        print("Thumbnail: /thumbnail?url=... (matrix static previews)")
        print("Snapshot proxy: /snapshot-proxy?url=...")
        print("Cam visits: /api/cam-visit?cam_id=...")
        print("IP info: /ipinfo?ip=...")
        httpd.serve_forever()

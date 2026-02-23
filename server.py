"""
UPLINK_SITE server: serves static files and /snapshot-proxy for SNAPSHOT capture.
Run: python3 server.py
Then open http://localhost:8080
"""
import http.server
import urllib.request
import urllib.parse
import socketserver
import os
import re

PORT = 8080


def is_safe_ip(ip):
    if not ip or not isinstance(ip, str):
        return False
    return bool(re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", ip))


class Handler(http.server.SimpleHTTPRequestHandler):
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
                self.wfile.write(body)
            except Exception as e:
                self.send_error(502, "IP info error: " + str(e))
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
                        self.wfile.write(body)
                except Exception as e:
                    self.send_error(502, "Proxy error: " + str(e))
                return
            self.send_error(400, "Missing or invalid url")
            return

        return http.server.SimpleHTTPRequestHandler.do_GET(self)


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print("Serving UPLINK_SITE at http://localhost:" + str(PORT))
        print("Snapshot proxy: /snapshot-proxy?url=...")
        print("IP info: /ipinfo?ip=...")
        httpd.serve_forever()

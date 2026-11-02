"""Local HTTP server that mimics a GitHub Pages project site.

    py -3.14 scripts/serve.py [--port 8000] [--base db-arcade]

  http://localhost:8000/db-arcade/       the app (web/), under a repository-style subpath
  http://localhost:8000/tests/run.html   the unit and parity tests in the browser

Responses carry Cache-Control: max-age=600 like GitHub Pages, so stale-cache problems show up
locally too. Nothing is served at the site root, which catches root-absolute URLs.
Set SW_VERSION=<text> to serve web/service-worker.js with that VERSION (used by the update test).
"""

import argparse
import http.server
import os
import posixpath
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


def make_handler(base):
    prefix = "/" + base.strip("/") + "/"

    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          ".js": "text/javascript", ".webmanifest": "application/manifest+json",
                          ".json": "application/json", ".svg": "image/svg+xml"}

        def translate_path(self, path):
            path = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
            if path.startswith(prefix):
                root, rel = WEB, path[len(prefix):]
            elif path.startswith("/tests/") or path.startswith("/web/"):
                root, rel = ROOT, path.lstrip("/")
            else:
                return os.path.join(WEB, "__nothing_at_the_site_root__")
            parts = [p for p in posixpath.normpath(rel).split("/") if p not in ("", ".", "..")]
            return os.path.join(root, *parts)

        def send_head(self):
            if self.path.split("?")[0] == prefix.rstrip("/"):
                self.send_response(301)
                self.send_header("Location", prefix)
                self.end_headers()
                return None
            version = os.environ.get("SW_VERSION")
            if version and self.path.split("?")[0] == prefix + "service-worker.js":
                with open(os.path.join(WEB, "service-worker.js"), encoding="utf-8") as f:
                    body = f.read().replace('const VERSION = "dev";', 'const VERSION = "{}";'.format(version))
                data = body.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                import io
                return io.BytesIO(data)
            return super().send_head()

        def end_headers(self):
            self.send_header("Cache-Control", "max-age=600")
            super().end_headers()

        def log_message(self, fmt, *args):
            if os.environ.get("SERVE_LOG"):
                super().log_message(fmt, *args)

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--base", default="db-arcade", help="repository-style subpath")
    ap.add_argument("--host", default="127.0.0.1",
                    help="0.0.0.0 to reach it from a phone on the same network (no offline mode over plain http)")
    args = ap.parse_args()
    server = http.server.ThreadingHTTPServer((args.host, args.port), make_handler(args.base))
    print("serving http://localhost:{}/{}/  (tests: /tests/run.html)".format(args.port, args.base.strip("/")),
          flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

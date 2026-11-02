"""Shared helpers for the Playwright tests: a scripts/serve.py child process and a browser."""

import contextlib
import os
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVE = os.path.join(HERE, "..", "..", "scripts", "serve.py")
BASE = "db-arcade"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def serving(port=None, sw_version=None):
    """Yields http://localhost:<port>; the app is at <url>/db-arcade/."""
    port = port or free_port()
    env = dict(os.environ)
    env.pop("SW_VERSION", None)
    if sw_version:
        env["SW_VERSION"] = sw_version
    proc = subprocess.Popen([sys.executable, SERVE, "--port", str(port), "--base", BASE], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = "http://localhost:{}".format(port)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url + "/" + BASE + "/", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        yield url
    finally:
        proc.terminate()
        proc.wait(5)


@contextlib.contextmanager
def launch_browser():
    """Installed Edge (or Chrome), headless; no Playwright browser download needed."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = None
        for channel in ("msedge", "chrome", None):
            try:
                browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
                break
            except Exception:
                continue
        if browser is None:
            raise RuntimeError("no Chromium-based browser found (install Edge or Chrome, or run 'playwright install')")
        try:
            yield browser
        finally:
            browser.close()

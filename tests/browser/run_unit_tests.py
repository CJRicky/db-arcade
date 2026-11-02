"""Run the JS unit and parity tests (tests/run.html) in headless Edge or Chrome via Playwright.

For machines without Node. CI runs the same tests with:  node tests/run-node.js

    py -3.14 tests/browser/run_unit_tests.py
"""

import sys

from serve_util import launch_browser, serving


def main():
    with serving() as base_url, launch_browser() as browser:
        page = browser.new_page()
        page.goto(base_url + "/tests/run.html")
        page.wait_for_function("window.__testResult !== undefined", timeout=120000)
        result = page.evaluate("window.__testResult")
        print(result["report"])
        return 1 if result["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())

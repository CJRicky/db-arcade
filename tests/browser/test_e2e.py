"""Browser tests: game flow on a phone viewport, keyboard, persistence, PWA scope, offline and updates.

Runs the app from scripts/serve.py under the /db-arcade/ subpath (like https://USER.github.io/REPO/)
in headless Edge or Chrome:

    py -3.14 tests/browser/test_e2e.py          (needs: pip install playwright)
"""

import json
import os
import re
import sys
import traceback

from serve_util import BASE, free_port, launch_browser, serving

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "..", "web")
PHONE = dict(viewport={"width": 360, "height": 740}, device_scale_factor=2, is_mobile=True, has_touch=True)
DESKTOP = dict(viewport={"width": 1100, "height": 800})

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def open_app(browser, url, **ctx):
    context = browser.new_context(**ctx)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
    page.goto(url + "/" + BASE + "/")
    page.wait_for_function("window.__swReady !== undefined", timeout=20000)
    return context, page


def answer_right(page):
    """Type the right answer for the current question (choices: click it)."""
    q = page.evaluate("({kind: __dbArcade.game.question.kind, answer: __dbArcade.game.question.answer})")
    if q["kind"] == "choice":
        page.click(".choice >> nth={}".format(q["answer"]))
    else:
        page.fill("#answer", repr(q["answer"]))
        page.click("#action")


def no_horizontal_scroll(page, where):
    width = page.evaluate("document.documentElement.scrollWidth")
    inner = page.evaluate("window.innerWidth")
    assert width <= inner, "{}: page is {} px wide in a {} px viewport".format(where, width, inner)


# ---------------------------------------------------------------------------- tests

@test
def subpath_manifest_and_worker_scope(browser, url):
    requests = []
    context = browser.new_context(**PHONE)
    page = context.new_page()
    page.on("request", lambda r: requests.append(r.url))
    page.goto(url + "/" + BASE + "/")
    page.wait_for_function("window.__swReady !== undefined", timeout=20000)
    app = url + "/" + BASE + "/"
    assert page.evaluate("window.__swReady.scope") == app
    manifest_url = page.evaluate("document.querySelector('link[rel=manifest]').href")
    assert manifest_url == app + "manifest.webmanifest", manifest_url
    manifest = json.loads(page.evaluate("fetch('manifest.webmanifest').then(r => r.text())"))
    for key in ("start_url", "scope", "id"):
        resolved = page.evaluate("(u) => new URL(u, '{}').href".format(manifest_url), manifest[key])
        assert resolved == app, (key, resolved)
    assert manifest["display"] == "standalone"
    for icon in manifest["icons"]:
        status = page.evaluate("(u) => fetch(u, {cache: 'no-store'}).then(r => r.status)", icon["src"])
        assert status == 200, icon
    assert {"192x192", "512x512"} <= {i["sizes"] for i in manifest["icons"]}
    assert any(i.get("purpose") == "maskable" for i in manifest["icons"])
    outside = [r for r in requests if r.startswith(url) and not r.startswith(app)]
    assert not outside, "requests outside the subpath: {}".format(outside)
    context.close()


@test
def every_web_file_is_precached(browser, url):
    with open(os.path.join(WEB, "service-worker.js"), encoding="utf-8") as f:
        assets = set(re.findall(r'^\s*"([^"]+)",?$', f.read(), re.M))
    files = set()
    for root, _dirs, names in os.walk(WEB):
        for name in names:
            rel = os.path.relpath(os.path.join(root, name), WEB).replace(os.sep, "/")
            if rel != "service-worker.js":
                files.add(rel)
    missing = files - assets
    extra = assets - files - {"./"}
    assert not missing and not extra, "missing from ASSETS: {}  listed but absent: {}".format(missing, extra)


@test
def touch_game_flow_with_keypad(browser, url):
    context, page = open_app(browser, url, **PHONE)
    assert page.is_visible("#menu")
    page.click("#start")
    assert page.is_visible("#pad .key"), "keypad should show on a touch screen"
    q1 = page.text_content("#question")
    # first question of level 1 is numeric
    page.click('[data-key="1"]')
    page.click('[data-key="."]')
    page.click('[data-key="5"]')
    page.click('[data-key="sign"]')
    assert page.input_value("#answer") == "-1.5"
    page.click('[data-key="back"]')
    assert page.input_value("#answer") == "-1."
    # a double tap on Submit grades once and does not skip the feedback
    page.click("#action")
    page.click("#action")
    assert page.text_content("#verdict").strip(), "no verdict"
    assert page.text_content("#question") == q1, "feedback was skipped"
    assert page.evaluate("__dbArcade.game.asked") == 1
    assert page.evaluate("__dbArcade.state") == "feedback"
    page.wait_for_timeout(400)
    page.click("#action")
    assert page.evaluate("__dbArcade.game.asked") == 2
    assert page.evaluate("__dbArcade.state") == "asking"
    no_horizontal_scroll(page, "game")
    assert not page.errors, page.errors
    context.close()


@test
def right_answer_scores_and_moves_on_by_itself(browser, url):
    context, page = open_app(browser, url, **PHONE)
    page.click("#start")
    answer_right(page)
    assert page.text_content("#verdict").startswith("✔")
    assert page.evaluate("__dbArcade.game.score") > 0
    page.wait_for_function("__dbArcade.game.asked === 2 && __dbArcade.state === 'asking'", timeout=3000)
    context.close()


@test
def unreadable_answer_asks_again(browser, url):
    context, page = open_app(browser, url, **DESKTOP)
    page.click("#start")
    page.fill("#answer", "abc")
    page.press("#answer", "Enter")
    assert "Couldn't read that" in page.text_content("#verdict")
    assert page.evaluate("__dbArcade.state") == "asking"
    assert page.evaluate("__dbArcade.game.stats") == {}
    context.close()


@test
def extreme_but_valid_answers_still_give_feedback(browser, url):
    context, page = open_app(browser, url, **DESKTOP)
    for text in ("1e-200", "1e300"):
        page.keyboard.press("Enter") if page.is_visible("#menu") else None
        page.wait_for_function("__dbArcade.state === 'asking'")
        page.fill("#answer", text)
        page.press("#answer", "Enter")
        assert "Answer:" in page.text_content("#verdict"), page.text_content("#verdict")
        assert page.text_content("#action") in ("Next", "Results")
        page.wait_for_timeout(400)
        page.click("#action")
    assert not page.errors, page.errors
    context.close()


@test
def physical_keyboard(browser, url):
    context, page = open_app(browser, url, **DESKTOP)
    assert not page.is_visible("#pad .key"), "no keypad with a mouse and keyboard"
    page.keyboard.press("Enter")                         # Enter on the menu starts
    assert page.is_visible("#game")
    assert page.evaluate("document.activeElement.id") == "answer"
    page.keyboard.type("−17,5")
    page.keyboard.press("Enter")
    assert page.evaluate("__dbArcade.state") == "feedback"
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    assert page.evaluate("__dbArcade.state") == "asking"
    page.keyboard.press("Escape")                        # second question: Esc shows the results
    assert page.is_visible("#over")
    page.keyboard.press("Escape")
    assert page.is_visible("#menu")
    # choice questions: keys 1-4 (level 5 practice = Compare & bound, all choices)
    page.select_option("#level", "5")
    page.check('input[value="practice"]', force=True)
    page.keyboard.press("Enter")
    assert page.is_visible("#choices")
    page.keyboard.press("2")
    assert page.evaluate("__dbArcade.state") == "feedback"
    assert page.locator(".choice.good").count() == 1
    assert not page.errors, page.errors
    context.close()


@test
def end_button_needs_a_second_tap(browser, url):
    context, page = open_app(browser, url, **PHONE)
    page.click("#start")
    answer_right(page)
    page.wait_for_function("__dbArcade.game.asked === 2", timeout=3000)
    page.click("#end")
    assert page.is_visible("#game") and "again" in page.text_content("#end")
    page.click("#end")
    assert page.is_visible("#over")
    context.close()


@test
def settings_and_best_score_persist(browser, url):
    context, page = open_app(browser, url, **PHONE)
    page.click('label:has(input[value="sprint"])')
    page.select_option("#level", "4")
    page.click("summary")
    page.click('label:has(input[value="light"])')
    page.click('label:has(input[name="keypad"][value="off"])')
    assert page.get_attribute("html", "data-theme") == "light"
    # a sprint with one right answer, then end it: new best
    page.click("#start")
    assert not page.is_visible("#pad .key")
    answer_right(page)
    score = page.evaluate("__dbArcade.game.score")
    assert score > 0
    page.keyboard.press("Escape")
    assert "NEW BEST" in page.text_content("#over-best")
    page.reload()
    page.wait_for_function("window.__swReady !== undefined", timeout=20000)
    assert page.is_checked('input[value="sprint"]')
    assert page.input_value("#level") == "4"
    assert page.get_attribute("html", "data-theme") == "light"
    assert page.is_checked('input[name="keypad"][value="off"]')
    assert "Sprint {}".format(score) in page.text_content("#best")
    stored = json.loads(page.evaluate("localStorage.getItem('dbArcade')"))
    assert stored["best"]["sprint"] == score and stored["schema"] == 1
    # corrupt storage must not break the app
    page.evaluate("localStorage.setItem('dbArcade', '{broken')")
    page.reload()
    page.wait_for_function("window.__swReady !== undefined", timeout=20000)
    assert page.is_checked('input[value="arcade"]')
    assert not page.errors, page.errors
    context.close()


@test
def phone_layouts_fit_without_horizontal_scroll(browser, url):
    for width in (320, 360, 412):
        context, page = open_app(browser, url, **dict(PHONE, viewport={"width": width, "height": 700}))
        no_horizontal_scroll(page, "menu {}".format(width))
        page.select_option("#level", "10")
        page.click("#start")
        for _ in range(12):                       # mixed level: walk through several question types
            answer_right(page) if _ % 2 else (page.fill("#answer", "1"), page.click("#action")) \
                if page.is_visible("#answer-form") else page.click(".choice >> nth=0")
            no_horizontal_scroll(page, "feedback {}".format(width))
            page.wait_for_timeout(380)
            if page.evaluate("__dbArcade.state") == "feedback":
                page.click("#action")
            if page.is_visible("#over"):
                break
        for tab in ("explorer", "rules", "logs"):
            page.click("#tab-" + tab)
            no_horizontal_scroll(page, "{} {}".format(tab, width))
        assert not page.errors, page.errors
        context.close()


@test
def offline_after_first_visit(browser, url_unused):
    port = free_port()
    with serving(port) as url:
        context, page = open_app(browser, url, **PHONE)
        page.wait_for_function("document.getElementById('app-status').textContent.includes('Available offline')",
                               timeout=20000)
    # the server is gone now
    page.reload()
    page.wait_for_selector("#start")
    page.click("#start")
    answer_right(page)
    assert page.text_content("#verdict").startswith("✔")
    page.goto(url + "/" + BASE + "/?source=homescreen")      # start URL variants also work offline
    page.wait_for_selector("#start")
    page.click("#tab-explorer")
    assert "dBm" in page.text_content("#view-explorer")
    context.close()


@test
def update_is_offered_and_applied_without_breaking_a_game(browser, url_unused):
    port = free_port()
    with serving(port, sw_version="v1") as url:
        context, page = open_app(browser, url, **PHONE)
        assert page.evaluate("window.__swReady.version") == "v1"
        page.click("#start")
        question = page.text_content("#question")
    with serving(port, sw_version="v2"):
        page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
        page.wait_for_selector("#update", state="visible", timeout=20000)
        assert page.text_content("#question") == question, "the running question was replaced"
        assert page.evaluate("__dbArcade.state") == "asking"
        page.click("#update-reload")
        page.wait_for_function("window.__swReady && window.__swReady.version === 'v2'", timeout=20000)
        caches = page.evaluate("caches.keys()")
        mine = [k for k in caches if k.startswith("db-arcade:")]
        assert mine == ["db-arcade:{}/{}/:v2".format(url, BASE)], mine
    context.close()


@test
def update_with_two_tabs_open(browser, url_unused):
    port = free_port()
    with serving(port, sw_version="v1") as url:
        context, a = open_app(browser, url, **PHONE)
        b = context.new_page()
        b.goto(url + "/" + BASE + "/")
        b.wait_for_function("window.__swReady && window.__swReady.version === 'v1'", timeout=20000)
    with serving(port, sw_version="v2"):
        a.evaluate("navigator.serviceWorker.getRegistration().then(r => r.update())")
        a.wait_for_selector("#update", state="visible", timeout=20000)
        b.wait_for_selector("#update", state="visible", timeout=20000)
        a.click("#update-reload")
        a.wait_for_function("window.__swReady && window.__swReady.version === 'v2'", timeout=20000)
        # tab B was not reloaded behind the player's back, and its Reload still works
        assert b.is_visible("#update")
        b.click("#update-reload")
        b.wait_for_function("window.__swReady && window.__swReady.version === 'v2'", timeout=20000)
    context.close()


def main():
    only = sys.argv[1:]
    failed = 0
    with serving() as url, launch_browser() as browser:
        for fn in TESTS:
            if only and fn.__name__ not in only:
                continue
            try:
                fn(browser, url)
                print("ok    " + fn.__name__)
            except Exception:
                failed += 1
                print("FAIL  " + fn.__name__)
                print("      " + traceback.format_exc().strip().replace("\n", "\n      "))
    print("\n{} passed, {} failed".format(len([t for t in TESTS if not only or t.__name__ in only]) - failed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

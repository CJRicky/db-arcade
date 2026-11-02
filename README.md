# dB Arcade (web / PWA)

dB Arcade as a mobile-first web app that installs like an app and works offline. It is a port of
a Python/Tkinter version of the game (`db_core.py` + `db_trainer.py`, not included here), which
was the reference for every rule and formula.

Static HTML, CSS and vanilla JavaScript (ES modules). There is no build step, no framework, no backend,
no tracking and no external requests. Scores and settings stay on the device.

```
db-arcade/
  web/                     the site; only this folder is published
    index.html, manifest.webmanifest, service-worker.js, css/, icons/
    js/pyport.js           Python's random.Random (Mersenne Twister), round-half-even, floor modulo
    js/dbmath.js           conversions, formatting, worked steps          (db_core.py, first half)
    js/questions.js        parsing, grading, diagnosis, 9 generators      (db_core.py, second half)
    js/game.js             modes, lives, levels, scoring, retries         (db_core.Game)
    js/content.js          rule cards and log-law tables
    js/storage.js          localStorage, validated
    js/play.js, views.js, main.js, dom.js     the UI                      (db_trainer.py)
  tests/                   unit + Python-parity tests (Node or browser), browser end-to-end tests
  scripts/                 fixture generator, icon renderer, local server
  .github/workflows/       GitHub Pages deployment
```

## How it maps to the Python version

All game behaviour is ported line by line, and the rng calls happen in the same order as in Python.
`pyport.js` reproduces CPython's random number generator, so **the same seed gives the same
questions in both versions**. The parity tests use that to compare the web app against output
written by Python's own `db_core.py`.

| Python (`db_trainer`) | Web |
|---|---|
| Arcade tab: menu, Arcade / Sprint / Practice, levels 1–10, rule previews | **Play** |
| HUD (level, ♥ lives, streak ×, score, Sprint timer), level progress bar | same |
| Rule cards at level start, worked steps after each answer, rule cards and diagnosis after a miss, "exact:" line | same |
| Link chain diagram | vertical list on phones, a row on wide screens |
| Close answers, retries after 4 questions (at most 2), speed bonus, auto-next after a right answer (1.4 s, Sprint 0.7 s) | same |
| Game over: score, level, right %, best streak, per skill, "Work on" | same |
| Explorer tab (dBm ladder, loss bar, steps) | **Explorer**, with − / + buttons beside each slider |
| Rules tab, Log laws tab | **Rules**, **Log laws** |
| Enter, Esc, 1–4 | same on a keyboard. On a phone: Submit/Next, **End** (tap twice), tap a choice |
| Best scores in `~/.db_arcade.json` | `localStorage` key `dbArcade` (with settings) |

The 9 skills are Decades, Doubling, Fives, Loss budget, Compare & bound, Fine steps, Power sums,
Link budgets and Spot the error, followed by level 10, Mixed. The web version keeps every one of
the Python version's question types, mixes, tolerances, answer formats (`−17`, `3,5`, `x50`,
`20u`, `0.5 mW`, `1e-3`), scoring rules and messages.

### Differences from the Python version (layout and input only)

- **On-screen keypad.** Touch screens get a keypad: digits, `.`, `±`, ⌫, plus `pW nW µW mW W` keys
  for power answers. Phone number keyboards often have no minus key (the iOS decimal pad never
  does), and many answers here are negative dBm. Settings → *Answer keypad* switches to the full
  system keyboard instead. Physical keyboards always work.
- **End button.** Phones have no Esc key, so there is an **End** button. It needs a second tap within
  3 s, so a stray tap cannot end an Arcade run. Esc on a keyboard ends at once, as in Python.
- **Auto-next.** It waits while another tab (Rules, Explorer, …) is open, so a question is never
  replaced while you're not looking. It also ignores a second tap within 0.35 s, so a double tap on
  Submit cannot skip the feedback.
- **Wording.** "against the rule on the right" became "the rule card below", because phones stack the
  cards. `(you: 50 )` lost its trailing space.
- **Theme.** The app follows the system light/dark theme by default. Dark uses the Tkinter colours.
- Python's `\d` also accepts non-ASCII digits (e.g. Arabic-Indic digits); the web version accepts
  only 0–9.

No mathematical bugs were found in the Python reference, so no behaviour was changed.

## Run locally

Any static HTTP server works. A service worker needs `http://localhost` or HTTPS; opening `file://`
does not work. The included server mimics GitHub Pages: it serves the app under a subpath with the
same `max-age=600` caching.

```
py -3.14 scripts/serve.py            # http://localhost:8000/db-arcade/
```

Python's built-in server also works: `py -m http.server -d web 8000` → http://localhost:8000/.

To try it on a phone on the same Wi-Fi, run `py -3.14 scripts/serve.py --host 0.0.0.0` and open
`http://<PC IP>:8000/db-arcade/` on the phone (allow Python through the Windows firewall if asked).
The game works, but offline mode and installing need HTTPS, so for those use the GitHub Pages URL.

The local version is called `dev` and never changes, so after editing a file, use DevTools →
Application → Service workers → *Update on reload* (or *Bypass for network*) to see the change.

## Tests

| What | Command |
|---|---|
| Unit + parity tests (Node 18+, no npm packages) | `node tests/run-node.js` (or `npm test`) |
| Same tests in headless Edge/Chrome (no Node needed) | `py -3.14 tests/browser/run_unit_tests.py` |
| Same tests in any browser | `scripts/serve.py`, then open http://localhost:8000/tests/run.html |
| End-to-end: phone viewport, keyboard, persistence, subpath, manifest, offline, update | `py -3.14 tests/browser/test_e2e.py` |

The browser scripts need `pip install playwright` and an installed Edge or Chrome; nothing is
downloaded.

**Parity fixtures.** `tests/fixtures/parity.json` was written by the Python game itself. With a
copy of the Python version it can be regenerated:

```
py -3.14 scripts/make_fixtures.py --db-core PATH/TO/FOLDER/WITH/db_core.py
```

The fixtures cover:
- RNG streams;
- number formatting, including round-half-even ties;
- worked steps for every dBm from −65 to +35 in 0.5 steps, and for powers and ratios;
- answer parsing and rejection;
- grading and diagnosis;
- 150 seeded questions for each of the 9 skills, compared field by field;
- level picks;
- 9 complete game sessions (score, lives, levels, retries and stats after every answer).

The unit tests also check invariants and distributions: the 55 % / 45 % level mix, the
35/35/15/15 % conversion mix, uniform Mixed, value ranges and tolerances, exact right/close/wrong
boundaries, life caps and retry limits.

The icons are rendered from one SVG by `py -3.14 scripts/make_icons.py`.

## Publish on GitHub Pages

1. This repository is the site's source.
2. Pushes to the default branch publish it.
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The **Deploy dB Arcade to GitHub Pages** workflow runs on every push:
   - The `test` job runs `node tests/run-node.js` on every branch.
   - The `deploy` job runs only on the repository's default branch (whatever it is named) and
     only if the tests pass. It writes the commit SHA into `VERSION` in `service-worker.js`
     (that is what makes installed copies update), uploads `web/` as the site root and deploys.
   - Permissions: `contents: read` by default, plus `pages: write` and `id-token: write` for the
     deploy job only, in the `github-pages` environment. No secrets are used.
   - Run it by hand with **Actions → the workflow → Run workflow**.
5. The site appears at `https://USERNAME.github.io/REPOSITORY/`, e.g.
   `https://USERNAME.github.io/db-arcade/`.
   - A repository named `USERNAME.github.io` is served at the domain root instead.
   - A custom domain changes the host.
   - No paths are hard-coded, so all three work unchanged.

**The site is public.** Free GitHub plans publish Pages only from public repositories. A paid plan
can publish from a private repository, but the site itself is still reachable by anyone with the
URL unless the organisation uses Enterprise access control. Nothing confidential is in the app;
the fibre numbers (0.25 dB/km, 0.5 dB connectors) are generic teaching values.

**Troubleshooting**

- *Deploy fails with "Get Pages site failed" or a 404.* Pages is not enabled, or its source is not
  set to *GitHub Actions* (step 3).
- *"Branch is not allowed to deploy to github-pages".* The `github-pages` environment allows only
  the default branch by default. Push to that branch or change the environment's rules.
- *Action version errors.* The workflow uses `checkout@v5`, `setup-node@v5`, `configure-pages@v5`,
  `upload-pages-artifact@v4` and `deploy-pages@v4`. Bump them if GitHub reports a version as
  deprecated.
- *Site loads but looks old.* See *Updates* below. In a desktop browser, a hard reload also helps.

The app also runs on any other static HTTPS host: upload the contents of `web/`.

## Install and play offline

- **Android (Chrome):** open the URL, then use *Install app* (or ⋮ → *Add to Home screen*). The app
  opens full-screen from its icon. Edge and Samsung Internet offer the same option.
- **iOS / iPadOS (Safari):** Share → *Add to Home Screen*. On iOS 16.4+ other browsers can do this too.
  - iOS may clear the data of a home-screen app that hasn't been opened for several weeks, which
    loses scores and settings.
  - Installed and in-browser copies have separate storage.
- **Desktop (Chrome / Edge):** the install icon in the address bar.

The whole app (about 135 kB) is cached on the first visit. Settings → the status line says
**"Available offline."** when that has finished. After that the game, Explorer, Rules and Log laws
work in flight mode. To check: open the app once, switch to flight mode, close and reopen it.

### Updates

After a deploy, an open app looks for the new version:
- when it starts;
- when it comes back to the foreground;
- once an hour while it stays open.

The new version is downloaded in the background, then a bar says **"A new version is ready.
Reload"**. The switch waits for that tap, so a running game is never replaced. Closing every window
of the app also switches it. Old cached versions are deleted after the switch.

## Sharing

Send the `https://USERNAME.github.io/REPOSITORY/` link. Everyone gets their own copy. Scores and
settings stay on each device and browser; there are no accounts and no sync.

## Known limitations

- The URL is public (see above).
- Best scores and settings live in the browser's `localStorage`. Clearing site data loses them,
  and they don't move between devices.
- Sprint keeps real time while the app is in the background, as in Python.
- Offline use needs one successful online visit first, and the service worker needs HTTPS or
  `localhost`.
- Like the original, an unfinished game is not kept when the app is closed.

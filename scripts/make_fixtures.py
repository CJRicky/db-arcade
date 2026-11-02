"""Write tests/fixtures/parity.json: reference outputs of the Python dB Arcade (db_core.py).

The JS port must reproduce these exactly. Seeded questions work because web/js/pyport.js
ports Python's Mersenne Twister and the random.Random methods the generators use.

Needs the Python game's db_core.py; by default it is looked for in ../db_trainer next to this project:
    py -3.14 scripts/make_fixtures.py [--db-core FOLDER_WITH_DB_CORE]
"""

import argparse
import dataclasses
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
c = None  # db_core, imported in main()

PER_SKILL = 150
OUT = os.path.join(ROOT, "tests", "fixtures", "parity.json")


def q_dict(q):
    d = dataclasses.asdict(q)
    if d["chain"]:
        d["chain"]["nodes"] = [list(n) for n in d["chain"]["nodes"]]
    return d


def rng_cases():
    out = []
    for seed in (0, 1, 7, 42, 123456789, 2 ** 32 + 5, 2 ** 40 + 3):
        r = random.Random(seed)
        seq = []
        for i in range(400):        # crosses the 624-word twist more than once
            op = i % 6
            if op == 0:
                seq.append(["random", r.random()])
            elif op == 1:
                seq.append(["randint", -60, 31, r.randint(-60, 31)])
            elif op == 2:
                seq.append(["randrange", -60, 31, 10, r.randrange(-60, 31, 10)])
            elif op == 3:
                seq.append(["choice", 10, r.choice(range(10))])
            elif op == 4:
                x = list(range(7))
                r.shuffle(x)
                seq.append(["shuffle", 7, x])
            else:
                seq.append(["getrandbits", 13, r.getrandbits(13)])
        out.append({"seed": seed, "seq": seq})
    return out


def fmt_cases():
    values = [0.0, -0.0, 1e-9, 0.0123, 0.125, 0.135, 0.5, 1.0, 1.005, 2.5, 2.675, 3.5, 9.995, 19.95, 99.95,
              999.6, 1000.0, 12345.678, 0.09996, 0.00049999, 7.25, -0.05, -0.04, -1.25, -2.5, -17.0, -16.95,
              0.45, 1.45, 1.55, 2.25, 0.35, 10.5, 100.5,
              # extremes a player can type (1e-200 is a valid answer): beyond toFixed's range
              5e-324, 1e-200, -3e-150, 1e21, 1e25, 1.5e300, -2.5e22]
    rows = []
    for v in values:
        rows.append({
            "x": v,
            "fixed": ["{:.0f}".format(v), "{:.1f}".format(v), "{:.2f}".format(v), "{:+.1f}".format(v)],
            "round": [round(v, 1), round(v, 2)],
            "round0": round(v),
            "fmt_num": [c.fmt_num(v), c.fmt_num(v, 2), c.fmt_num(v, 1), c.fmt_num(v, 4)],
            "fmt_db": [c.fmt_db(v, "dBm"), c.fmt_db(v, "dB", False), c.fmt_db(v, "")],
        })
    powers = [c.dbm_to_mw(d / 2.0) for d in range(-130, 71)] + [1e-6, 0.9995e-3, 0.0009994, 999.9, 1e3, 2e4]
    power_rows = [[p, c.fmt_power(p), c.nice_unit(p), c.fmt_power(p, "µW"), c.fmt_power(p, sig=4)] for p in powers]
    return rows, power_rows


def steps_cases():
    dbm = [d / 2.0 for d in range(-130, 71)] + [-16.95, -13.04, 2.55]
    ratios = [1, 1.12, 1.26, 1.6, 2, 2.5, 3, 3.16, 4, 5, 6, 6.3, 8, 10, 12.5, 16, 20, 25, 32, 40, 48, 50, 64,
              80, 96, 100, 200, 500, 1000, 1e4, 0.5, 0.25, 0.2, 0.1, 0.05, 0.01, 0.001, 0.8, 1 / 1.12,
              c.db_to_ratio(-3.7), c.db_to_ratio(-0.5), c.db_to_ratio(13.5)]
    mws = [0.25, 0.5, 0.005, 1.25e-5, 1.5e-4, 3e-3, 6e-2, 8e-1, 4, 2.5, 20, 63, 1e-6, 1, 1000, 0.002, 0.07]
    return {
        "dbm": [[d] + list(c.dbm_steps(d)) for d in dbm],
        "power": [[m] + list(c.power_steps(m)) for m in mws],
        "ratio": [[r] + list(c.ratio_steps(r)) for r in ratios],
        "terms": [[r, op] + list(c.db_terms(r, op)) for r in (1, 2, 4, 10, 16, 20, 40, 48, 50, 80, 96, 64, 3)
                  for op in ("×", "÷")],
    }


def parse_cases():
    rows = []
    for text, unit in [("20u", "µW"), ("0.02 mW", "µW"), ("−17", "dBm"), ("–17", "dBm"), ("3,5 dB", "dB"),
                       ("x50", ""), ("×50", ""), ("*50", ""), (" +2.5 ", "dBm"), ("-17dbm", "dBm"), ("4 db", "dB"),
                       ("1e-3", "mW"), ("1E3", "µW"), (".5", "dB"), ("5.", "dB"), ("300n", "µW"), ("1 W", "mW"),
                       ("2.5 MW", "mW"), ("20 µw", "µW"), ("20 μW", "µW"), ("20 μ", "µW"), ("7 p", "nW"),
                       ("12 km", "km"), ("50 %", "%"), ("abc", "dB"), ("20 km", "µW"), ("1e999", "dB"),
                       ("1e306 W", "pW"), ("", "dB"), ("-", "dB"), ("1.2.3", "dB"), ("5 dBm", "km"),
                       ("5 dbm", "dB"), ("5 db", "dBm"), ("--5", "dB"), ("1e", "dB"), ("0", "µW")]:
        try:
            rows.append([text, unit, c.parse_answer(text, unit), None])
        except ValueError as e:
            rows.append([text, unit, None, str(e)])
    return rows


def grade_cases(questions):
    """grade / diagnose / answer_text on generated questions with typical right and wrong inputs."""
    rows = []
    for i, q in enumerate(questions):
        if q.kind == "choice":
            inputs = [str(i) for i in range(len(q.choices))]
        else:
            a = q.answer
            inputs = [repr(a), repr(a * 1.03), repr(a * 1.1), repr(a * 2), repr(-a), repr(a + 0.15), repr(a - 0.4),
                      repr(a * 10), repr(a / 1000), repr(100 - a), "0", "-1"]
        for t in inputs:
            verdict, value = c.grade(q, t)
            rows.append([i, t, verdict, value, c.diagnose(q, value)])
    return rows


def game_cases():
    sessions = []
    for seed, mode, level in [(1, "arcade", 1), (2, "arcade", 4), (3, "sprint", 1), (4, "sprint", 8),
                              (5, "practice", 1), (6, "practice", 9), (7, "practice", 10), (8, "arcade", 10),
                              (9, "arcade", 7)]:
        g = c.Game(mode, level=level, rng=random.Random(seed))
        steps = []
        for i in range(70):
            if g.over:
                break
            q = g.next_question()
            pattern = (i * 7 + seed) % 10
            if q.kind == "choice":
                text = str(int(q.answer)) if pattern < 7 else str((int(q.answer) + 1) % len(q.choices))
            elif pattern < 6:
                text = repr(q.answer)
            elif pattern < 8 and not q.log:
                text = repr(q.answer + 1.5 * q.tol)     # close
            else:
                text = repr(q.answer * 1e3 + 1e3)
            res = g.answer(text, seconds=(i * 3) % 13)
            steps.append({"prompt": q.prompt, "is_retry": q.is_retry, "tries": q.tries, "text": text,
                          "res": dataclasses.asdict(res),
                          "state": [g.level, g.lives, g.score, g.streak, g.best_streak, g.level_right, g.asked,
                                    g.right, g.over]})
        sessions.append({"seed": seed, "mode": mode, "level": level, "steps": steps,
                         "stats": g.stats, "weakest": [list(w) for w in g.weakest()]})
    return sessions


def main():
    global c
    ap = argparse.ArgumentParser(description="Write tests/fixtures/parity.json from the Python dB Arcade.")
    ap.add_argument("--db-core", default=os.path.join(ROOT, "..", "db_trainer"),
                    help="folder that contains db_core.py (default: ../db_trainer)")
    args = ap.parse_args()
    if not os.path.isfile(os.path.join(args.db_core, "db_core.py")):
        sys.exit("db_core.py not found in {} (use --db-core)".format(os.path.abspath(args.db_core)))
    sys.path.insert(0, os.path.abspath(args.db_core))
    import db_core
    c = db_core
    fmt_rows, power_rows = fmt_cases()
    gen = {}
    graded_qs = []
    for skill in c.SKILLS:
        rows = []
        for seed in range(PER_SKILL):
            r = random.Random(seed)
            q = skill.gen(r)
            rows.append({"seed": seed, "q": q_dict(q), "after": r.random(), "answer_text": c.answer_text(q)})
            if seed < 12:
                graded_qs.append(q)
        gen[skill.key] = rows
    picks = []
    for level in range(1, len(c.SKILLS) + 2):
        r = random.Random(1000 + level)
        picks.append({"level": level, "prompts": [c.pick_question(level, r).prompt for _ in range(40)]})
    data = {
        "python": sys.version.split()[0],
        "rng": rng_cases(),
        "format": fmt_rows,
        "power": power_rows,
        "steps": steps_cases(),
        "parse": parse_cases(),
        "graded_questions": [q_dict(q) for q in graded_qs],
        "grade": grade_cases(graded_qs),
        "generators": gen,
        "pick": picks,
        "games": game_cases(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote {} ({:.0f} kB) with Python {}".format(OUT, os.path.getsize(OUT) / 1024, data["python"]))


if __name__ == "__main__":
    main()

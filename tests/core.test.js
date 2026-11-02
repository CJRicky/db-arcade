// Behaviour tests: the Python test_db_core.py suite ported, plus invariants, distributions,
// tolerance boundaries, invalid input and scoring rules for randomly seeded games.
import { test, assert } from "./harness.js";
import { PyRandom } from "../web/js/pyport.js";
import {
  MINUS, dbmToMw, mwToDbm, ratioToDb, dbToRatio, fmtPower, fmtDb, fmtNum, dbmSteps, powerSteps, ratioSteps,
} from "../web/js/dbmath.js";
import { RULES, RATIO_DB, RULES_TAB_ORDER } from "../web/js/content.js";
import {
  makeQuestion, parseAnswer, grade, diagnose, answerText, AnswerError, SKILLS, genCompare, genLinks, genSums,
  pickQuestion, levelName, levelRules,
} from "../web/js/questions.js";
import { Game, LIVES, MAX_LIVES, PER_LEVEL, RETRY_GAP, MAX_RETRIES, FAST_SECONDS } from "../web/js/game.js";

const text = ([steps]) => steps.join("\n");
const rightText = (q) => (q.kind === "choice" ? String(q.answer) : String(q.answer));
const wrongText = (q) => (q.kind === "choice" ? String((q.answer + 1) % q.choices.length) : String(q.answer * 1e3 + 1e3));

// ---------------------------------------------------------------- ported from test_db_core.py

test("conversions: anchor values", () => {
  assert.close(dbmToMw(0), 1.0);
  assert.close(dbmToMw(-30), 1e-3);
  assert.close(mwToDbm(100), 20.0);
  assert.close(ratioToDb(2), 3.0103, 1e-4);
  assert.close(mwToDbm(0.5), -3.0103, 1e-4);
  assert.close(dbToRatio(-10), 0.1);
});

test("formatting", () => {
  assert.equal(fmtPower(dbmToMw(-17)), "20 µW");
  assert.equal(fmtPower(1.0), "1 mW");
  assert.equal(fmtPower(1e-6), "1 nW");
  assert.equal(fmtDb(-17, "dBm"), "−17 dBm");
  assert.equal(fmtDb(2.5, "dBm"), "+2.5 dBm");
  assert.equal(fmtDb(0, "dBm"), "0 dBm");
  assert.equal(fmtNum(19.95, 2), "20");
  assert.equal(fmtNum(0.0123), "0.0123");
  assert.equal(fmtNum(-3.5), `${MINUS}3.5`);
});

test("dBm steps use threes", () => {
  assert.includes(text(dbmSteps(-17)), "−20 dBm + 3 dB");
  assert.includes(text(dbmSteps(-17)), "≈ 20 µW");
  assert.equal(dbmSteps(-17)[1], "double");
  assert.includes(text(dbmSteps(-13)), "−10 dBm − 3 dB");
  assert.includes(text(dbmSteps(-4)), "−10 dBm + 6 dB");    // −10 + 6 (×4) is preferred over 0 − 4
  assert.equal(dbmSteps(-30)[1], "decade");
  assert.equal(dbmSteps(-12)[1], "fine");
});

test("one step per line", () => {
  for (const [steps] of [dbmSteps(-17), powerSteps(0.25), ratioSteps(50)]) {
    assert.ok(steps.every((s) => !s.includes("\n")));
  }
});

test("percent hint has the right sign", () => {
  assert.includes(text(dbmSteps(-1)), "≈ −21 %");
  assert.includes(text(dbmSteps(1)), "≈ +26 %");
  assert.notIncludes(text(dbmSteps(2.5)), "%");             // +2.5 dB is +78 %, not the 0.5 dB hint
});

test("power steps", () => {
  assert.includes(text(powerSteps(0.25)), "−6 dBm");
  assert.includes(text(powerSteps(0.5)), "÷");              // alternative route from the decade above
  assert.equal(powerSteps(0.005)[1], "five");
});

test("ratio steps (fractional dB never snaps to an anchor)", () => {
  assert.includes(text(ratioSteps(50)), "10 + 7");
  assert.includes(text(ratioSteps(0.01)), "dB loss");
  assert.includes(text(ratioSteps(dbToRatio(-0.5))), "0.5 dB loss");
  assert.includes(text(ratioSteps(dbToRatio(-3.7))), "3.7 dB loss");
});

test("ratio ↔ dB table matches 10·log", () => {
  for (const [ratio, db] of RATIO_DB) {
    const [num, den] = ratio.split("/");
    const value = Number(num) / Number(den || 1);
    assert.close(ratioToDb(value), Number(db.replace("≈", "").replace(MINUS, "-")), 0.05, ratio);
  }
});

test("diagnosis of common mistakes", () => {
  const power = makeQuestion("x", "", { answer: 20.0, unit: "µW", tol: 0.2, log: true });
  assert.includes(diagnose(power, 200), "decades");
  assert.includes(diagnose(power, 0.02), "unit prefix");
  assert.includes(diagnose(power, 40), "direction");
  assert.includes(diagnose(power, 22), "Right method");
  assert.includes(diagnose(power, -5), "always positive");
  const dbm = makeQuestion("x", "", { answer: -17.0, unit: "dBm", tol: 0.2 });
  assert.includes(diagnose(dbm, 17), "Sign");
  const db = makeQuestion("x", "", { answer: 6.02, unit: "dB", tol: 0.2, fromRatio: true });
  assert.includes(diagnose(db, 12), "20·log");
  const margin = makeQuestion("x", "", { answer: 4.0, unit: "dB", tol: 0.5 });   // no log involved
  assert.notIncludes(diagnose(margin, 8), "20·log");
  const pct = makeQuestion("x", "", { answer: 20.6, unit: "%", tol: 2 });
  assert.includes(diagnose(pct, 79), "remains");
  assert.equal(diagnose(makeQuestion("x", "", { answer: 40, unit: "km", tol: 2 }), 10), "");
  assert.equal(diagnose(makeQuestion("x", "", { kind: "choice", answer: 1 }), 0), "");
});

test("answer units and suffixes", () => {
  assert.close(parseAnswer("20u", "µW"), 20);
  assert.close(parseAnswer("0.02 mW", "µW"), 20);
  assert.close(parseAnswer("−17", "dBm"), -17);
  assert.close(parseAnswer("3,5 dB", "dB"), 3.5);
  assert.close(parseAnswer("x50", ""), 50);
  assert.close(parseAnswer("300n", "µW"), 0.3);
  assert.close(parseAnswer("-.5", "dB"), -0.5);
  assert.close(parseAnswer("2e-3 W", "mW"), 2);
  assert.throws(() => parseAnswer("abc", "dB"), /not a number/);
  assert.throws(() => parseAnswer("20 km", "µW"), /unknown unit/);
  assert.throws(() => parseAnswer("1e999", "dB"), /out of range/);
  assert.throws(() => parseAnswer("1e306 W", "pW"), /out of range/);
  assert.throws(() => parseAnswer("", "dB"), /not a number/);
  assert.throws(() => parseAnswer("--3", "dB"), /not a number/);
  assert.throws(() => parseAnswer("1,000.5", "dB"), /not a number/);   // decimal comma, not a thousands separator
  assert.ok(new AnswerError("x") instanceof Error);
});

test("log tolerance (power and ratio answers are graded in dB)", () => {
  const q = makeQuestion("decades", "", { answer: 20.0, unit: "µW", tol: 0.2, log: true });
  assert.equal(grade(q, "19.95")[0], "right");
  assert.equal(grade(q, "20.9")[0], "right");    // 0.19 dB
  assert.equal(grade(q, "22")[0], "close");      // 0.41 dB
  assert.equal(grade(q, "40")[0], "wrong");      // 3 dB
  assert.equal(grade(q, "0")[0], "wrong");
  assert.equal(grade(q, "-20")[0], "wrong");
});

test("absolute tolerance, and the exact right/close/wrong boundaries", () => {
  const q = makeQuestion("x", "", { answer: -17.0, unit: "dBm", tol: 0.1 });
  assert.equal(grade(q, "-17")[0], "right");
  assert.equal(grade(q, "-17.2")[0], "close");
  assert.equal(grade(q, "-14")[0], "wrong");
  assert.equal(grade(q, "-17.1")[0], "right");   // exactly tol
  assert.equal(grade(q, "-16.75")[0], "close");  // exactly 2.5 × tol
  assert.equal(grade(q, "-16.74")[0], "wrong");
  assert.equal(grade(q, "−17,05 dBm")[0], "right");
  const zero = makeQuestion("x", "", { answer: 0, unit: "dB", tol: 0.5 });
  assert.equal(grade(zero, "0")[0], "right");
  assert.equal(grade(zero, "-0.5")[0], "right");
  assert.equal(grade(zero, "+1.25")[0], "close");
});

test("choice grading", () => {
  const q = makeQuestion("compare", "", { answer: 2, kind: "choice", choices: ["a", "b", "c", "d"] });
  assert.equal(grade(q, "2")[0], "right");
  assert.equal(grade(q, "0")[0], "wrong");
  assert.throws(() => grade(q, "two"), /choice/);
  assert.equal(answerText(q), "c");
});

test("every generator accepts its own answer, has steps and known rules (300 per skill)", () => {
  const rng = new PyRandom(7);
  for (const skill of SKILLS) {
    for (let i = 0; i < 300; i++) {
      const q = skill.gen(rng);
      assert.equal(q.skill, skill.key);
      assert.equal(grade(q, rightText(q))[0], "right", [skill.key, q.prompt]);
      assert.ok(q.steps.length, [skill.key, q.prompt]);
      assert.ok(q.rules.length && q.rules.every((r) => r in RULES), [skill.key, q.prompt]);
      assert.ok(q.steps.every((s) => !s.includes("\n")), [skill.key, q.steps]);
      assert.ok(Number.isFinite(q.answer) && q.tol > 0, [skill.key, q.prompt]);
      if (q.kind === "choice") {
        assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length);
      } else {
        // the displayed answer is accepted too (what a careful player would type after seeing it)
        assert.ok(["right", "close"].includes(grade(q, answerText(q).replace(/ (dBm|dB|µW|mW|nW|pW|W|km|%)$/, ""))[0]),
          [skill.key, q.prompt, answerText(q)]);
      }
      if (q.chain && q.chain.levels) assert.equal(q.chain.levels.length, q.chain.nodes.length);
    }
  }
});

test("link Rx answer matches the chain", () => {
  const rng = new PyRandom(3);
  for (let i = 0; i < 200; i++) {
    const q = genLinks(rng);
    if (q.prompt.startsWith("What power") && q.unit === "dBm") assert.close(q.chain.levels.at(-1), q.answer);
  }
});

test("compare questions have one right answer and never sit on a decade boundary", () => {
  const rng = new PyRandom(0);
  for (let i = 0; i < 3000; i++) {
    const q = genCompare(rng);
    assert.equal(new Set(q.choices).size, q.choices.length, q.prompt);
    assert.notIncludes(q.choices.join(" "), "≈ 1×", q.prompt);
    for (const exact of ["1 ", "10 ", "100 "]) {
      assert.ok(!(q.prompt.startsWith("Bound it first: " + exact) && q.prompt.includes("W lies")), q.prompt);
    }
    assert.ok(!/first: [−+]?\d*0 dBm/.test(q.prompt), q.prompt);
  }
});

test("equal power sum is +3 dB", () => {
  const rng = new PyRandom(1);
  for (let i = 0; i < 200; i++) {
    const q = genSums(rng);
    if (q.prompt.startsWith("Combine") && q.steps[0].includes("equal powers")) assert.includes(q.steps[1], "+3 dB");
  }
});

test("level up and bonus life", () => {
  const g = new Game("arcade", 1, new PyRandom(0));
  for (let i = 0; i < PER_LEVEL * 3; i++) {
    g.nextQuestion();
    g.answer(rightText(g.question), 30);
  }
  assert.equal(g.level, 4);
  assert.equal(g.lives, LIVES + 1);
  assert.ok(g.score > 0);
});

test("lives and game over", () => {
  const g = new Game("arcade", 1, new PyRandom(0));
  let res;
  for (let i = 0; i < LIVES; i++) {
    g.nextQuestion();
    res = g.answer(wrongText(g.question));
  }
  assert.ok(res.over && g.over);
});

test("a missed question comes back after RETRY_GAP others, at most MAX_RETRIES times", () => {
  const g = new Game("practice", 1, new PyRandom(0));
  const missed = g.nextQuestion();
  g.answer(wrongText(missed));
  const seen = [];
  for (let i = 0; i < RETRY_GAP + 1; i++) {
    seen.push(g.nextQuestion());
    g.answer(rightText(g.question));
  }
  assert.ok(seen.at(-1).isRetry);
  assert.equal(seen.at(-1).prompt, missed.prompt);

  const h = new Game("practice", 1, new PyRandom(5));
  const first = h.nextQuestion();
  let comebacks = 0;
  h.answer(wrongText(first));
  for (let i = 0; i < 40; i++) {
    const q = h.nextQuestion();
    if (q.prompt === first.prompt && q.isRetry) {
      comebacks += 1;
      h.answer(wrongText(q));
    } else {
      h.answer(rightText(q));
    }
  }
  assert.equal(comebacks, MAX_RETRIES);
});

test("streak multiplier, speed bonus and retry scoring", () => {
  const g = new Game("sprint", 1, new PyRandom(0));
  let res;
  for (let i = 0; i < 3; i++) {
    g.nextQuestion();
    res = g.answer(rightText(g.question), 0);
  }
  assert.equal(res.mult, 2);
  assert.equal(res.bonus, 10);                       // full bonus at 0 s = base (10 × level 1)
  assert.equal(res.points, 10 * 2 + 10);

  const m = new Game("arcade", 2, new PyRandom(1));
  for (let i = 0; i < 20; i++) {
    m.streak = i;
    assert.equal(m.multiplier(), 1 + Math.floor(Math.min(i, 12) / 3));
  }
  assert.equal(m.multiplier(), 5);                   // capped at ×5

  const s = new Game("arcade", 3, new PyRandom(2));
  s.nextQuestion();
  res = s.answer(rightText(s.question), FAST_SECONDS / 2);
  assert.equal(res.bonus, 15);                       // half of base 30
  s.nextQuestion();
  res = s.answer(rightText(s.question), FAST_SECONDS + 5);
  assert.equal(res.bonus, 0);
  const retry = { ...s.question, isRetry: true, tries: 1 };
  s.question = retry;
  res = s.answer(rightText(retry), 0);
  assert.equal(res.points, 30);                      // retries earn the base only
  assert.equal(res.bonus, 0);
});

test("close answers: 2 × level points, no life lost, streak broken; practice keeps no score", () => {
  const g = new Game("arcade", 4, new PyRandom(3));
  let q;
  do { q = g.nextQuestion(); } while (q.kind !== "num" || q.log);
  g.streak = 5;
  const res = g.answer(String(q.answer + 1.5 * q.tol));
  assert.equal(res.verdict, "close");
  assert.equal(res.points, 8);
  assert.equal(g.lives, LIVES);
  assert.equal(g.streak, 0);
  assert.equal(g.score, 8);

  const p = new Game("practice", 2, new PyRandom(4));
  for (let i = 0; i < PER_LEVEL * 2; i++) {
    p.nextQuestion();
    p.answer(rightText(p.question), 0);
  }
  assert.equal(p.score, 0);
  assert.equal(p.level, 2);                          // practice never levels up
  assert.equal(p.lives, null);
});

test("lives are capped at MAX_LIVES", () => {
  const g = new Game("arcade", 1, new PyRandom(9));
  for (let i = 0; i < PER_LEVEL * 30; i++) {
    g.nextQuestion();
    g.answer(rightText(g.question), 30);
  }
  assert.equal(g.lives, MAX_LIVES);
  assert.equal(g.level, 31);
});

test("unreadable input changes nothing", () => {
  const g = new Game("arcade", 1, new PyRandom(0));
  let q;
  do { q = g.nextQuestion(); } while (q.kind !== "num");
  const before = JSON.stringify([g.score, g.lives, g.streak, g.stats, g.retry.length]);
  assert.throws(() => g.answer("abc"));
  assert.equal(JSON.stringify([g.score, g.lives, g.streak, g.stats, g.retry.length]), before);
});

// ---------------------------------------------------------------- distributions and difficulty

test("level 1 asks only decades; level n mixes ≈55 % current skill with earlier skills only", () => {
  const rng = new PyRandom(11);
  for (let i = 0; i < 300; i++) assert.equal(pickQuestion(1, rng).skill, "decades");
  for (let level = 2; level <= SKILLS.length; level++) {
    const counts = {};
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const k = pickQuestion(level, rng).skill;
      counts[k] = (counts[k] || 0) + 1;
    }
    const allowed = SKILLS.slice(0, level).map((s) => s.key);
    assert.ok(Object.keys(counts).every((k) => allowed.includes(k)), [level, counts]);
    const share = counts[SKILLS[level - 1].key] / n;
    assert.ok(Math.abs(share - 0.55) < 0.04, [level, share]);
  }
});

test("mixed level draws every skill about equally", () => {
  const rng = new PyRandom(12);
  const counts = {};
  const n = 9000;
  for (let i = 0; i < n; i++) {
    const k = pickQuestion(SKILLS.length + 1, rng).skill;
    counts[k] = (counts[k] || 0) + 1;
  }
  for (const s of SKILLS) assert.ok(Math.abs(counts[s.key] / n - 1 / SKILLS.length) < 0.02, [s.key, counts[s.key]]);
  assert.equal(levelName(10), "Mixed");
  assert.deepEqual(levelRules(10), []);
});

test("sub-type mix of the conversion skills (35 % → power, 35 % → dBm, 15 % dB → ×, 15 % × → dB)", () => {
  const rng = new PyRandom(13);
  const kinds = { power: 0, dbm: 0, ratio: 0, db: 0 };
  const n = 6000;
  for (let i = 0; i < n; i++) {
    const q = SKILLS[0].gen(rng);
    if (q.prompt.includes("dBm = ?")) kinds.power += 1;
    else if (q.unit === "dBm") kinds.dbm += 1;
    else if (q.unit === "") kinds.ratio += 1;
    else kinds.db += 1;
  }
  assert.ok(Math.abs(kinds.power / n - 0.35) < 0.03, kinds);
  assert.ok(Math.abs(kinds.dbm / n - 0.35) < 0.03, kinds);
  assert.ok(Math.abs(kinds.ratio / n - 0.15) < 0.02, kinds);
  assert.ok(Math.abs(kinds.db / n - 0.15) < 0.02, kinds);
});

test("difficulty constraints: value ranges and tolerances per skill", () => {
  const rng = new PyRandom(14);
  for (let i = 0; i < 500; i++) {
    const d = SKILLS[0].gen(rng);                          // decades: tight tolerances
    assert.ok(d.tol === 0.05 || d.tol === 0.1, d.tol);
    const p = SKILLS[1].gen(rng);
    assert.equal(p.tol, 0.2);
    const f = SKILLS[5].gen(rng);
    assert.ok(f.unit === "%" ? f.tol >= 1 : f.tol === 0.3, [f.prompt, f.tol]);
    const l = SKILLS[7].gen(rng);
    assert.ok([0.5, 0.3, 2, 0.5 / 0.35].includes(l.tol), [l.prompt, l.tol]);
    if (l.unit === "km") assert.ok(l.answer > 0);
  }
  const rng2 = new PyRandom(15);
  for (let i = 0; i < 500; i++) {
    const q = SKILLS[0].gen(rng2);
    const m = /^([−+]?\d+) dBm = \?/.exec(q.prompt);
    if (m) {
      const dbm = Number(m[1].replace(MINUS, "-"));
      assert.ok(dbm >= -60 && dbm <= 30 && dbm % 10 === 0, q.prompt);
    }
  }
});

test("rule cards: the Rules tab shows every card exactly once", () => {
  assert.deepEqual([...RULES_TAB_ORDER].sort(), Object.keys(RULES).sort());
});

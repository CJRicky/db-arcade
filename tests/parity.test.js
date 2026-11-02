// The JS port against the Python dB Arcade: formatting, worked steps, parsing, grading,
// every generator for many seeds (same seed → same question), level picks and whole game sessions.
import { test, assert, diff } from "./harness.js";
import { F, fromPython } from "./fixtures.js";
import { PyRandom } from "../web/js/pyport.js";
import { fmtNum, fmtDb, fmtPower, niceUnit, dbmSteps, powerSteps, ratioSteps, dbTerms } from "../web/js/dbmath.js";
import { parseAnswer, grade, diagnose, answerText, SKILLS, pickQuestion } from "../web/js/questions.js";
import { Game } from "../web/js/game.js";

const REL = 1e-12;   // numbers may differ in the last bits (pow/log10 of the C runtime vs V8)

test("fmtNum / fmtDb match Python", () => {
  for (const row of F.format) {
    const x = row.x;
    assert.deepEqual([fmtNum(x), fmtNum(x, 2), fmtNum(x, 1), fmtNum(x, 4)], row.fmt_num, `fmt_num ${x}`);
    assert.deepEqual([fmtDb(x, "dBm"), fmtDb(x, "dB", false), fmtDb(x, "")], row.fmt_db, `fmt_db ${x}`);
  }
});

test("fmtPower / niceUnit match Python from 1 pW to 20 W", () => {
  for (const [p, txt, unit, inUw, sig4] of F.power) {
    assert.deepEqual([fmtPower(p), niceUnit(p), fmtPower(p, "µW"), fmtPower(p, null, 4)], [txt, unit, inUw, sig4],
      `p=${p}`);
  }
});

test("worked steps match Python (dBm → power, power → dBm, ratio → dB, dB terms)", () => {
  for (const [d, steps, rule] of F.steps.dbm) assert.deepEqual(dbmSteps(d), [steps, rule], `dbm_steps(${d})`);
  for (const [m, steps, rule] of F.steps.power) assert.deepEqual(powerSteps(m), [steps, rule], `power_steps(${m})`);
  for (const [r, steps, rule] of F.steps.ratio) assert.deepEqual(ratioSteps(r), [steps, rule], `ratio_steps(${r})`);
  for (const [r, op, ...want] of F.steps.terms) assert.deepEqual(dbTerms(r, op), want, `db_terms(${r}, ${op})`);
});

test("parseAnswer accepts and rejects the same inputs as Python", () => {
  for (const [text, unit, value, error] of F.parse) {
    if (error === null) {
      assert.deepEqual(parseAnswer(text, unit), value, `parse ${JSON.stringify(text)} ${unit}`, REL);
    } else {
      let msg = null;
      try {
        parseAnswer(text, unit);
      } catch (e) {
        msg = e.message;
      }
      assert.equal(msg, error, `parse ${JSON.stringify(text)} ${unit} should fail`);
    }
  }
});

test("grade and diagnose match Python on right, close and typical wrong answers", () => {
  const qs = F.graded_questions.map(fromPython);
  for (const [i, text, verdict, value, why] of F.grade) {
    const q = qs[i];
    const [v, val] = grade(q, text);
    assert.equal(v, verdict, `grade ${q.prompt} / ${text}`);
    assert.deepEqual(val, value, `value ${q.prompt} / ${text}`, REL);
    assert.equal(diagnose(q, val), why, `diagnose ${q.prompt} / ${text}`);
  }
});

test(`every generator makes the same question as Python for the same seed (${SKILLS.length} skills)`, () => {
  let n = 0;
  for (const skill of SKILLS) {
    for (const row of F.generators[skill.key]) {
      const rng = new PyRandom(row.seed);
      const q = skill.gen(rng);
      const want = fromPython(row.q);
      const d = diff(q, want, REL);
      assert.ok(!d, `${skill.key} seed ${row.seed}: ${d}`);
      assert.equal(rng.random(), row.after, `${skill.key} seed ${row.seed}: rng consumed differently`);
      assert.equal(answerText(q), row.answer_text, `${skill.key} seed ${row.seed}: answer text`);
      n += 1;
    }
  }
  assert.ok(n >= 9 * 100, `only ${n} questions compared`);
});

test("level picks (current skill vs earlier skills vs mixed) match Python", () => {
  for (const { level, prompts } of F.pick) {
    const rng = new PyRandom(1000 + level);
    assert.deepEqual(prompts.map(() => pickQuestion(level, rng).prompt), prompts, `level ${level}`);
  }
});

test("whole game sessions (arcade, sprint, practice) match Python: scoring, lives, levels, retries", () => {
  for (const s of F.games) {
    const g = new Game(s.mode, s.level, new PyRandom(s.seed));
    s.steps.forEach((step, i) => {
      const where = `${s.mode} seed ${s.seed} step ${i}`;
      const q = g.nextQuestion();
      assert.deepEqual([q.prompt, q.isRetry, q.tries], [step.prompt, step.is_retry, step.tries], where);
      const res = g.answer(step.text, (i * 3) % 13);
      const r = step.res;
      assert.deepEqual(res, {
        verdict: r.verdict, value: r.value, points: r.points, mult: r.mult, bonus: r.bonus,
        levelUp: r.level_up, lifeGained: r.life_gained, over: r.over,
      }, where, REL);
      assert.deepEqual([g.level, g.lives, g.score, g.streak, g.bestStreak, g.levelRight, g.asked, g.right, g.over],
        step.state, where);
    });
    assert.deepEqual(g.stats, s.stats, `${s.mode} seed ${s.seed} stats`);
    assert.deepEqual(g.weakest(), s.weakest, `${s.mode} seed ${s.seed} weakest`);
  }
});

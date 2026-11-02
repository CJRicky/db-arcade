// Questions, answer parsing, grading, diagnosis and the nine skill generators.
// Port of the second half of db_core.py; every rng call happens in the same order as in Python.

import {
  MINUS, UNITS, UNIT_MW, POWER_SUFFIXES, HINTS,
  dbmToMw, mwToDbm, dbToRatio, ratioToDb, fmtNum, fmtDb, niceUnit, fmtPower,
  dbmSteps, powerSteps, dbTerms, ratioSteps,
} from "./dbmath.js";
import { pow10, pyFixed, pyMod, pyRoundInt, pySum } from "./pyport.js";

/**
 * A question. answer is the numeric answer, or the index of the right choice.
 * tol is the allowed error: dB when log, else answer units. log grades the ratio answer/user in dB.
 * chain: {nodes: [[title, value]], levels: [dBm after each node] | null, caption?}.
 * fromRatio: the answer is 10·log of a power ratio (enables the 20·log diagnosis).
 */
export function makeQuestion(skill, prompt, fields = {}) {
  return {
    skill, prompt, answer: 0.0, unit: "", kind: "num", tol: 0.1, log: false, choices: [], steps: [],
    rules: [], exact: "", note: "", chain: null, fromRatio: false, isRetry: false, tries: 0, ...fields,
  };
}

/** Raised for input that cannot be read as an answer (the game asks again, nothing is graded). */
export class AnswerError extends Error {}

const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-zµμ%]*)$/i;

/** Number typed by the user, converted to `unit`. Power answers accept SI suffixes (20u, 0.5 mW). */
export function parseAnswer(text, unit) {
  const t = String(text).trim().replaceAll(",", ".").replaceAll(MINUS, "-").replaceAll("–", "-")
    .replace(/^[x×*]+/, "").trim();
  const m = NUM_RE.exec(t);
  if (!m) throw new AnswerError("not a number");
  let value = Number(m[1]);
  const suffix = m[2].toLowerCase();
  if (unit in UNIT_MW && suffix in POWER_SUFFIXES) {
    value = value * UNIT_MW[POWER_SUFFIXES[suffix]] / UNIT_MW[unit];
  } else if (suffix && !(suffix === unit.toLowerCase() || ((unit === "dB" || unit === "dBm") &&
             (suffix === "db" || suffix === "dbm")))) {
    throw new AnswerError(`unknown unit '${m[2]}'`);
  }
  if (!Number.isFinite(value)) throw new AnswerError("number out of range");
  return value;
}

/** Returns [verdict, value]: verdict is 'right', 'close' or 'wrong'. Throws AnswerError if unreadable. */
export function grade(q, text) {
  if (q.kind === "choice") {
    if (!/^\s*[+-]?\d+\s*$/.test(String(text))) throw new AnswerError("not a choice");
    const value = parseInt(text, 10);
    return [value === q.answer ? "right" : "wrong", value];
  }
  const value = parseAnswer(text, q.unit);
  let err;
  if (q.log) {
    if (value <= 0) return ["wrong", value];
    err = Math.abs(ratioToDb(value / q.answer));
  } else {
    err = Math.abs(value - q.answer);
  }
  if (err <= q.tol + 1e-9) return ["right", value];
  if (err <= 2.5 * q.tol + 1e-9) return ["close", value];
  return ["wrong", value];
}

/** One-line guess at what went wrong with a numeric answer ('' when nothing specific fits). */
export function diagnose(q, value) {
  if (q.kind !== "num") return "";
  if (q.unit === "%") {
    if (Math.abs(q.answer - 50) > 5 && Math.abs(value - (100 - q.answer)) <= Math.max(2 * q.tol, 2)) {
      return "That is the % that remains, not the % lost (or the other way round).";
    }
    return "";
  }
  const dbUnit = q.unit === "dB" || q.unit === "dBm";
  let err;
  if (q.log) {
    if (value <= 0) return "Powers and power ratios are always positive.";
    err = ratioToDb(value / q.answer);
  } else {
    err = value - q.answer;
    const near = Math.max(2.5 * q.tol, 0.5);
    if (dbUnit && Math.abs(q.answer) > 1 && Math.abs(value + q.answer) <= near) {
      return "Sign flipped: below 1 mW is negative dBm, and a loss is a negative change.";
    }
    if (q.fromRatio && Math.abs(q.answer) > 1 && Math.abs(value - 2 * q.answer) <= near) {
      return "That is 20·log. Optical power uses 10·log: ×2 = 3 dB, not 6 dB.";
    }
    if (!dbUnit) return "";
  }
  const a = Math.abs(err);
  if (q.log && q.unit in UNIT_MW && Math.min(Math.abs(a - 30), Math.abs(a - 60)) < 0.6) {
    return `Off by ×${a < 45 ? 1000 : "1 000 000"}: check the unit prefix (mW, µW, nW are 1000× = 30 dB apart).`;
  }
  for (const n of [10, 20, 30, 40]) {
    if (Math.abs(a - n) < 0.6) {
      return `Off by ${n} dB = ×${10 ** (n / 10)}: recount the decades (each 10 dB is one ×10).`;
    }
  }
  for (const [n, f] of [[3, 2], [6, 4]]) {
    if (Math.abs(a - n) < 0.6) {
      return `Off by ${n} dB = ×${f}: check the direction. +3 dB doubles, −3 dB halves.`;
    }
  }
  if (a <= 2.5 * q.tol + 1e-9) {
    return "Right method. Tighten the last step with the anchor table (1 dB ≈ ×1.26, 2 dB ≈ ×1.6).";
  }
  return "";
}

export function answerText(q) {
  if (q.kind === "choice") return q.choices[q.answer];
  if (q.unit === "dB" || q.unit === "dBm") return fmtDb(q.answer, q.unit, q.unit === "dBm" || q.answer < 0);
  return `${fmtNum(q.answer)} ${q.unit}`.trim();
}

/** Python "{:.2f}".format(x).replace("-", MINUS) */
function fixed2(x) {
  return pyFixed(x, 2).replace("-", MINUS);
}

// ---------------------------------------------------------------- generators: basic conversions

function neighbourUnit(rng, unit) {
  const names = UNITS.slice(0, 4).map((u) => u[0]);
  const i = names.includes(unit) ? names.indexOf(unit) : 1;
  return names[Math.max(0, Math.min(names.length - 1, i + rng.choice([-1, 1])))];
}

function powerQ(skill, dbm, unit, tol) {
  const mw = dbmToMw(dbm);
  const [steps, rule] = dbmSteps(dbm);
  if (unit !== niceUnit(mw)) steps.push(`in ${unit}: ${fmtPower(mw, unit)}`);
  return makeQuestion(skill, `${fmtDb(dbm, "dBm")} = ? ${unit}`, {
    answer: mw / UNIT_MW[unit], unit, tol, log: true, steps, rules: [rule],
    exact: `exact: ${fmtDb(dbm, "dBm")} = ${fmtPower(mw, unit, 4)}`,
  });
}

function dbmQ(skill, mw, tol) {
  const dbm = mwToDbm(mw);
  const [steps, rule] = powerSteps(mw);
  return makeQuestion(skill, `${fmtPower(mw)} = ? dBm`, {
    answer: dbm, unit: "dBm", tol, steps, rules: [rule], exact: `exact: ${fixed2(dbm)} dBm`,
  });
}

function dbToRatioQ(skill, db, tol) {
  const ratio = dbToRatio(Math.abs(db));
  const prompt = db > 0 ? `${fmtNum(db)} dB gain: power × ?` : `${fmtNum(-db)} dB loss: power ÷ ?`;
  const [steps, rule] = ratioSteps(ratio);
  return makeQuestion(skill, prompt, {
    answer: ratio, unit: "", tol, log: true, steps, rules: [rule], exact: `exact: ${fmtNum(ratio, 4)}`,
  });
}

function ratioToDbQ(skill, ratio, tol) {
  const prompt = ratio >= 1 ? `Power × ${fmtNum(ratio)} = ? dB`
    : `Power ÷ ${fmtNum(1.0 / ratio)} = ? dB  (a loss, so negative)`;
  const db = ratioToDb(ratio);
  const [steps, rule] = ratioSteps(ratio);
  return makeQuestion(skill, prompt, {
    answer: db, unit: "dB", tol, steps, rules: [rule], fromRatio: true, exact: `exact: ${fixed2(db)} dB`,
  });
}

/** One of: dBm → power, power → dBm, dB → ratio, ratio → dB. */
function conversion(rng, skill, dbm, tolPower, tolDb, ratioDbs) {
  const t = rng.random();
  if (t < 0.35) {
    let unit = niceUnit(dbmToMw(dbm));
    if (rng.random() < 0.25) unit = neighbourUnit(rng, unit);
    return powerQ(skill, dbm, unit, tolPower);
  }
  if (t < 0.7) return dbmQ(skill, Number(fmtNum(dbmToMw(dbm), 2)), tolDb);
  const db = rng.choice(ratioDbs) * rng.choice([1, -1]);
  if (t < 0.85) return dbToRatioQ(skill, db, tolPower);
  return ratioToDbQ(skill, Number(fmtNum(dbToRatio(db), Math.abs(db) < 10 ? 1 : 2)), tolDb);
}

export function genDecades(rng) {
  const dbm = rng.randrange(-60, 31, 10);
  return conversion(rng, "decades", dbm, 0.05, 0.1, [10, 20, 30, 40, 50]);
}

export function genDoubling(rng) {
  const dbm = rng.randrange(-50, 21, 10) + rng.choice([3, -3, 3, -3, 6, -6]);
  return conversion(rng, "doubling", dbm, 0.2, 0.2, [3, 6, 9, 13, 23]);
}

export function genFives(rng) {
  const dbm = rng.randrange(-50, 21, 10) + rng.choice([7, -7, 3, -3, 7, -7]);
  return conversion(rng, "fives", dbm, 0.2, 0.2, [7, 13, 17, 23, 27, 37]);
}

export function genFine(rng) {
  const t = rng.random();
  if (t < 0.35) {
    const dbm = rng.randrange(-50, 21, 10) + rng.choice([1, 2, 4, 5, 6, 8, 9, -1, -2, -4]);
    return powerQ("fine", dbm, niceUnit(dbmToMw(dbm)), 0.3);
  }
  if (t < 0.7) {
    const m = rng.choice([1.25, 1.5, 2.5, 3, 4, 6, 8]);
    return dbmQ("fine", m * pow10(rng.randint(-5, 1)), 0.3);
  }
  const db = rng.choice([1, 1, 0.5, 2, 0.2]);
  const gain = rng.random() < 0.5;
  const ratio = dbToRatio(gain ? db : -db);
  const pct = Math.abs(ratio - 1) * 100;
  const sign = gain ? "+" : MINUS;
  const more = gain ? "more" : "less";
  const steps = [`${sign}${fmtNum(db)} dB = ×${fmtNum(ratio)}`,
    `×${fmtNum(ratio)} → ${sign} ${fmtNum(pct, 2)} % ${more}`];
  if (!gain) {
    steps.push(`gains grow faster than losses shrink:  +${fmtNum(db)} dB = +${fmtNum((dbToRatio(db) - 1) * 100, 2)} %,` +
      `  −${fmtNum(db)} dB = −${fmtNum(pct, 2)} %`);
  }
  return makeQuestion("fine", `${sign}${fmtNum(db)} dB → power changes by ? % ${more}`, {
    answer: pct, unit: "%", tol: Math.max(1.0, 0.1 * pct), steps, rules: ["percent"],
    exact: `exact: ${pyFixed(pct, 1)} %`,
  });
}

// ---------------------------------------------------------------- generators: losses, comparisons, sums

export function genBudget(rng) {
  const t = rng.random();
  if (t < 0.3) {
    const p = rng.randint(-5, 5);
    const nLosses = rng.randint(1, 3);
    const losses = [];
    for (let i = 0; i < nLosses; i++) losses.push(rng.choice([0.5, 1, 1.5, 3, 3.5, 5, 7, 10]));
    const total = pySum(losses);
    const out = p - total;
    const what = losses.length === 1 ? `a ${fmtDb(total, "dB", false)} attenuator`
      : "losses of " + losses.map((x) => fmtDb(x, "dB", false)).join(", ");
    const steps = [`subtract dB from dBm:  ${fmtDb(p, "dBm")} ${MINUS} ${fmtDb(total, "dB", false)} = ${fmtDb(out, "dBm")}`];
    if (losses.length > 1) {
      steps.unshift(`add the losses:  ${losses.map((x) => fmtNum(x)).join(" + ")} = ${fmtDb(total, "dB", false)}`);
    }
    if (rng.random() < 0.35 && Math.abs(pyRoundInt(out) - out) < 1e-9 && [0, 3, 7].includes(pyMod(pyRoundInt(out), 10))) {
      const unit = niceUnit(dbmToMw(out));
      const q = powerQ("budget", out, unit, 0.2);
      q.prompt = `${fmtDb(p, "dBm")} through ${what} → ? ${unit}`;
      q.steps = steps.concat(q.steps);
      q.rules = ["units"].concat(q.rules);
      return q;
    }
    return makeQuestion("budget", `${fmtDb(p, "dBm")} through ${what} → ? dBm`, {
      answer: out, unit: "dBm", tol: 0.1, steps, rules: ["units"],
    });
  }
  if (t < 0.55) {
    const n = rng.choice([2, 4, 8, 16, 32, 64, 3, 10]);
    const db = ratioToDb(n);
    const [parts, terms, approx] = dbTerms(n, "÷");
    const steps = [`1:${n} shares the power over ${n} outputs → ÷${n}`];
    steps.push(parts !== "÷" + n ? `÷${n} ≈ ${parts}  →  ${terms} = ${approx} dB` : `÷${n} = ${approx} dB`);
    if ([2, 4, 8, 16, 32, 64].includes(n)) {
      const halvings = pyRoundInt(Math.log(n) / Math.log(2));
      steps.push(`or count halvings:  ${halvings} × 3 dB = ${3 * halvings} dB`);
    }
    return makeQuestion("budget", `Ideal 1:${n} splitter: loss per output = ? dB`, {
      answer: db, unit: "dB", tol: 0.3, fromRatio: true, steps, rules: ["split"], exact: `exact: ${pyFixed(db, 2)} dB`,
    });
  }
  if (t < 0.78) {
    const db = rng.choice([0.1, 0.5, 1, 2, 3, 6, 10, 20]);
    const remain = dbToRatio(-db);
    const lost = (1 - remain) * 100;
    return makeQuestion("budget", `${fmtNum(db)} dB loss → ? % of the power is lost`, {
      answer: lost, unit: "%", tol: Math.max(0.5, 0.08 * lost),
      steps: [`${fmtNum(db)} dB loss → ×${fmtNum(remain)} remains`,
        `lost = 1 − ${fmtNum(remain)} = ${fmtNum(lost, 2)} %`],
      rules: ["percent"], exact: `exact: ${pyFixed(lost, 1)} % lost`,
    });
  }
  const pct = rng.choice([5, 10, 20, 50, 75, 80, 90, 99]);
  const rem = 1 - pct / 100.0;
  const db = -ratioToDb(rem);
  let steps = [`${pct} % lost → ${fmtNum(rem * 100)} % remains = ÷${fmtNum(1 / rem)}`];
  if (pct <= 20) {
    steps.push(`small loss:  dB ≈ % lost ÷ 23 = ${pct} ÷ 23 ≈ ${fmtNum(pct / 23.0, 2)} dB`);
  } else {
    steps = steps.concat(ratioSteps(1 / rem)[0]);
  }
  return makeQuestion("budget", `${pct} % of the power is lost → ? dB loss`, {
    answer: db, unit: "dB", fromRatio: true, tol: Math.max(0.15, 0.1 * db), steps, rules: ["percent"],
    exact: `exact: ${pyFixed(db, 2)} dB`,
  });
}

function roundRatio(r) {
  return r < 10 ? fmtNum(r, 2) : fmtNum(r, 1);
}

export function genCompare(rng) {
  const a = rng.randint(-45, 15);
  if (rng.random() < 0.5) {
    // which is bigger, and by how much?
    const sign = rng.choice([-1, 1]);
    const bMw = Number(fmtNum(dbmToMw(a + sign * rng.randint(1, 15)), 1));
    const diff = mwToDbm(bMw) - a;
    if (Math.abs(diff) < 0.5) return genCompare(rng);  // rounding b made them (nearly) equal
    const aTxt = fmtDb(a, "dBm");
    const bTxt = fmtPower(bMw);
    const bDbm = mwToDbm(bMw);
    const [big, small] = diff > 0 ? [bTxt, aTxt] : [aTxt, bTxt];
    const rightR = dbToRatio(Math.abs(diff));
    const wrongR = dbToRatio(Math.abs(diff) + (Math.abs(diff) < 4 || rng.random() < 0.5 ? 3 : -3));
    const opts = [[big, rightR, true], [big, wrongR, false], [small, rightR, false], [small, wrongR, false]];
    rng.shuffle(opts);
    const choices = opts.map(([name, r]) => `${name} is bigger, ≈ ${roundRatio(r)}×`);
    const answer = opts.findIndex((o) => o[2]);
    const steps = [`put both in dBm:  ${bTxt} ≈ ${fmtDb(bDbm, "dBm")}`,
      `difference:  ${fmtDb(Math.max(a, bDbm), "dBm")} ${MINUS} (${fmtDb(Math.min(a, bDbm), "dBm")}) = ` +
        fmtDb(Math.abs(diff), "dB", false),
      `${fmtDb(Math.abs(diff), "dB", false)} → ×${roundRatio(rightR)}`];
    return makeQuestion("compare", `Which is bigger: ${aTxt} or ${bTxt}?`, {
      answer, kind: "choice", choices, steps, rules: ["bound"],
    });
  }
  // bound first: which decade band?
  const dbm = a + rng.choice([2, 4, 5, 6, 8]);
  if (pyMod(dbm, 10) === 0) return genCompare(rng);  // a decade boundary would sit in two bands
  let mw = dbmToMw(dbm);
  let e = Math.floor(Math.log10(mw));
  const shift = rng.randint(0, 3);
  let choices;
  let prompt;
  let steps;
  if (rng.random() < 0.5) {
    const bands = [0, 1, 2, 3].map((i) => [pow10(e - shift + i), pow10(e - shift + i + 1)]);
    choices = bands.map(([lo, hi]) => `${fmtPower(lo)} – ${fmtPower(hi)}`);
    prompt = `Bound it first: ${fmtDb(dbm, "dBm")} lies between …`;
    steps = [`${fmtDb(dbm, "dBm")} is between ${fmtDb(10 * e, "dBm")} and ${fmtDb(10 * e + 10, "dBm")}`,
      `those decades are ${fmtPower(pow10(e))} and ${fmtPower(pow10(e + 1))}`];
  } else {
    mw = Number(fmtNum(mw, 1));
    e = Math.floor(Math.log10(mw));
    if (Math.abs(mw / pow10(e) - 1) < 1e-9) return genCompare(rng);  // rounded onto a decade boundary
    choices = [0, 1, 2, 3].map((i) => `${fmtDb(10 * (e - shift + i), "dBm")} … ${fmtDb(10 * (e - shift + i + 1), "dBm")}`);
    prompt = `Bound it first: ${fmtPower(mw)} lies between …`;
    steps = [`${fmtPower(mw)} is between ${fmtPower(pow10(e))} and ${fmtPower(pow10(e + 1))}`,
      `those decades are ${fmtDb(10 * e, "dBm")} and ${fmtDb(10 * e + 10, "dBm")}`];
  }
  return makeQuestion("compare", prompt, { answer: shift, kind: "choice", choices, steps, rules: ["bound"] });
}

export const SUM_NOTE = "Assume incoherent signals and an ideal, lossless combiner.";

export function genSums(rng) {
  if (rng.random() < 0.55) {
    const p = rng.randint(-20, 8);
    const delta = rng.choice([0, 0, 1, 3, 6, 10, 20]);
    const total = mwToDbm(dbmToMw(p) + dbmToMw(p - delta));
    const r = dbToRatio(-delta);
    let steps;
    if (delta === 0) {
      steps = ["equal powers → total = 2 × one of them",
        `×2 = +3 dB  →  ${fmtDb(p, "dBm")} + 3 = ${fmtDb(p + 3, "dBm")}`];
    } else {
      steps = [`the weaker is ${delta} dB down = ×${fmtNum(r, 2)} of the stronger`,
        `total = stronger × (1 + ${fmtNum(r, 2)}) = ×${fmtNum(1 + r, 3)}`,
        `×${fmtNum(1 + r, 3)} = +${fmtNum(ratioToDb(1 + r), 2)} dB  →  ${fmtDb(p, "dBm")} + ` +
          `${fmtNum(ratioToDb(1 + r), 2)} = ${fmtDb(total, "dBm")}`];
    }
    return makeQuestion("sums", `Combine ${fmtDb(p, "dBm")} and ${fmtDb(p - delta, "dBm")} → total ? dBm`, {
      answer: total, unit: "dBm", tol: 0.3, note: SUM_NOTE, steps, rules: ["sum"], exact: `exact: ${fixed2(total)} dBm`,
    });
  }
  const n = rng.choice([2, 4, 8, 10, 16, 20, 40, 48, 80, 96]);
  const per = rng.randint(-8, 3);
  const [parts, terms, approx] = dbTerms(n);
  const nLine = `${n} channels → ×${n} ≈ ${parts}  →  ${terms} = ${approx} dB`;
  if (rng.random() < 0.5) {
    const total = per + ratioToDb(n);
    return makeQuestion("sums", `${n} equal channels at ${fmtDb(per, "dBm")} each → total ? dBm`, {
      answer: total, unit: "dBm", tol: 0.4, note: SUM_NOTE, rules: ["channels"],
      steps: [nLine, `total = ${fmtDb(per, "dBm")} + ${approx} dB ≈ ${fmtDb(per + approx, "dBm")}`],
      exact: `exact: ${fixed2(total)} dBm`,
    });
  }
  const tot = pyRoundInt(per + ratioToDb(n));
  const perExact = tot - ratioToDb(n);
  return makeQuestion("sums", `Total ${fmtDb(tot, "dBm")} shared by ${n} equal channels → ? dBm per channel`, {
    answer: perExact, unit: "dBm", tol: 0.4, note: SUM_NOTE, rules: ["channels"],
    steps: [nLine, `per channel = ${fmtDb(tot, "dBm")} ${MINUS} ${approx} dB ≈ ${fmtDb(tot - approx, "dBm")}`],
    exact: `exact: ${fixed2(perExact)} dBm`,
  });
}

// ---------------------------------------------------------------- generators: link budgets

const FIBERS = [["1550 nm", 0.25, [8, 12, 16, 20, 24, 32, 40, 48, 60, 80]],
  ["1310 nm", 0.35, [10, 20, 30, 40, 50, 60]]];

function buildLink(rng) {
  const [band, alpha, kms] = rng.choice(FIBERS);
  const km = rng.choice(kms);
  const tx = rng.randint(-3, 5);
  const nConn = rng.randint(2, 4);
  const stages = [["Connectors", `${nConn} × 0.5 dB`, nConn * 0.5],
    ["Fiber " + band, `${km} km × ${alpha}`, km * alpha]];
  const explain = [`connectors:  ${nConn} × 0.5 = ${fmtNum(nConn * 0.5)} dB`,
    `fiber:  ${km} km × ${alpha} = ${fmtNum(km * alpha)} dB`];
  if (rng.random() < 0.4) {
    const n = rng.choice([2, 4, 8, 16, 32]);
    const loss = pyRoundInt(ratioToDb(n)) + 1;
    stages.push(["Splitter", `1:${n} (+1 dB excess)`, loss]);
    explain.push(`splitter:  1:${n} = ${pyFixed(ratioToDb(n), 0)} dB + 1 excess = ${loss} dB`);
  }
  if (rng.random() < 0.3) {
    const v = rng.randint(2, 10);
    stages.push(["VOA", `${v} dB`, v]);
    explain.push(`VOA:  ${v} dB`);
  }
  return { tx, band, alpha, km, stages, explain };
}

function chainOf(link, rxText, hideFiber = false) {
  const nodes = [["Tx", fmtDb(link.tx, "dBm")]];
  const levels = [link.tx];
  for (const [title, value, loss] of link.stages) {
    nodes.push([title, hideFiber && title.startsWith("Fiber") ? `? km × ${link.alpha}` : value]);
    levels.push(levels[levels.length - 1] - loss);
  }
  nodes.push(["Rx", rxText]);
  levels.push(levels[levels.length - 1]);
  return { nodes, levels };
}

export function genLinks(rng) {
  const link = buildLink(rng);
  const total = pySum(link.stages.map((s) => s[2]));
  const rx = link.tx - total;
  const budgetSteps = link.explain.concat([
    `total loss = ${fmtNum(total)} dB`,
    `Rx = ${fmtDb(link.tx, "dBm")} ${MINUS} ${fmtNum(total)} dB = ${fmtDb(rx, "dBm")}`]);
  const t = rng.random();
  if (t < 0.3) {
    let q;
    if (rng.random() < 0.3) {
      q = powerQ("links", rx, niceUnit(dbmToMw(rx)), 0.5);
      q.prompt = `What power reaches the Rx? (in ${q.unit})`;
      q.steps = budgetSteps.concat(q.steps);
      q.rules = ["link"].concat(q.rules);
    } else {
      q = makeQuestion("links", "What power reaches the Rx?", {
        answer: rx, unit: "dBm", tol: 0.5, steps: budgetSteps, rules: ["link"],
      });
    }
    q.chain = chainOf(link, "?");
    return q;
  }
  if (t < 0.5) {
    const sens = Math.floor(rx) - rng.randint(-3, 9);
    const margin = rx - sens;
    return makeQuestion("links", `Rx sensitivity is ${fmtDb(sens, "dBm")}. Margin = ? dB  (negative = link fails)`, {
      answer: margin, unit: "dB", tol: 0.5, chain: chainOf(link, `sens ${fmtDb(sens, "dBm")}`), rules: ["link"],
      steps: budgetSteps.concat([`margin = Rx − sensitivity = ${fmtDb(rx, "dBm")} ${MINUS} (${fmtDb(sens, "dBm")}) = ` +
        fmtDb(margin, "dB")]),
    });
  }
  if (t < 0.75) {
    const other = total - link.km * link.alpha;
    const sens = pyRoundInt(rx - 3 - rng.choice([0, 2, 4]));
    const fiberDb = link.tx - sens - 3 - other;
    const km = fiberDb / link.alpha;
    if (km <= 0) return genLinks(rng);
    const steps = [
      `budget = Tx − sensitivity = ${fmtDb(link.tx, "dBm")} ${MINUS} (${fmtDb(sens, "dBm")}) = ${fmtNum(link.tx - sens)} dB`,
      `other losses (connectors, splitter, VOA) = ${fmtNum(other)} dB`,
      `fiber dB = ${fmtNum(link.tx - sens)} − 3 margin − ${fmtNum(other)} = ${fmtNum(fiberDb)} dB`,
      `km = ${fmtNum(fiberDb)} ÷ ${link.alpha} = ${fmtNum(km)} km${link.alpha === 0.25 ? "    (÷ 0.25 = × 4)" : ""}`];
    const q = makeQuestion("links", `Rx sensitivity ${fmtDb(sens, "dBm")}, keep 3 dB margin: max fiber length = ? km`, {
      answer: km, unit: "km", tol: 0.5 / link.alpha, steps, rules: ["reach"],
      chain: chainOf(link, `sens ${fmtDb(sens, "dBm")}`, true),
    });
    q.chain.levels = null;
    return q;
  }
  // predict the change
  const { km, alpha } = link;
  const options = [
    [`The fiber is doubled to ${2 * km} km`, km * alpha, `extra ${km} km × ${alpha} = ${fmtNum(km * alpha)} dB loss`],
    ["A 1:4 splitter (+0.5 dB excess) is added", 6.5, "1:4 = 6 dB + 0.5 excess = 6.5 dB loss"],
    ["Tx power is raised by 2 dB", -2.0, "+2 dB at Tx = +2 dB at Rx"],
    ["Two more connectors (0.5 dB each) are added", 1.0, "2 × 0.5 = 1 dB extra loss"]];
  if (link.band === "1550 nm") {
    options.push(["The link moves to 1310 nm (0.35 dB/km)", km * 0.1,
      `${km} km × (0.35 − 0.25) = ${fmtNum(km * 0.1)} dB extra loss`]);
  }
  const [text, delta, why] = rng.choice(options);
  const next = rx - delta;
  const chain = chainOf(link, fmtDb(rx, "dBm"));
  chain.caption = "original link, before the change";
  return makeQuestion("links", `Rx reads ${fmtDb(rx, "dBm")}. ${text}. New Rx = ? dBm`, {
    answer: next, unit: "dBm", tol: 0.3, chain, rules: ["change"],
    steps: [`the change:  ${why}`,
      `new Rx = ${fmtDb(rx, "dBm")} ${delta < 0 ? "+" : MINUS} ${fmtNum(Math.abs(delta))} = ${fmtDb(next, "dBm")}`],
  });
}

// ---------------------------------------------------------------- generators: spot the error

/** [task, correct steps, rule key, [[step index, wrong text, why]]] */
function errorTemplates(rng) {
  const p = rng.randint(-15, 5);
  const d = rng.randrange(-40, 11, 10);
  const n = rng.choice([4, 8, 16]);
  const halvings = pyRoundInt(Math.log(n) / Math.log(2));
  const km = rng.choice([20, 40, 60, 80]);
  const tx = rng.randint(-2, 4);
  const rx = tx - km * 0.25 - 1;
  const pw = dbmToMw(p);
  const dw = dbmToMw(d);
  return [
    [`Combine two equal ${fmtDb(p, "dBm")} signals (incoherent).`,
      [`Each is ${fmtPower(pw)}`, `Total power = 2 × ${fmtPower(pw)} = ${fmtPower(2 * pw)}`,
        `×2 is +3 dB → ${fmtDb(p + 3, "dBm")}`], "sum",
      [[2, `Total = ${fmtDb(p, "dBm")} + ${fmtDb(p, "dBm")} = ${fmtDb(2 * p, "dBm")}`,
        "dBm values never add. Doubling the power is +3 dB."]]],
    [`Convert ${fmtDb(d - 3, "dBm")} to power.`,
      [`${fmtDb(d - 3, "dBm")} = ${fmtDb(d, "dBm")} − 3 dB`, `${fmtDb(d, "dBm")} = ${fmtPower(dw)}`,
        `−3 dB halves it → ${fmtPower(dw / 2)}`], "double",
      [[0, `${fmtDb(d - 3, "dBm")} = ${fmtDb(d, "dBm")} + 3 dB`, "Check the sign of the remainder."],
        [1, `${fmtDb(d, "dBm")} = ${fmtPower(dw / 10)}`, "Each −10 dB from 0 dBm (1 mW) is ÷10."],
        [2, `−3 dB doubles it → ${fmtPower(dw * 2)}`, "Negative dB means less power: −3 dB halves."]]],
    ["Express a power ratio of 4 in dB.",
      ["4 = 2 × 2", "Each ×2 ≈ 3 dB (10·log₁₀ 2)", "×4 → 6 dB"], "tenlog",
      [[1, "Each ×2 ≈ 6 dB (20·log₁₀ 2)", "Power ratios use 10·log₁₀; 20·log₁₀ is for field/voltage amplitudes."],
        [2, "×4 → 9 dB", "Two doublings = 3 + 3 = 6 dB."]]],
    [`Loss of an ideal 1:${n} splitter.`,
      [`${n} = ${halvings} halvings`, "Each halving = 3 dB", `Loss ≈ ${3 * halvings} dB`], "split",
      [[2, `Loss ≈ ${n} dB`, "1:N costs 10·log N dB, not N dB."],
        [1, "Each halving = 2 dB", "A halving is 3 dB."]]],
    ["A patch cord loses 20 % of the power.",
      ["80 % remains = ×0.8", "0.8 ≈ ÷1.26", "So ≈ 1 dB loss"], "percent",
      [[2, "So ≈ 20 dB loss", "20 dB would leave 1 %. 20 % lost ≈ 1 dB."],
        [0, "20 % remains = ×0.2", "If 20 % is lost, 80 % remains."]]],
    [`Tx ${fmtDb(tx, "dBm")}, ${km} km at 0.25 dB/km, two 0.5 dB connectors.`,
      [`Fiber: ${km} × 0.25 = ${fmtNum(km * 0.25)} dB`, "Connectors: 2 × 0.5 = 1 dB",
        `Rx = ${fmtDb(tx, "dBm")} − ${fmtNum(km * 0.25)} − 1 = ${fmtDb(rx, "dBm")}`], "link",
      [[2, `Rx = ${fmtDb(tx, "dBm")} − ${fmtNum(km * 0.25)} + 1 = ${fmtDb(rx + 2, "dBm")}`,
        "Connector loss is subtracted too."],
        [0, `Fiber: ${km} × 0.25 = ${fmtNum(km * 2.5)} dB`, `${km} × 0.25 = ${km} ÷ 4 = ${fmtNum(km * 0.25)} dB`]]],
    [`Add a signal 10 dB weaker to a ${fmtDb(p, "dBm")} signal.`,
      ["10 dB weaker = 1/10 of the power", "Total = 1.1 × stronger", `1.1× ≈ +0.4 dB → ${fmtDb(p + 0.4, "dBm")}`], "sum",
      [[2, `Total = ${fmtDb(p, "dBm")} + 3 dB = ${fmtDb(p + 3, "dBm")}`,
        "+3 dB only when both are equal. 10 dB weaker adds ~0.4 dB."],
        [0, "10 dB weaker = 1/2 of the power", "10 dB is ÷10; ÷2 is 3 dB."]]],
  ];
}

export function genErrors(rng) {
  const [task, steps, rule, mutations] = rng.choice(errorTemplates(rng));
  const shown = steps.slice();
  let answer;
  let explain;
  if (rng.random() < 0.25) {
    answer = 3;
    explain = ["all three steps are right"];
  } else {
    const [idx, text, why] = rng.choice(mutations);
    shown[idx] = text;
    answer = idx;
    explain = [`step ${idx + 1} is wrong:  ${text}`, why, `correct:  ${steps[idx]}`];
  }
  const prompt = `Spot the error. ${task}\n` + shown.map((s, i) => `  Step ${i + 1}: ${s}`).join("\n");
  return makeQuestion("errors", prompt, {
    answer, kind: "choice", choices: ["Step 1", "Step 2", "Step 3", "No mistake"], steps: explain, rules: [rule],
  });
}

// ---------------------------------------------------------------- skills and levels

export const SKILLS = [
  { key: "decades", name: "Decades", tagline: "0 dBm = 1 mW, 10 dB = ×10", rules: ["decade"], gen: genDecades },
  { key: "doubling", name: "Doubling", tagline: "3 dB ≈ ×2", rules: ["double"], gen: genDoubling },
  { key: "fives", name: "Fives", tagline: "7 dB ≈ ×5", rules: ["five"], gen: genFives },
  { key: "budget", name: "Loss budget", tagline: "dBm − dB, splitters, % lost", rules: ["units", "split", "percent"], gen: genBudget },
  { key: "compare", name: "Compare & bound", tagline: "which decade? which is bigger?", rules: ["bound"], gen: genCompare },
  { key: "fine", name: "Fine steps", tagline: "1 dB ≈ ×1.26, 2 dB ≈ ×1.6", rules: ["fine", "percent"], gen: genFine },
  { key: "sums", name: "Power sums", tagline: "adding signals, N channels", rules: ["sum", "channels"], gen: genSums },
  { key: "links", name: "Link budgets", tagline: "Rx power, margin, reach", rules: ["link", "reach", "change"], gen: genLinks },
  { key: "errors", name: "Spot the error", tagline: "find the classic mistakes", rules: ["units", "tenlog"], gen: genErrors },
];
export const SKILL_BY_KEY = Object.fromEntries(SKILLS.map((s) => [s.key, s]));
export const MIXED_TAGLINE = "everything, points keep growing";

export function levelName(level) {
  return level <= SKILLS.length ? SKILLS[level - 1].name : "Mixed";
}

export function levelTagline(level) {
  return level <= SKILLS.length ? SKILLS[level - 1].tagline : MIXED_TAGLINE;
}

export function levelRules(level) {
  return level <= SKILLS.length ? SKILLS[level - 1].rules.slice() : [];
}

/** Mostly the current level's skill, interleaved with earlier skills. */
export function pickQuestion(level, rng) {
  if (level > SKILLS.length) return rng.choice(SKILLS).gen(rng);
  if (level === 1 || rng.random() < 0.55) return SKILLS[level - 1].gen(rng);
  return rng.choice(SKILLS.slice(0, level - 1)).gen(rng);
}

export { HINTS };

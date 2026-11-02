// dB / dBm conversions, formatting and worked steps. Port of the first half of db_core.py.
//
// Mental model taught everywhere: 0 dBm = 1 mW, 10 dB = x10, 3 dB ~ x2, 7 dB ~ x5, 1 dB ~ x1.26.
// Any value is split into a whole decade plus a small remainder from that anchor table.

import { pow10, pyFixed, pyRound, pyRoundInt } from "./pyport.js";

export const MINUS = "−";

// Value of one unit in mW, largest first
export const UNITS = [["W", 1e3], ["mW", 1.0], ["µW", 1e-3], ["nW", 1e-6], ["pW", 1e-9]];
export const UNIT_MW = Object.fromEntries(UNITS);
export const POWER_SUFFIXES = {
  w: "W", mw: "mW", m: "mW", uw: "µW", u: "µW", "µw": "µW", "µ": "µW",
  "μw": "µW", "μ": "µW", nw: "nW", n: "nW", pw: "pW", p: "pW",
};

// (dB, rounded factor) anchors used for mental routes
export const ANCHORS = [[0, 1.0], [1, 1.26], [2, 1.6], [3, 2.0], [4, 2.5], [5, 3.16], [6, 4.0], [7, 5.0],
  [8, 6.3], [9, 8.0], [10, 10.0]];
// How each anchor is built from 3 dB and 10 dB
export const HINTS = {
  1: "≈ +26 %",
  2: "3 − 1 → ×2 ÷ 1.26",
  4: "3 + 1 → ×2 × 1.26",
  5: "half of 10 → √10",
  6: "3 + 3 → ×2 × 2",
  7: "10 − 3 → ×10 ÷ 2",
  8: "10 − 2 → ×10 ÷ 1.6",
  9: "3 + 3 + 3 → ×2 ×2 ×2",
};

// ---------------------------------------------------------------- conversions and formatting

export function dbmToMw(dbm) {
  return pow10(dbm / 10.0);
}

export function mwToDbm(mw) {
  return 10.0 * Math.log10(mw);
}

export function dbToRatio(db) {
  return pow10(db / 10.0);
}

export function ratioToDb(ratio) {
  return 10.0 * Math.log10(ratio);
}

/** x with sig significant digits, no trailing zeros. */
export function fmtNum(x, sig = 3) {
  if (x === 0) return "0";
  const digits = Math.max(sig - 1 - Math.floor(Math.log10(Math.abs(x))), 0);
  let s = pyFixed(x, digits);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.+$/, "");
  return s.replace("-", MINUS);
}

/** dB/dBm value with one decimal at most and a real minus sign, e.g. '−17 dBm', '+2.5 dB'. */
export function fmtDb(x, unit = "dB", signed = true) {
  const v = pyRound(x, 1);
  let s;
  if (v === 0) {
    s = "0";
  } else {
    s = pyFixed(v, 1);
    if (signed && !s.startsWith("-")) s = "+" + s;
    if (s.endsWith(".0")) s = s.slice(0, -2);
  }
  s = s.replace("-", MINUS);
  return s + (unit ? " " + unit : "");
}

/** Unit that puts mw in [1, 1000). */
export function niceUnit(mw) {
  for (const [name, scale] of UNITS) {
    if (mw >= scale * 0.9995) return name;
  }
  return "pW";
}

export function fmtPower(mw, unit = null, sig = 3) {
  unit = unit || niceUnit(mw);
  return fmtNum(mw / UNIT_MW[unit], sig) + " " + unit;
}

/** '× 1000' / '÷ 100' for a whole number of decades (db a multiple of 10). */
export function decadeFactor(db) {
  const n = pyRoundInt(db / 10.0);
  if (n === 0) return "× 1";
  return (n > 0 ? "× " : "÷ ") + String(10 ** Math.abs(n));
}

/** Nearest anchor [k dB, factor] for 0 <= db <= 10 (the first one wins a tie, like Python's min). */
export function anchor(db) {
  let best = ANCHORS[0];
  for (const a of ANCHORS) {
    if (Math.abs(a[0] - db) < Math.abs(best[0] - db)) best = a;
  }
  return best;
}

/** Rule card that covers anchor k dB. */
export function anchorRule(k) {
  if (k === 0 || k === 10) return "decade";
  if (k === 3 || k === 6 || k === 9) return "double";
  if (k === 7) return "five";
  return "fine";
}

/** Signed % change of a small dB step: +1 dB → '≈ +26 %', −1 dB → '≈ −21 %'. */
function pctChange(db) {
  const pct = (dbToRatio(db) - 1) * 100;
  return "≈ " + (pct > 0 ? "+" : MINUS) + pyFixed(Math.abs(pct), 0) + " %";
}

/** Rounded factor for |db| <= 5: [text, value, derivation or %]. db is signed. */
function factorText(db) {
  const a = Math.abs(db);
  let hint;
  if (a <= 1 + 1e-9) {
    hint = pctChange(db);           // small steps: the % change, with the right sign
  } else if (Math.abs(a - pyRoundInt(a)) < 1e-9) {
    hint = HINTS[pyRoundInt(a)] || "";
  } else {
    hint = "";
  }
  if (Math.abs(a - pyRoundInt(a)) < 1e-9) {
    const f = anchor(a)[1];
    return [fmtNum(f), f, hint];
  }
  const f = dbToRatio(a);
  return [fmtNum(f, 2), f, hint];
}

// ---------------------------------------------------------------- worked steps

// Preference for the remainder after picking a decade: 3s first, then 1s and 2s
const REMAINDER_COST = { 0: 0, 3: 1, 6: 2, 1: 3, 2: 4, 4: 4, 5: 5 };

/** Decade (multiple of 10 dBm) below or above dbm that leaves the easiest remainder. */
function routeDecade(dbm) {
  const lo = 10 * Math.floor(dbm / 10.0);
  const cost = (d) => REMAINDER_COST[pyRoundInt(Math.abs(dbm - d))] ?? 99;
  return cost(lo + 10) < cost(lo) ? lo + 10 : lo;
}

function decadeLine(dec) {
  if (dec === 0) return "0 dBm = 1 mW";
  return `${fmtDb(dec, "dBm")} = 1 mW ${decadeFactor(dec)} = ${fmtPower(dbmToMw(dec))}`;
}

/** dBm → power in your head: a decade, then ×/÷ a small anchor. Returns [steps, rule key]. */
export function dbmSteps(dbm) {
  const dec = routeDecade(dbm);
  const r = pyRound(dbm - dec, 2);
  if (r === 0) return [[decadeLine(dec)], "decade"];
  const base = dbmToMw(dec);
  const [ftxt, f, hint] = factorText(r);
  const op = r > 0 ? "×" : "÷";
  const steps = [
    `split:  ${fmtDb(dbm, "dBm")} = ${fmtDb(dec, "dBm")} ${r > 0 ? "+" : MINUS} ${fmtDb(Math.abs(r), "dB", false)}`,
    decadeLine(dec),
    `${fmtDb(r, "dB")} = ${op}${ftxt}${hint ? `    (${hint})` : ""}`,
    `${fmtPower(base)} ${op} ${ftxt} ≈ ${fmtPower(r > 0 ? base * f : base / f)}`,
  ];
  const k = Math.abs(r - pyRoundInt(r)) < 1e-9 ? pyRoundInt(Math.abs(r)) : 1;
  return [steps, anchorRule(k)];
}

/** value = 10^e * m with m snapped to the nearest anchor; returns [e, k dB, factor]. */
function splitLog(value) {
  let e = Math.floor(Math.log10(value) + 1e-9);
  let [k, f] = anchor(ratioToDb(value / pow10(e)));
  if (k === 10) [e, k, f] = [e + 1, 0, 1.0];
  return [e, k, f];
}

/** Power → dBm: decade in dBm plus the anchor dB of the mantissa. Returns [steps, rule key]. */
export function powerSteps(mw) {
  const [e, k, f] = splitLog(mw);
  const decDbm = 10 * e;
  const decMw = pow10(e);
  if (k === 0) {
    return [[`${fmtPower(mw)} = 1 mW ${decadeFactor(decDbm)}`,
      `each ×10 = +10 dB  →  ${fmtDb(decDbm, "dBm")}`], "decade"];
  }
  const steps = [
    `split:  ${fmtPower(mw)} = ${fmtPower(decMw)} × ${fmtNum(f)}`,
    `${fmtPower(decMw)} = ${fmtDb(decDbm, "dBm")}`,
    `×${fmtNum(f)} = +${k} dB${k in HINTS ? `    (${HINTS[k]})` : ""}`,
    `${fmtDb(decDbm, "dBm")} + ${k} dB ≈ ${fmtDb(decDbm + k, "dBm")}`,
  ];
  if (k >= 6) {
    steps.push(`or from above:  ${fmtPower(decMw * 10)} ÷ ${fmtNum(10.0 / f, 2)} → ` +
      `${fmtDb(decDbm + 10, "dBm")} ${MINUS} ${10 - k} dB = ${fmtDb(decDbm + k, "dBm")}`);
  }
  return [steps, anchorRule(k)];
}

/** Split a ratio r >= 1 into decade and anchor: ['×10 ×5', '10 + 7', 17, anchor k]. */
export function dbTerms(r, op = "×") {
  const [e, k, f] = splitLog(r);
  const parts = (e ? [op + String(10 ** e)] : []).concat(k ? [op + fmtNum(f)] : []);
  const terms = (e ? [String(10 * e)] : []).concat(k ? [String(k)] : []);
  return [parts.join(" ") || op + "1", terms.join(" + ") || "0", 10 * e + k, k];
}

/** Power ratio → dB. Ratios < 1 are losses. Returns [steps, rule key]. */
export function ratioSteps(ratio) {
  const gain = ratio >= 1;
  const r = gain ? ratio : 1.0 / ratio;
  const op = gain ? "×" : "÷";
  const exact = ratioToDb(r);
  if (Math.abs(exact - pyRoundInt(exact)) > 0.05) {
    // Not a whole dB: snapping to an anchor would teach the wrong value (÷1.12 is not 0 dB)
    const steps = [`${op}${fmtNum(r)} = ${gain ? fmtDb(exact, "dB") : fmtDb(exact, "dB loss", false)}`];
    if (Math.abs(exact - Math.floor(exact) - 0.5) < 0.05) steps.push("0.5 dB ≈ ×1.12  (+12 %)");
    return [steps, "fine"];
  }
  const [parts, terms, db, k] = dbTerms(r, op);
  const result = gain ? fmtDb(db, "dB") : fmtDb(db, "dB loss", false);
  let steps;
  if (parts === op + fmtNum(r) && !terms.includes(" + ")) {
    steps = [`${op}${fmtNum(r)} = ${result}`];
  } else {
    steps = [`split:  ${op}${fmtNum(r)} ≈ ${parts}`, `${terms} = ${result}`];
  }
  if (k in HINTS) steps.push(`×${fmtNum(anchor(k)[1])} = ${k} dB    (${HINTS[k]})`);
  return [steps, k ? anchorRule(k) : "decade"];
}

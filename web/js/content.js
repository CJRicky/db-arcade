// Rule cards and log-law tables, copied from db_core.py.

// Rule cards: key -> [title, lines]. Shown at level start, after a miss and on the Rules tab.
export const RULES = {
  decade: ["Decades", [
    "0 dBm = 1 mW",
    "+10 dB = ×10      −10 dB = ÷10",
    "−30 dBm = 1 µW    −60 dBm = 1 nW",
    "+20 dBm = 100 mW  +30 dBm = 1 W"]],
  double: ["3 dB ≈ ×2", [
    "+3 dB doubles     −3 dB halves",
    "+6 dB = ×4        +9 dB = ×8",
    "split into decade ± 3:  −17 = −20 + 3"]],
  five: ["7 dB ≈ ×5", [
    "7 dB = 10 − 3 → ×10 ÷ 2 = ×5",
    "−7 dB = ÷5",
    "think 1 – 2 – 5:  0, 3, 7 dB"]],
  fine: ["Fine steps", [
    "1 dB ≈ ×1.26   2 dB ≈ ×1.6   4 dB ≈ ×2.5",
    "5 dB ≈ ×3.16   6 dB = ×4     8 dB ≈ ×6.3",
    "0.5 dB ≈ ×1.12 (+12 %)",
    "build them from 3 and 10:  4 = 3 + 1"]],
  table: ["Anchor table", [
    "dB  ×        dB  ×",
    " 1  1.26      6  4",
    " 2  1.6       7  5",
    " 3  2         8  6.3",
    " 4  2.5       9  8",
    " 5  3.16     10  10"]],
  units: ["dB vs dBm", [
    "dBm − dB  = dBm   (power after a loss)",
    "dBm − dBm = dB    (difference, ratio)",
    "losses add in dB",
    "never add two dBm values"]],
  split: ["Splitters", [
    "1:N loss = 10·log N",
    "each halving = 3 dB",
    "1:2 = 3   1:4 = 6   1:8 = 9   1:16 = 12   1:32 = 15",
    "real splitters: + 0.5 – 1.5 dB excess"]],
  percent: ["dB ↔ %", [
    "small changes: ≈ 23 % per dB",
    "0.1 dB ≈ 2.3 %    0.5 dB ≈ 11 %",
    "1 dB loss ≈ 21 % lost    1 dB gain ≈ +26 %",
    "3 dB = 50 % lost   10 dB = 90 %   20 dB = 99 %"]],
  bound: ["Bound first", [
    "find the decade first: every 10 dB is one ×10",
    "then refine inside it: +3 dB = ×2, +7 dB = ×5",
    "difference in dB → ratio: 10 dB = ×10, 3 dB = ×2"]],
  sum: ["Adding powers", [
    "add in mW, never add dBm",
    "equal powers: +3 dB",
    "weaker by 3 dB: +1.8   6 dB: +1   10 dB: +0.4",
    "assume incoherent signals, ideal combiner"]],
  channels: ["N channels", [
    "total = per channel + 10·log N",
    "per channel = total − 10·log N",
    "40 ch = 16 dB   80 ch = 19 dB   96 ch ≈ 20 dB"]],
  link: ["Link budget", [
    "Rx = Tx − Σ losses (all in dB)",
    "fiber = km × dB/km  (0.25 @1550, 0.35 @1310)",
    "margin = Rx − sensitivity"]],
  reach: ["Max reach", [
    "budget = Tx − sensitivity",
    "fiber dB = budget − margin − other losses",
    "km = fiber dB ÷ dB/km   (÷ 0.25 = × 4)"]],
  change: ["Only the change matters", [
    "an extra X dB of loss lowers Rx by X dB",
    "+X dB at Tx raises Rx by X dB",
    "no need to redo the whole budget"]],
  tenlog: ["Power is 10·log", [
    "dB = 10·log₁₀(P₂ / P₁)",
    "×2 = 3 dB   ×4 = 6 dB   ×10 = 10 dB",
    "20·log is for field / voltage, not optical power"]],
};

// Order of the cards on the Rules tab (db_trainer.py RULES_TAB_ORDER)
export const RULES_TAB_ORDER = ["decade", "double", "five", "fine", "table", "units", "tenlog", "percent", "split",
  "bound", "sum", "channels", "link", "reach", "change"];

// Log laws tab: [law, formula, what it means in dB]. Valid for b > 0, b ≠ 1 and positive arguments.
export const LOG_LAWS = [
  ["Product", "log_b(x·y) = log_b x + log_b y", "multiply ratios → add dB"],
  ["Quotient", "log_b(x/y) = log_b x − log_b y", "dBm − dBm = dB"],
  ["Power", "log_b(xᵏ) = k·log_b x", "×4 = ×2² → 2 × 3 = 6 dB"],
  ["Root", "log_b ⁿ√x = (1/n)·log_b x", "√10 → 10 / 2 = 5 dB"],
  ["Reciprocal", "log_b(1/x) = −log_b x", "÷2 → −3 dB"],
  ["Log of one", "log_b 1 = 0", "×1 → 0 dB"],
  ["Log of the base", "log_b b = 1", "×10 → 10 dB"],
  ["Inverse", "log_b(bˣ) = x,  b^(log_b x) = x", "P₂/P₁ = 10^(ΔdB/10),  P[mW] = 10^(dBm/10)"],
  ["Change of base", "log_b x = log_a x / log_a b", "log₁₀ 2 = ln 2 / ln 10 ≈ 0.301"],
];
export const LOG_NO_SUM = [
  "log(x + y) ≠ log x + log y",
  "to add powers, go to mW, add, go back",
  "equal powers: +3 dB, not 2 × the dBm",
];
export const LOG_ER = [
  "ER [dB] = 10·log₁₀(P₁ / P₀)",
  "       = P₁ [dBm] − P₀ [dBm]",
  "here log means log₁₀",
];
export const RATIO_DB = [["1", "0"], ["2", "≈ 3"], ["4", "≈ 6"], ["10", "10"], ["100", "20"],
  ["1/2", "≈ −3"], ["1/10", "−10"]];
export const LOG_SUMMARY = "Multiply power ratios → add dB.   Divide power ratios → subtract dB.";

// Best scores and preferences in localStorage, validated field by field.
//
// Stored as one JSON object under KEY: {schema, best: {arcade, sprint}, prefs: {...}}.
// Anything missing, malformed or from another schema version falls back to the default for that
// field, so a bad or old value never breaks the game. Without localStorage (private mode, blocked
// storage) everything still works for the session and is simply not kept.

import { SKILLS } from "./questions.js";

export const KEY = "dbArcade";
export const SCHEMA = 1;

export const MODE_KEYS = ["arcade", "sprint", "practice"];
export const KEYPAD_CHOICES = ["auto", "on", "off"];
export const THEME_CHOICES = ["system", "dark", "light"];
const MAX_LEVEL = SKILLS.length + 1;

export function defaults() {
  return { schema: SCHEMA, best: {}, prefs: { mode: "arcade", level: 1, keypad: "auto", theme: "system" } };
}

/** Clean state from any parsed JSON value. */
export function sanitize(raw) {
  const state = defaults();
  if (!raw || typeof raw !== "object") return state;
  const best = raw.best && typeof raw.best === "object" ? raw.best : {};
  for (const mode of ["arcade", "sprint"]) {
    const v = best[mode];
    if (Number.isInteger(v) && v > 0 && v < 1e9) state.best[mode] = v;
  }
  const prefs = raw.prefs && typeof raw.prefs === "object" ? raw.prefs : {};
  if (MODE_KEYS.includes(prefs.mode)) state.prefs.mode = prefs.mode;
  if (Number.isInteger(prefs.level) && prefs.level >= 1 && prefs.level <= MAX_LEVEL) state.prefs.level = prefs.level;
  if (KEYPAD_CHOICES.includes(prefs.keypad)) state.prefs.keypad = prefs.keypad;
  if (THEME_CHOICES.includes(prefs.theme)) state.prefs.theme = prefs.theme;
  return state;
}

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;     // access itself can throw when site data is blocked
  }
}

export function load(storage = browserStorage()) {
  try {
    const text = storage && storage.getItem(KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return defaults();
  }
}

/** Raise each best score in `into` to the one in `from` where that is higher. */
export function mergeBest(into, from) {
  for (const [mode, score] of Object.entries(from)) {
    if (!(score <= (into[mode] || 0))) into[mode] = score;
  }
  return into;
}

/**
 * Store state. Best scores are merged with the stored ones first (per-mode maximum, written back
 * into state.best), so a second tab with an older snapshot never lowers a record.
 * Returns false when the state could not be stored (no storage, quota, blocked).
 */
export function save(state, storage = browserStorage()) {
  try {
    if (!storage) return false;
    mergeBest(state.best, load(storage).best);
    storage.setItem(KEY, JSON.stringify(sanitize(state)));
    return true;
  } catch {
    return false;
  }
}

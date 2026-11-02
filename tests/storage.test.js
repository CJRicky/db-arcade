// Persistence: validation, schema tolerance and missing storage.
import { test, assert } from "./harness.js";
import { KEY, defaults, sanitize, load, save, mergeBest } from "../web/js/storage.js";
import { updateBest } from "../web/js/game.js";

class MemoryStorage {
  constructor(init = {}) { this.data = { ...init }; }
  getItem(k) { return k in this.data ? this.data[k] : null; }
  setItem(k, v) { this.data[k] = String(v); }
}

test("round trip of best scores and preferences", () => {
  const s = new MemoryStorage();
  const state = defaults();
  state.best.arcade = 420;
  state.prefs = { mode: "sprint", level: 7, keypad: "off", theme: "dark" };
  assert.ok(save(state, s));
  assert.deepEqual(load(s), state);
});

test("missing, corrupt or foreign data falls back to defaults field by field", () => {
  assert.deepEqual(load(new MemoryStorage()), defaults());
  assert.deepEqual(load(new MemoryStorage({ [KEY]: "{not json" })), defaults());
  assert.deepEqual(load(new MemoryStorage({ [KEY]: "42" })), defaults());
  const mixed = sanitize({
    schema: 99, extra: true,
    best: { arcade: 300, sprint: -5, practice: 10 },
    prefs: { mode: "hard", level: 11, keypad: "on", theme: 3 },
  });
  assert.deepEqual(mixed.best, { arcade: 300 });
  assert.deepEqual(mixed.prefs, { mode: "arcade", level: 1, keypad: "on", theme: "system" });
  assert.equal(sanitize({ best: { arcade: 1.5 } }).best.arcade, undefined);
  assert.equal(sanitize({ prefs: { level: 10 } }).prefs.level, 10);
});

test("no storage or a throwing storage never breaks the game", () => {
  assert.deepEqual(load(null), defaults());
  assert.equal(save(defaults(), null), false);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  assert.deepEqual(load(broken), defaults());
  assert.equal(save(defaults(), broken), false);
});

test("a tab with an older snapshot never lowers another tab's best score", () => {
  const shared = new MemoryStorage();
  const a = load(shared);
  const b = load(shared);                             // both tabs opened before any game
  assert.ok(updateBest(a.best, "arcade", 1000));
  save(a, shared);
  mergeBest(b.best, load(shared).best);               // what the game does before comparing
  assert.equal(updateBest(b.best, "arcade", 100), false);
  b.prefs.theme = "light";                            // a later settings change in tab B
  const stale = load(new MemoryStorage());            // worst case: B never re-read at all
  stale.best.sprint = 50;
  save(stale, shared);
  assert.deepEqual(load(shared).best, { arcade: 1000, sprint: 50 });
  assert.deepEqual(stale.best, { arcade: 1000, sprint: 50 });   // merged back into the tab's state
});

test("updateBest keeps the best per mode like save_best (only a strictly higher score counts)", () => {
  const best = {};
  assert.equal(updateBest(best, "arcade", 0), false);
  assert.equal(updateBest(best, "arcade", 100), true);
  assert.equal(updateBest(best, "arcade", 100), false);
  assert.equal(updateBest(best, "arcade", 50), false);
  assert.deepEqual(best, { arcade: 100 });
});

// Play view: menu, game and game-over screens. Port of the Arcade tab in db_trainer.py.
//
// Flow: menu → asking → feedback → asking … → over. A right answer moves on by itself after
// AUTO_NEXT_MS (while the Play view is visible); otherwise Next / Enter continues.

import { AUTO_NEXT_MS, Game, LIVES, MODES, PER_LEVEL, SPRINT_SECONDS, updateBest } from "./game.js";
import { AnswerError, SKILLS, answerText, diagnose, levelName, levelRules, levelTagline } from "./questions.js";
import { UNIT_MW, fmtDb, fmtNum } from "./dbmath.js";
import { pyFixed } from "./pyport.js";
import { $, clear, h, ruleCard, section, stepsList } from "./dom.js";

const NEXT_GUARD_MS = 350;   // a double tap on Submit must not also skip the feedback
const POWER_UNIT_KEYS = ["pW", "nW", "µW", "mW", "W"];

export class Play {
  /**
   * store: {best, prefs}; persist(): saves it; syncBest(): reloads stored best scores into store.best;
   * visible(): true while the Play view is shown.
   */
  constructor({ store, persist, syncBest, visible }) {
    this.store = store;
    this.persist = persist;
    this.syncBest = syncBest;
    this.visible = visible;
    this.game = null;
    this.state = "menu";       // menu | asking | feedback | over
    this.t0 = 0;
    this.endTime = null;
    this.introLevel = null;    // level whose rule cards were last introduced
    this.autoId = null;
    this.autoPending = false;
    this.tickId = null;
    this.feedbackAt = 0;
    this.endArmedId = null;
    this.keypadOn = false;
    this.buildMenu();
    this.bindGame();
    this.show("menu");
  }

  // ------------------------------------------------------------ menu

  buildMenu() {
    const modes = $("modes");
    for (const [key, name] of MODES) {
      modes.append(h("label", {},
        h("input", { type: "radio", name: "mode", value: key, checked: key === this.store.prefs.mode,
          onchange: () => this.setMode(key) }),
        h("span", {}, name)));
    }
    const select = $("level");
    for (let level = 1; level <= SKILLS.length + 1; level++) {
      select.append(h("option", { value: level }, `${level}. ${levelName(level)}`));
    }
    select.value = String(this.store.prefs.level);
    select.addEventListener("change", () => {
      this.store.prefs.level = Number(select.value);
      this.persist();
      this.updatePreview();
    });
    $("start").addEventListener("click", () => this.start());
    $("again").addEventListener("click", () => this.start());
    $("to-menu").addEventListener("click", () => this.show("menu"));
    this.setMode(this.store.prefs.mode, false);
    this.updateBest();
    this.updatePreview();
  }

  setMode(mode, save = true) {
    this.store.prefs.mode = mode;
    $("mode-desc").textContent = MODES.find((m) => m[0] === mode)[2];
    if (save) this.persist();
  }

  updatePreview() {
    const level = this.store.prefs.level;
    $("level-tagline").textContent = levelTagline(level);
    $("preview-title").textContent = `Rules for Lv ${level} · ${levelName(level)}`;
    const preview = $("preview");
    clear(preview);
    const keys = levelRules(level);
    if (!keys.length) preview.append(h("p", { class: "muted" }, "All rules mixed. See the Rules tab."));
    for (const key of keys) preview.append(ruleCard(key));
  }

  updateBest() {
    const best = this.store.best;
    $("best").textContent = `Best:  Arcade ${best.arcade ?? "–"}   ·   Sprint ${best.sprint ?? "–"}`;
  }

  // ------------------------------------------------------------ game screen

  bindGame() {
    $("answer-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.onEnter();
    });
    $("action").addEventListener("click", () => this.onEnter());
    $("end").addEventListener("click", () => this.onEndButton());
    const pad = $("pad");
    // keep the caret in the answer field while tapping keys
    pad.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".key, .units button")) e.preventDefault();
    });
    pad.addEventListener("click", (e) => {
      const key = e.target.closest(".key");
      if (key) this.keypad(key.dataset.key);
    });
    const units = $("units");
    for (const unit of POWER_UNIT_KEYS) {
      units.append(h("button", { class: "btn small", type: "button", "aria-label": `unit ${unit}`,
        onclick: () => this.keypad("unit", unit) }, unit));
    }
  }

  /** Keypad on (touch layout) or off (system keyboard); keypad pref is auto | on | off. */
  setKeypad(on) {
    this.keypadOn = on;
    $("answer").setAttribute("inputmode", on ? "none" : "text");
    this.layoutPad();
  }

  layoutPad() {
    const q = this.game && this.game.question;
    const asking = this.state === "asking";
    const num = asking && q && q.kind === "num";
    $("pad").classList.toggle("keys", num && this.keypadOn);
    $("units").hidden = !(num && this.keypadOn && q.unit in UNIT_MW);
    // Choices are answered by tapping them, so the action button only appears for Next
    $("action").hidden = asking && q && q.kind === "choice";
    $("action").textContent = asking ? "Submit" : (this.game && this.game.over ? "Results" : "Next");
  }

  keypad(key, unit) {
    if (this.state !== "asking") return;
    const input = $("answer");
    const focused = document.activeElement === input;
    let start = focused ? input.selectionStart : input.value.length;
    let end = focused ? input.selectionEnd : input.value.length;
    const v = input.value;
    if (key === "back") {
      if (start === end && start > 0) start -= 1;
      input.value = v.slice(0, start) + v.slice(end);
      end = start;
    } else if (key === "sign") {
      const neg = /^\s*[-−–]/.test(v);
      input.value = neg ? v.replace(/^\s*[-−–]/, "") : "-" + v;
      start = end = Math.max(0, end + (neg ? -1 : 1));
    } else if (key === "unit") {
      input.value = v.replace(/\s*[a-zµμ]+$/i, "") + " " + unit;
      start = end = input.value.length;
    } else {
      input.value = v.slice(0, start) + key + v.slice(end);
      start = end = start + key.length;
    }
    if (focused) input.setSelectionRange(start, end);
  }

  start() {
    const mode = this.store.prefs.mode;
    this.game = new Game(mode, this.store.prefs.level);
    this.endTime = mode === "sprint" ? performance.now() + SPRINT_SECONDS * 1000 : null;
    this.introLevel = null;
    this.setBanner();
    this.show("game");
    this.next();
    if (this.endTime) this.tick();
  }

  setBanner(prefix = "") {
    const g = this.game;
    $("banner").textContent = `${prefix}Lv ${g.level} · ${levelName(g.level)}   —   ${levelTagline(g.level)}`;
  }

  /** Rule cards for a level that just started, shown in the empty feedback area. */
  showIntro() {
    const keys = levelRules(this.game.level);
    if (!keys.length) return;
    $("fb-body").append(section("Rules for this level"), h("div", { class: "cards" }, keys.map(ruleCard)));
  }

  next() {
    this.cancelAuto();
    if (this.game.over) {
      this.showOver();
      return;
    }
    const q = this.game.nextQuestion();
    this.state = "asking";
    $("question").textContent = q.prompt;
    $("note").textContent = (q.isRetry ? "↺ Retry: you missed this one earlier.   " : "") + q.note;
    const verdict = $("verdict");
    verdict.textContent = "";
    verdict.className = "verdict";
    $("diag").textContent = "";
    $("exact").textContent = "";
    clear($("fb-body"));
    if (this.introLevel !== this.game.level) {
      this.introLevel = this.game.level;
      this.showIntro();
    }
    $("hint").textContent = q.kind === "num" ? "Enter = submit   ·   Esc = end game" : "1-4 or click   ·   Esc = end game";
    this.drawChain(q.chain, false);
    const input = $("answer");
    if (q.kind === "choice") {
      $("answer-form").hidden = true;
      const choices = $("choices");
      clear(choices);
      q.choices.forEach((text, i) => choices.append(h("button", {
        class: "choice", type: "button", onclick: () => this.submit(String(i)),
      }, h("span", { class: "num", "aria-hidden": "true" }, String(i + 1)), text)));
      choices.hidden = false;
      $("question").focus({ preventScroll: true });
    } else {
      $("choices").hidden = true;
      $("answer-form").hidden = false;
      input.disabled = false;
      input.value = "";
      input.setAttribute("aria-label", `Your answer in ${q.unit || "×"}`);
      $("unit").textContent = q.unit;
      input.focus({ preventScroll: true });
    }
    this.layoutPad();
    this.updateHud();
    window.scrollTo({ top: 0 });
    this.t0 = performance.now();
  }

  submit(text) {
    if (this.state !== "asking") return;
    const g = this.game;
    const q = g.question;
    if (text === undefined) {
      text = $("answer").value;
      if (!text.trim()) return;
    }
    let res;
    try {
      res = g.answer(text, (performance.now() - this.t0) / 1000);
    } catch (e) {
      if (!(e instanceof AnswerError)) throw e;
      const verdict = $("verdict");
      verdict.textContent = "Couldn't read that. Type a number, e.g. −17, 0.5 or 20u";
      verdict.className = "verdict warn";
      return;
    }
    this.state = "feedback";
    this.feedbackAt = performance.now();
    $("answer").disabled = true;
    const practice = g.mode === "practice";
    const answer = answerText(q);
    const you = q.kind === "num" ? `   (you: ${`${fmtNum(res.value, 4)} ${q.unit}`.trim()})` : "";
    const verdict = $("verdict");
    if (res.verdict === "right") {
      const parts = [practice ? "✔  Right" : `✔  +${res.points}`];
      if (q.isRetry) parts.push("redeemed");
      if (res.mult > 1 && !practice) parts.push(`streak ×${res.mult}`);
      if (res.bonus && !practice) parts.push(`speed +${res.bonus}`);
      verdict.textContent = parts.join("   ");
      verdict.className = "verdict good";
    } else if (res.verdict === "close") {
      verdict.textContent = `≈  Close.  Answer: ${answer}${you}`;
      verdict.className = "verdict warn";
    } else {
      verdict.textContent = `✘  Answer: ${answer}${you}`;
      verdict.className = "verdict bad";
    }
    if (q.kind === "choice") {
      [...$("choices").children].forEach((b, i) => {
        b.disabled = true;
        b.classList.add(i === q.answer ? "good" : i === res.value ? "bad" : "dim");
      });
    }

    const body = $("fb-body");
    clear(body);
    const wrong = res.verdict !== "right";
    if (wrong && q.kind === "num") {
      const why = diagnose(q, res.value);
      $("diag").textContent = why ? "Why:  " + why : "Walk through the steps and check each one against the rule card below.";
    }
    body.append(section("How to solve it"), stepsList(q.steps));
    if (wrong && q.rules.length) body.append(section("Rule to use"), h("div", { class: "cards" }, q.rules.map(ruleCard)));
    $("exact").textContent = q.exact;
    this.drawChain(q.chain, true);

    if (res.levelUp) this.setBanner("LEVEL UP!  " + (res.lifeGained ? "+1 ♥   " : ""));
    this.updateHud();
    this.layoutPad();
    if (res.over) {
      $("hint").textContent = "Out of lives.   Enter = results";
    } else if (res.verdict === "right") {
      $("hint").textContent = "Enter = next";
      this.autoPending = true;
      this.autoId = setTimeout(() => this.autoNext(), AUTO_NEXT_MS[g.mode]);
    } else {
      $("hint").textContent = "Read the steps, then Enter = next";
    }
    $("action").focus({ preventScroll: true });
  }

  /** Auto-advance after a right answer, but never while another view is shown. */
  autoNext() {
    this.autoId = null;
    if (this.state === "feedback" && this.visible()) {
      this.autoPending = false;
      this.next();
    }
  }

  /** Called when the Play view becomes visible again. */
  resumed() {
    if (this.autoPending && this.state === "feedback" && this.autoId === null) {
      this.autoId = setTimeout(() => this.autoNext(), AUTO_NEXT_MS[this.game.mode]);
    }
  }

  cancelAuto() {
    if (this.autoId) clearTimeout(this.autoId);
    this.autoId = null;
    this.autoPending = false;
  }

  updateHud() {
    const g = this.game;
    $("hud-level").textContent = g.mode !== "practice" ? `Lv ${g.level} · ${levelName(g.level)}` : "Practice · " + levelName(g.level);
    const lives = $("hud-lives");
    if (g.lives !== null) {
      lives.textContent = "♥".repeat(g.lives) + "♡".repeat(Math.max(0, LIVES - g.lives));
      lives.setAttribute("aria-label", `${g.lives} ${g.lives === 1 ? "life" : "lives"}`);
    } else {
      lives.textContent = "";
      lives.removeAttribute("aria-label");
    }
    if (g.mode === "practice") {
      $("hud-score").textContent = `${g.right}/${g.asked} right`;
      $("hud-streak").textContent = "";
    } else {
      $("hud-score").textContent = `Score ${g.score}`;
      $("hud-streak").textContent = `Streak ${g.streak}${g.multiplier() > 1 ? `  ×${g.multiplier()}` : ""}`;
    }
    const value = g.mode !== "practice" ? g.levelRight : 0;
    $("progress-bar").style.width = `${(100 * value) / PER_LEVEL}%`;
    $("progress").setAttribute("aria-valuenow", String(value));
  }

  tick() {
    if (this.state === "menu" || this.state === "over" || !this.endTime) return;
    const left = (this.endTime - performance.now()) / 1000;
    if (left <= 0) {
      $("hud-timer").textContent = "0.0 s";
      this.game.timeUp();
      this.showOver();
      return;
    }
    $("hud-timer").textContent = `${left.toFixed(1)} s`;
    this.tickId = setTimeout(() => this.tick(), 100);
  }

  // ------------------------------------------------------------ link chain diagram

  drawChain(chain, reveal) {
    const box = $("chain");
    clear(box);
    box.hidden = !chain;
    if (!chain) return;
    const n = chain.nodes.length;
    const showLevels = reveal && chain.levels;
    box.append(h("ol", { "aria-label": "Link" }, chain.nodes.map(([title, value], i) => h("li", {
      class: i === 0 || i === n - 1 ? "end" : "",
    },
    h("span", { class: "node-title" }, title),
    h("span", { class: "node-value" + (value.includes("?") ? " ask" : "") }, value),
    showLevels ? h("span", { class: "node-level" }, fmtDb(chain.levels[i], "dBm")) : null))));
    if (showLevels) box.append(h("p", { class: "caption muted small" }, chain.caption || "power level after each stage"));
  }

  // ------------------------------------------------------------ game over

  showOver() {
    this.cancelAuto();
    const g = this.game;
    $("over-title").textContent = g.over ? ({ arcade: "GAME OVER", sprint: "TIME!" }[g.mode] || "PRACTICE DONE") : "ENDED";
    const answered = Object.values(g.stats).reduce((sum, [, t]) => sum + t, 0);
    const body = $("over-body");
    clear(body);
    const rows = [];
    if (g.mode !== "practice") rows.push(["Score", String(g.score)], ["Level", `${g.level} · ${levelName(g.level)}`]);
    rows.push(["Right", `${g.right}/${answered}   ${pyFixed(answered ? (100 * g.right) / answered : 0, 0)} %`],
      ["Best streak", String(g.bestStreak)]);
    body.append(h("table", { class: "stats-table" }, h("tbody", {},
      rows.map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", { class: "mono" }, v))))));
    const skillRows = SKILLS.filter((s) => s.key in g.stats).map((s) => {
      const [right, total] = g.stats[s.key];
      const cls = right === total ? "good" : right * 2 >= total ? "warn" : "bad";
      return h("tr", {}, h("td", {}, s.name),
        h("td", { class: `mono ${cls}` }, `${right}/${total}   ${pyFixed((100 * right) / total, 0).padStart(3)} %`));
    });
    if (skillRows.length) body.append(section("Per skill"), h("table", { class: "stats-table" }, h("tbody", {}, skillRows)));
    const weak = g.weakest();
    if (weak.length) {
      body.append(h("p", { class: "banner" },
        `Work on:  ${weak.slice(0, 2).map(([name]) => name).join(",  ")}    →  Practice mode or the Rules tab`));
    }
    let bestText = "";
    if (g.mode === "arcade" || g.mode === "sprint") {
      this.syncBest();
      if (updateBest(this.store.best, g.mode, g.score)) {
        bestText = "★ NEW BEST! ★";
        this.persist();
      } else {
        bestText = `Best ${g.mode}: ${this.store.best[g.mode] || 0}`;
      }
      this.updateBest();
    }
    $("over-best").textContent = bestText;
    this.show("over");
    $("again").focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ screens and keys

  show(name) {
    $("menu").hidden = name !== "menu";
    $("game").hidden = name !== "game";
    $("over").hidden = name !== "over";
    if (name !== "game") {
      this.state = name;
      this.endTime = null;
      $("hud-timer").textContent = "";
      if (this.tickId) clearTimeout(this.tickId);
      this.tickId = null;
      this.disarmEnd();
    }
    window.scrollTo({ top: 0 });
  }

  onEnter() {
    if (this.state === "menu" || this.state === "over") {
      this.start();
    } else if (this.state === "asking") {
      if (this.game.question.kind === "num") this.submit();
    } else if (this.state === "feedback") {
      if (performance.now() - this.feedbackAt >= NEXT_GUARD_MS) this.next();
    }
  }

  onDigit(i) {
    if (this.state === "asking" && this.game.question.kind === "choice" && i < this.game.question.choices.length) {
      this.submit(String(i));
    }
  }

  onEscape() {
    if (this.state === "asking" || this.state === "feedback") {
      if (this.game.asked > 1 || this.state === "feedback") this.showOver();
      else this.show("menu");
    } else if (this.state === "over") {
      this.show("menu");
    }
  }

  /** The on-screen Esc: a second tap within 3 s ends the game, so a stray tap does not. */
  onEndButton() {
    if (this.endArmedId) {
      this.disarmEnd();
      this.onEscape();
      return;
    }
    const btn = $("end");
    btn.textContent = "Tap again to end";
    btn.classList.add("armed");
    this.endArmedId = setTimeout(() => this.disarmEnd(), 3000);
  }

  disarmEnd() {
    if (this.endArmedId) clearTimeout(this.endArmedId);
    this.endArmedId = null;
    const btn = $("end");
    btn.textContent = "End";
    btn.classList.remove("armed");
  }
}

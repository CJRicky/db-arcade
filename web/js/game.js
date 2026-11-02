// Game state: modes, lives, levels, scoring and retries. Port of Game in db_core.py.

import { PyRandom } from "./pyport.js";
import { SKILLS, SKILL_BY_KEY, grade, pickQuestion } from "./questions.js";

export const LIVES = 3;
export const MAX_LIVES = 5;
export const PER_LEVEL = 5;          // right answers needed to level up
export const SPRINT_SECONDS = 90;
export const FAST_SECONDS = 10.0;    // answers faster than this earn a speed bonus
export const RETRY_GAP = 4;          // a missed question returns after this many others
export const MAX_RETRIES = 2;

export const MODES = [
  ["arcade", "Arcade", "3 lives · level up every 5 right · bonus life every 3 levels"],
  ["sprint", "Sprint", `${SPRINT_SECONDS} seconds · no lives`],
  ["practice", "Practice", "one skill · no score · mistakes come back"],
];
// Delay before a right answer moves on by itself (db_trainer.py AUTO_NEXT_MS)
export const AUTO_NEXT_MS = { arcade: 1400, sprint: 700, practice: 1400 };

/** One play session. mode: 'arcade' (lives), 'sprint' (timer kept by the UI) or 'practice'. */
export class Game {
  constructor(mode = "arcade", level = 1, rng = null) {
    this.mode = mode;
    this.rng = rng || new PyRandom();
    this.level = level;
    this.startLevel = level;
    this.lives = mode === "arcade" ? LIVES : null;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.levelRight = 0;
    this.asked = 0;
    this.right = 0;
    this.stats = {};        // skill key -> [right, total]
    this.retry = [];        // [due question number, question]
    this.over = false;
    this.question = null;
  }

  multiplier() {
    return 1 + Math.floor(Math.min(this.streak, 12) / 3);
  }

  nextQuestion() {
    this.asked += 1;
    const due = this.retry.find((item) => item[0] <= this.asked);
    if (due) {
      this.retry.splice(this.retry.indexOf(due), 1);
      this.question = due[1];
    } else if (this.mode === "practice") {
      const skill = this.level <= SKILLS.length ? SKILLS[this.level - 1] : this.rng.choice(SKILLS);
      this.question = skill.gen(this.rng);
    } else {
      this.question = pickQuestion(this.level, this.rng);
    }
    return this.question;
  }

  /** Grade text for the current question and update the game. Throws AnswerError if text is unreadable. */
  answer(text, seconds = FAST_SECONDS) {
    const q = this.question;
    const [verdict, value] = grade(q, text);
    const res = { verdict, value, points: 0, mult: 1, bonus: 0, levelUp: false, lifeGained: false, over: false };
    const st = this.stats[q.skill] || (this.stats[q.skill] = [0, 0]);
    st[1] += 1;
    const base = 10 * this.level;
    if (verdict === "right") {
      st[0] += 1;
      this.right += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      res.mult = this.multiplier();
      if (q.isRetry) {
        res.points = base;
      } else {
        res.bonus = Math.trunc(base * Math.max(0.0, FAST_SECONDS - seconds) / FAST_SECONDS);
        res.points = base * res.mult + res.bonus;
      }
      if (this.mode !== "practice") {
        this.levelRight += 1;
        if (this.levelRight >= PER_LEVEL) {
          this.level += 1;
          this.levelRight = 0;
          res.levelUp = true;
          if (this.mode === "arcade" && (this.level - this.startLevel) % 3 === 0 && this.lives < MAX_LIVES) {
            this.lives += 1;
            res.lifeGained = true;
          }
        }
      }
    } else {
      this.streak = 0;
      if (verdict === "close") {
        res.points = 2 * this.level;
      } else if (this.mode === "arcade") {
        this.lives -= 1;
        res.over = this.over = this.lives <= 0;
      }
      if (q.tries < MAX_RETRIES) {
        this.retry.push([this.asked + RETRY_GAP + 1, { ...q, isRetry: true, tries: q.tries + 1 }]);
      }
    }
    if (this.mode !== "practice") this.score += res.points;
    return res;
  }

  timeUp() {
    this.over = true;
  }

  /** [name, right, total] sorted by session accuracy, worst first (only skills with mistakes). */
  weakest() {
    const rows = Object.entries(this.stats).filter(([, [r, t]]) => r < t)
      .map(([k, [r, t]]) => [r / t, SKILL_BY_KEY[k].name, r, t]);
    rows.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || x[2] - y[2] || x[3] - y[3]);
    return rows.map(([, name, r, t]) => [name, r, t]);
  }
}

/** Record score as the best for mode if it beats it. Returns true for a new best (mutates best). */
export function updateBest(best, mode, score) {
  if (score <= (best[mode] || 0)) return false;
  best[mode] = score;
  return true;
}

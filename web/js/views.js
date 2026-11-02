// Explorer, Rules and Log laws views. Port of the matching tabs in db_trainer.py.

import { LOG_ER, LOG_LAWS, LOG_NO_SUM, LOG_SUMMARY, RATIO_DB, RULES_TAB_ORDER } from "./content.js";
import { dbToRatio, dbmSteps, dbmToMw, fmtDb, fmtNum, fmtPower, ratioSteps } from "./dbmath.js";
import { pyFixed, pyMod } from "./pyport.js";
import { clear, h, ruleCard, s, section, stepsList } from "./dom.js";

// ---------------------------------------------------------------- explorer

/** Range slider with − / + buttons for exact steps (a 90 dB slider is coarse on a phone). */
function slider(label, min, max, step, value, onInput) {
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label });
  const nudge = (dir) => {
    input.value = String(Math.min(max, Math.max(min, Number(input.value) + dir * step)));
    onInput();
  };
  input.addEventListener("input", onInput);
  const row = h("div", { class: "slider-row" },
    h("button", { class: "btn", type: "button", "aria-label": `${label}: step down`, onclick: () => nudge(-1) }, "−"),
    input,
    h("button", { class: "btn", type: "button", "aria-label": `${label}: step up`, onclick: () => nudge(1) }, "+"));
  return { row, input };
}

const LADDER_W = 400;
const ladderX = (dbm) => 16 + ((dbm + 60) / 90) * (LADDER_W - 32);

/** Fixed −60 … +30 dBm ladder: dBm above, power below, ×2 / ×5 marks in each decade. */
function ladder(dbm) {
  const y = 34;
  const items = [s("line", { x1: ladderX(-60), y1: y, x2: ladderX(30), y2: y, stroke: "var(--muted)" })];
  for (let d = -60; d <= 30; d++) {
    const x = ladderX(d);
    const r = pyMod(d, 10);
    if (r === 0) {
      const row = ((d + 60) / 10) % 2;   // stagger the power labels so they never collide
      items.push(s("line", { x1: x, y1: y - 9, x2: x, y2: y + 9, stroke: "var(--fg)", "stroke-width": 2 }),
        s("text", { x, y: y - 15, "text-anchor": "middle", fill: "var(--fg)", "font-size": 11 }, fmtDb(d, "")),
        s("text", { x, y: y + 24 + 12 * row, "text-anchor": "middle", fill: "var(--fg)", "font-size": 10.5 },
          fmtPower(dbmToMw(d))));
    } else if (r === 3 || r === 7) {
      items.push(s("line", { x1: x, y1: y - 5, x2: x, y2: y + 5, stroke: "var(--accent)" }),
        s("text", { x, y: y + 14, "text-anchor": "middle", fill: "var(--accent)", "font-size": 8 }, r === 3 ? "2" : "5"));
    } else {
      items.push(s("line", { x1: x, y1: y - 2, x2: x, y2: y + 2, stroke: "var(--muted)" }));
    }
  }
  const x = ladderX(dbm);
  items.push(s("polygon", { points: `${x},${y - 1} ${x - 7},${y - 13} ${x + 7},${y - 13}`, fill: "var(--gold)" }));
  return s("svg", { class: "ladder", viewBox: `0 0 ${LADDER_W} 74`, role: "img",
    "aria-label": `dBm ladder from −60 to +30 dBm, marker at ${fmtDb(dbm, "dBm")}` }, items);
}

export function buildExplorer(root) {
  const power = slider("Power in dBm", -60, 30, 0.5, -17, update);
  const ladderBox = h("div");
  const powerHead = h("p", { class: "readout", "aria-live": "polite" });
  const powerSteps = h("div");
  const loss = slider("Loss in dB", 0, 30, 0.1, 3, update);
  const fill = h("div", { class: "fill" });
  const bar = h("div", { class: "lossbar", "aria-hidden": "true" }, fill,
    [0.5, 0.25, 0.1].map((f) => h("div", { class: "mark", style: `left:${f * 100}%` })));
  const lossHead = h("p", { class: "readout", "aria-live": "polite" });
  const lossSteps = h("div");

  root.append(
    h("h1", { class: "title" }, "Explorer"),
    section("Power"), power.row, ladderBox,
    h("p", { class: "muted small" }, "dBm above, power below.   Blue marks: ×2 (3 dB) and ×5 (7 dB) inside each decade."),
    powerHead, powerSteps,
    section("Loss"), loss.row, bar, lossHead, lossSteps,
    section("Anchors"), h("div", { class: "cards" }, ruleCard("table"), ruleCard("percent")));

  function update() {
    const dbm = Number(power.input.value);
    const mw = dbmToMw(dbm);
    powerHead.textContent = `${fmtDb(dbm, "dBm")} = ${fmtPower(mw, null, 4)}`;
    clear(ladderBox);
    ladderBox.append(ladder(dbm));
    clear(powerSteps);
    powerSteps.append(stepsList(dbmSteps(dbm)[0]));

    const db = Number(loss.input.value);
    const remain = dbToRatio(-db);
    fill.style.width = `${remain * 100}%`;
    lossHead.textContent = `${fmtDb(db, "dB", false)} loss:  ${pyFixed(remain * 100, 1)} % remains`;
    let steps = [`×${fmtNum(remain)} remains  →  ${pyFixed((1 - remain) * 100, 1)} % lost`,
      `as a gain the same dB is ×${fmtNum(1 / remain)}`];
    if (db >= 0.5) steps = steps.concat(ratioSteps(remain)[0]);
    else steps.push("small losses: ≈ 23 % lost per dB");
    clear(lossSteps);
    lossSteps.append(stepsList(steps));
  }
  update();
}

// ---------------------------------------------------------------- rules

export function buildRules(root) {
  root.append(
    h("h1", { class: "title" }, "Rules"),
    h("p", { class: "muted" }, "Every rule the game uses. The gold title is the name shown after a miss."),
    h("div", { class: "cards" }, RULES_TAB_ORDER.map(ruleCard)));
}

// ---------------------------------------------------------------- log laws

function card(title, body, cls = "") {
  return h("div", { class: `card ${cls}` }, h("h3", { class: "card-title" }, title), body);
}

export function buildLogs(root) {
  const laws = h("div", { class: "laws" }, LOG_LAWS.map(([law, formula, db]) => h("div", { class: "law" },
    h("div", { class: "law-name" }, law),
    h("div", { class: "law-formula" }, formula),
    h("div", { class: "law-db" }, db))));
  const lines = (rows) => rows.map((line) => h("div", { class: "card-line" }, line));
  const ratios = h("table", { class: "ratio-table" }, h("tbody", {}, RATIO_DB.map(([ratio, db]) => h("tr", {},
    h("td", {}, ratio), h("td", { class: "muted" }, "→"), h("td", {}, `${db} dB`)))));
  root.append(
    h("h1", { class: "title" }, "Log laws"),
    h("p", { class: "muted" }, "Logarithm laws, and what each one means in dB. Base b > 0, b ≠ 1, arguments positive."),
    card("Laws", laws),
    h("div", { class: "cards", style: "margin-top:10px" },
      card("No rule for addition", lines(LOG_NO_SUM), "alert"),
      card("Extinction ratio", lines(LOG_ER)),
      card("Power ratio ↔ dB", ratios)),
    h("p", { class: "summary" }, LOG_SUMMARY));
}

// Entry point: views and tab bar, keyboard routing, settings, service worker and updates.

import { Play } from "./play.js";
import { buildExplorer, buildLogs, buildRules } from "./views.js";
import { KEY, KEYPAD_CHOICES, THEME_CHOICES, load, mergeBest, save } from "./storage.js";
import { $, h } from "./dom.js";

const store = load();
const persist = () => save(store);
// Re-read best scores before comparing, like save_best(): another tab may have set a higher one
const syncBest = () => mergeBest(store.best, load().best);
let view = "play";

const play = new Play({ store, persist, syncBest, visible: () => view === "play" && !document.hidden });
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    syncBest();
    play.updateBest();
  }
});
window.__dbArcade = play;   // for the browser tests (they read the current question to answer it right)
buildExplorer($("view-explorer"));
buildRules($("view-rules"));
buildLogs($("view-logs"));

// ---------------------------------------------------------------- views

function showView(name) {
  view = name;
  for (const btn of document.querySelectorAll(".tabbar button")) {
    const on = btn.dataset.view === name;
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
    $(`view-${btn.dataset.view}`).hidden = !on;
  }
  window.scrollTo({ top: 0 });
  if (name === "play") play.resumed();
}

for (const btn of document.querySelectorAll(".tabbar button")) {
  btn.addEventListener("click", () => showView(btn.dataset.view));
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && view === "play") play.resumed();
});

// ---------------------------------------------------------------- keys (db_trainer.py bindings)

document.addEventListener("keydown", (e) => {
  if (view !== "play" || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  // Buttons, links and the settings disclosure handle Enter themselves; the answer field submits its form
  const own = t.closest && t.closest("button, a, summary, textarea, input[type=text]");
  if (e.key === "Enter") {
    if (own || e.repeat) return;
    e.preventDefault();
    play.onEnter();
  } else if (e.key === "Escape") {
    e.preventDefault();
    play.onEscape();
  } else if (/^[1-4]$/.test(e.key) && !(t.matches && t.matches("input[type=text], select"))) {
    play.onDigit(Number(e.key) - 1);
  }
});

// ---------------------------------------------------------------- settings

function choiceGroup(id, name, choices, labels, current, onChange) {
  const box = $(id);
  choices.forEach((value, i) => box.append(h("label", {},
    h("input", { type: "radio", name, value, checked: value === current, onchange: () => onChange(value) }),
    h("span", {}, labels[i]))));
}

const coarse = window.matchMedia("(hover: none) and (pointer: coarse)");

function applyKeypad() {
  const pref = store.prefs.keypad;
  play.setKeypad(pref === "on" || (pref === "auto" && coarse.matches));
}

function applyTheme() {
  const theme = store.prefs.theme;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", bg || "#000000");
}

choiceGroup("keypad-choice", "keypad", KEYPAD_CHOICES, ["Auto", "On", "Off"], store.prefs.keypad, (v) => {
  store.prefs.keypad = v;
  persist();
  applyKeypad();
});
choiceGroup("theme-choice", "theme", THEME_CHOICES, ["System", "Dark", "Light"], store.prefs.theme, (v) => {
  store.prefs.theme = v;
  persist();
  applyTheme();
});
coarse.addEventListener("change", applyKeypad);
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
applyKeypad();
applyTheme();

// ---------------------------------------------------------------- service worker and updates

const status = $("app-status");

function setStatus(version, offline) {
  status.textContent = `Version ${version}.  ${offline ? "Available offline." : "Not cached for offline use yet."}`;
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) {
    status.textContent = "This browser cannot keep the game for offline use.";
    return;
  }
  // Resolved from this module, so the app works under any path (e.g. /<repository>/ on GitHub Pages)
  const url = new URL("../service-worker.js", import.meta.url);
  const scope = new URL("../", import.meta.url);
  let reg;
  try {
    reg = await navigator.serviceWorker.register(url, { scope: scope.pathname });
  } catch (err) {
    status.textContent = `Offline mode unavailable (${err.message}).`;
    return;
  }
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) window.location.reload();
  });
  const offer = () => {
    $("update").hidden = false;
  };
  $("update-reload").addEventListener("click", () => {
    // Activate whatever is waiting now. If another tab already activated the new version,
    // nothing waits any more and this page only needs a reload to load it.
    if (reg.waiting) {
      reloading = true;
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  });
  if (reg.waiting && navigator.serviceWorker.controller) offer();
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) offer();
    });
  });
  // An installed app can stay open for days: look for a new version when it comes back to the foreground
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) reg.update().catch(() => {});
  });
  setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);

  const ready = await navigator.serviceWorker.ready;
  const ask = (worker) => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data);
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    setTimeout(() => resolve(null), 2000);
  });
  const info = ready.active && await ask(ready.active);
  if (info) setStatus(info.version, info.cached);
  window.__swReady = { scope: ready.scope, version: info && info.version };
}

registerWorker();

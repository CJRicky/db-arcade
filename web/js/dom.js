// Small DOM helpers shared by the views.

import { RULES } from "./content.js";

/** Element with attributes (on* = listeners, class, text) and children (nodes or strings). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** SVG element; same conventions as h(). */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
}

export function $(id) {
  return document.getElementById(id);
}

export function clear(el) {
  el.replaceChildren();
}

/** A rule as a small card: gold bar, title, one statement per line. */
export function ruleCard(key) {
  const [title, lines] = RULES[key];
  return h("div", { class: "card" },
    h("h3", { class: "card-title" }, title),
    lines.map((line) => h("div", { class: "card-line" }, line)));
}

/** Numbered worked steps, one per row. */
export function stepsList(steps) {
  return h("ol", { class: "steps" }, steps.map((step) => h("li", {}, step)));
}

export function section(text) {
  return h("h2", { class: "section" }, text);
}

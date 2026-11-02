// Minimal test harness that runs the same test files in Node (run-node.js) and a browser (run.html).
// No dependencies, so the tests need nothing but `node` or a browser.

const registered = [];

export function test(name, fn) {
  registered.push([name, fn]);
}

export class AssertionError extends Error {}

function show(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fail(msg, note) {
  throw new AssertionError(note ? `${msg}  [${typeof note === "string" ? note : show(note)}]` : msg);
}

/** Path of the first difference between a and b ('' when equal); numbers compare with a relative tolerance. */
export function diff(a, b, rel = 1e-12, path = "") {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return "";
    return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b)) ? "" : `${path || "."}: ${a} != ${b}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path || "."}: length ${a.length} != ${b.length}  ${show(a)} vs ${show(b)}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], rel, `${path}[${i}]`);
      if (d) return d;
    }
    return "";
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = diff(a[k], b[k], rel, `${path}.${k}`);
      if (d) return d;
    }
    return "";
  }
  return a === b ? "" : `${path || "."}: ${show(a)} != ${show(b)}`;
}

export const assert = {
  ok(v, note) {
    if (!v) fail(`expected truthy, got ${show(v)}`, note);
  },
  equal(a, b, note) {
    if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) fail(`${show(a)} !== ${show(b)}`, note);
  },
  deepEqual(a, b, note, rel = 0) {
    const d = diff(a, b, rel);
    if (d) fail(d, note);
  },
  close(a, b, tol = 1e-9, note) {
    if (!(Math.abs(a - b) <= tol)) fail(`${a} not within ${tol} of ${b}`, note);
  },
  includes(text, part, note) {
    if (!String(text).includes(part)) fail(`${show(text)} does not include ${show(part)}`, note);
  },
  notIncludes(text, part, note) {
    if (String(text).includes(part)) fail(`${show(text)} includes ${show(part)}`, note);
  },
  throws(fn, pattern, note) {
    try {
      fn();
    } catch (e) {
      if (pattern && !pattern.test(e.message)) fail(`error ${show(e.message)} does not match ${pattern}`, note);
      return;
    }
    fail("expected an exception", note);
  },
};

const isNode = typeof process !== "undefined" && !!(process.versions && process.versions.node);

/** JSON file relative to the tests folder. */
export async function loadJSON(rel) {
  if (isNode) {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));
  }
  const res = await fetch(new URL(rel, import.meta.url));
  if (!res.ok) throw new Error(`fetch ${rel}: HTTP ${res.status}`);
  return res.json();
}

/** Run every registered test; log(line) receives the report. Returns {passed, failed}. */
export async function run(log = console.log) {
  let passed = 0;
  let failed = 0;
  const t0 = Date.now();
  for (const [name, fn] of registered) {
    try {
      await fn();
      passed += 1;
      log(`ok    ${name}`);
    } catch (e) {
      failed += 1;
      log(`FAIL  ${name}\n      ${e instanceof AssertionError ? e.message : e.stack || e}`);
    }
  }
  log(`\n${passed} passed, ${failed} failed  (${Date.now() - t0} ms)`);
  return { passed, failed };
}

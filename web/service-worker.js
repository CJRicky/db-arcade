// Service worker: keeps the whole app in one versioned cache and serves it cache-first, so the
// game works offline after the first visit.
//
// Updates: the deploy workflow writes the commit SHA into VERSION, so every deploy is a new worker.
// The new worker caches the new files next to the old ones and waits. The page shows "A new version
// is ready" and only switches when the player taps Reload, so a running game is never swapped out.
// Activation deletes the caches of older versions. Closing every tab/app window also switches.

const VERSION = "dev";
const PREFIX = `db-arcade:${self.registration.scope}:`;   // per scope: github.io sites share one origin
const CACHE = PREFIX + VERSION;

const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/main.js",
  "js/play.js",
  "js/views.js",
  "js/dom.js",
  "js/storage.js",
  "js/game.js",
  "js/questions.js",
  "js/dbmath.js",
  "js/content.js",
  "js/pyport.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  // cache: "reload" skips the HTTP cache, so a new version never stores files from the old one
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const navigate = req.mode === "navigate";
    const hit = await cache.match(req, { ignoreSearch: navigate });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (navigate) {
        const index = await cache.match("index.html");
        if (index) return index;
      }
      throw err;
    }
  })());
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (msg.type === "GET_VERSION" && event.ports[0]) {
    caches.open(CACHE).then((cache) => cache.keys()).then((keys) => {
      event.ports[0].postMessage({ version: VERSION, cached: keys.length >= ASSETS.length });
    });
  }
});

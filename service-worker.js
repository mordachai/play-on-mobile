/**
 * Caches only this module's own static assets (CSS/templates/icons/manifest)
 * for faster reload. Deliberately never caches or offline-serves anything
 * else — world/document data must always come from the live server, so the
 * companion app never presents stale game state as current.
 */

const CACHE_PREFIX = "play-on-mobile-static-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
// Derived from this worker's own URL rather than hardcoded, so a Foundry
// server mounted under a route prefix (e.g. /foundry/modules/...) works too.
const MODULE_ROOT = new URL("./", self.location).pathname;

const STATIC_ASSETS = [
  `${MODULE_ROOT}styles/companion.css`,
  `${MODULE_ROOT}templates/companion-sheet.hbs`,
  `${MODULE_ROOT}static/manifest.webmanifest`,
  `${MODULE_ROOT}static/icons/icon.svg`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Cache Storage is shared by the whole origin — only ever prune this
      // module's own superseded caches, never another module's or app's.
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(MODULE_ROOT) || !STATIC_ASSETS.includes(url.pathname)) return;

  // Network-first: always serve what's actually on disk when online (this is
  // an actively-developed module, cache-first was serving stale CSS/JS after
  // edits even past a SW version bump — mobile SW update checks are too
  // unreliable to depend on for dev iteration). Cache is only a fallback for
  // genuinely offline reloads.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

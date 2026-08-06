// Service worker for the standalone Krystal Assistant PWA.
//
// Same job as the Control Panel's (public/sw.js): satisfy the browser's installability criteria
// with a functional `fetch` handler, and give an offline-launchable app shell — without ever
// touching the live data path.
//
// ⚠ IT DIFFERS FROM THE PANEL'S IN THE ONE WAY THAT MATTERS, and the difference is not stylistic.
// The panel is served by kgsm-api, whose API lives under /api/ and /auth/, so a DENYLIST of those
// two prefixes is exhaustive. This surface is served BY THE LEAF IT TALKS TO, and the leaf's routes
// are UNPREFIXED AT THE ROOT — /turn, /confirm, /conversations, /tools, /health, /auth/*, /admin/*.
// A denylist there is wrong by default: every route the leaf grows is cached until someone
// remembers to add it, and a stale authenticated 200 both masks token expiry from the session layer
// and serves one person's conversation out of another's cache.
//
// So this ALLOWLISTS instead. Only the app shell and the static asset directories are ever
// intercepted; anything not named below reaches the network untouched, which is the safe default
// for a route this file has never heard of.
//
// Not a Workbox precache — Vite's content-hashed assets are cached on demand (cache-first is safe
// because their URL changes when their content does); the shell is network-first so a deploy lands
// on the next online load.

const VERSION = "v1";
const CACHE = `krystal-assistant-shell-${VERSION}`;

// The bare shell, available offline immediately after install. Hashed build assets are NOT listed
// (their names aren't known at author time) — they populate the cache on first visit.
const CORE = [
  "/",
  "/index.html",
  "/assistant.webmanifest",
  "/icons/assistant-icon-192.png",
  "/icons/assistant-icon-512.png",
  "/icons/assistant-icon-maskable-512.png",
];

// The only paths this worker may serve from cache. Directories of build output and artwork —
// every one of them static files the deploy wrote, none of them anything the leaf computes.
const CACHEABLE = ["/assets/", "/fonts/", "/icons/", "/splash/"];
const CACHEABLE_EXACT = ["/assistant.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic; tolerate a missing optional file so install never wedges the whole
      // worker over one 404.
      .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("krystal-assistant-shell-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GETs. A turn, a confirmation and a sign-out are POSTs and a conversation
  // delete is a DELETE, so they never reach the branches below — but the allowlist is what
  // actually keeps the leaf's GET routes (/conversations, /tools, /auth/me) out of the cache.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // App-shell navigations: network-first so deploys land on the next load; fall back to the
  // cached shell when offline so the installed app still opens. A sign-in returns here as a
  // navigation carrying its session in the fragment, which is never part of a cache key.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((m) => m || caches.match("/index.html")))
    );
    return;
  }

  const cacheable = CACHEABLE.some((p) => url.pathname.startsWith(p))
    || CACHEABLE_EXACT.includes(url.pathname);
  if (!cacheable) return;

  // Static assets: cache-first with a background refresh (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

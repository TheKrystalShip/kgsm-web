// Minimal service worker for the Krystal Control Panel PWA.
//
// Its job is twofold and deliberately small:
//   1. Satisfy the browser's installability criteria (a registered SW with a
//      functional `fetch` handler) so Android Chrome offers "Install app".
//   2. Give an offline-launchable app shell — without ever touching the live
//      data path.
//
// HARD RULE: we only ever intercept same-origin, non-API GET requests for the app
// shell (navigations + hashed static assets). The API (/api/*) and auth (/auth/*)
// paths are same-origin in prod but must NEVER be cached or intercepted — a stale
// authenticated 200 masks token expiry from the reactive auth layer. This is enforced
// by an explicit pathname guard below, not by the origin check alone.
//
// This is NOT a Workbox precache. Vite's content-hashed assets are cached on
// demand (cache-first, safe because their URL changes when content changes);
// index.html is network-first so a deploy is picked up on the next online load.
// A full precache (`vite-plugin-pwa`) remains a separate future enhancement.

const VERSION = "v2";
const CACHE = `krystal-shell-${VERSION}`;

// The bare shell we want available offline immediately after install. Hashed
// build assets are NOT listed here (their names aren't known at author time) —
// they populate the cache at runtime on first visit.
const CORE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/assets/tks-mark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic; tolerate a missing optional file so install never
      // wedges the whole SW over one 404.
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
            .filter((k) => k.startsWith("krystal-shell-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GETs. Everything else — POST/PATCH, cross-origin assets —
  // is left entirely to the browser.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // The API is same-origin in prod (SPA served from kgsm-api wwwroot). NEVER
  // cache or intercept it — a stale authenticated 200 masks token expiry from
  // the reactive auth layer (the overnight WS-401 root cause, socket.har
  // 2026-07-02). This must run BEFORE the navigation/asset branches.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // App-shell navigations: network-first so deploys land on next load; fall
  // back to the cached shell when offline so the installed app still opens.
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

  // Static same-origin assets (Vite-hashed JS/CSS, fonts, icons, images):
  // cache-first with a background refresh (stale-while-revalidate).
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

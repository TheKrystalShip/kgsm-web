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

// ---------------------------------------------------------------------------
// Web Push
//
// The panel's notifications reach a closed app through the browser's own push
// service. Note the constraint that shapes this code: Chrome requires
// `userVisibleOnly: true` on the subscription, so EVERY push must result in a
// visible notification — there is no silent-data-sync path here, and a handler
// that decides not to show something is a permissions violation, not a choice.
//
// On iPhone this only runs at all when the panel is installed to the Home
// Screen; Safari does not deliver push to a tab.
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  // A push with no body still has to show something — see userVisibleOnly. A
  // generic line is the honest fallback; inventing a specific event would be
  // worse than saying little.
  let payload = { title: "Krystal Ship", body: "Something happened on your fleet.", serverId: null };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Not JSON — fall back to the raw text rather than dropping the message.
    try { payload.body = event.data.text() || payload.body; } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Collapse repeats about the same server: a crash loop should replace its
      // own notification rather than stack a column of them on the lock screen.
      // The API already coalesces per (provider, server, event); this is the
      // second line of defence, on the device.
      tag: payload.serverId ? `kgsm-server-${payload.serverId}` : "kgsm",
      renotify: true,
      data: { serverId: payload.serverId || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const serverId = event.notification.data && event.notification.data.serverId;
  const target = serverId ? `/#/servers/${encodeURIComponent(serverId)}` : "/#/";

  // Focus an open panel rather than opening a second one, and take it to the
  // server the notification was about — the thing a Discord message cannot do.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if (new URL(win.url).origin !== self.location.origin) continue;
        return win.focus().then((w) => (w && "navigate" in w ? w.navigate(target) : w));
      }
      return self.clients.openWindow(target);
    })
  );
});

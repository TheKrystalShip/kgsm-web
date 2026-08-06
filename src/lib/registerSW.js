// Service-worker registration for the PWA shell.
//
// Registered ONLY in production builds: in `npm run dev` a SW would sit in front
// of Vite's HMR and serve stale modules, and the smoke suite runs the module
// graph in jsdom (no SW support). Guarding on `import.meta.env.PROD` means this
// is dead-code-eliminated from the dev/smoke path entirely.
//
// We register after `load` so the SW install never contends with first paint,
// and we keep it intentionally silent — the SW is an app-shell concern that must stay clear of the
// live data path.
//
// Each surface passes its OWN worker, because the two have different rules about what may be
// cached: the panel's (public/sw.js) denies the /api/ and /auth/ prefixes kgsm-api serves under,
// while the assistant's (public-assistant/assistant-sw.js) allowlists, because the leaf answers on
// unprefixed root paths and a denylist there would cache authenticated reads by default.
export function registerServiceWorker(script = "/sw.js") {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(script).catch(() => {
      // A failed registration must never break the app; the SPA works fine
      // un-installed. Swallow and carry on.
    });
  });
}

// Service-worker registration for the PWA shell.
//
// Registered ONLY in production builds: in `npm run dev` a SW would sit in front
// of Vite's HMR and serve stale modules, and the smoke suite runs the module
// graph in jsdom (no SW support). Guarding on `import.meta.env.PROD` means this
// is dead-code-eliminated from the dev/smoke path entirely.
//
// We register after `load` so the SW install never contends with first paint,
// and we keep it intentionally silent — the SW (see public/sw.js) is an app-shell
// concern that must stay clear of the live kgsm-api data path.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration must never break the app; the SPA works fine
      // un-installed. Swallow and carry on.
    });
  });
}

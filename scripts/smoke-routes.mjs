// Route render smoke: SSR-render every route via Vite's module graph + jsdom,
// catching throws. Effects don't run under renderToString, so this catches
// render-path crashes (undefined calls, bad destructures) — the failure mode a
// green build hides. Run: node scripts/smoke-routes.mjs
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToString } from "react-dom/server";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
const w = dom.window;
// Expose DOM globals before any app module loads (modules read window at import).
// Some globals (navigator) are read-only getters in Node — assign best-effort.
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser"]) {
  try { globalThis[k] = w[k] ?? globalThis[k]; } catch {}
}
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }));
w.scrollTo = () => {};
w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
w.cancelAnimationFrame = () => {};
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = w.ResizeObserver = RO;
globalThis.IntersectionObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

// Force fixtures (MOCK) mode + seed a logged-in admin so the shell (not the
// connect screen / LoginPage) renders. Both must be set before config.js loads.
w.localStorage.setItem("krystal:mock", "1");
w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "haru", provider: "discord", stay: true, role: "admin", id: "u_haru" }));

const ROUTES = [
  "#/", "#/servers", "#/servers?status=offline", "#/library",
  "#/alerts", "#/audit", "#/fleet", "#/discord", "#/settings", "#/assistant",
  "#/servers/valheim", "#/servers/valheim/performance", "#/servers/valheim/files",
  "#/servers/valheim/backups", "#/servers/valheim/settings",
  "#/library/valheim", "#/fleet/host-1", "#/hosts/add",
];

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
let App, fail = 0;
try {
  ({ App } = await vite.ssrLoadModule("/src/App.jsx"));
} catch (e) {
  console.error("✗ MODULE LOAD FAILED:", e.stack || e.message);
  await vite.close(); process.exit(1);
}
for (const r of ROUTES) {
  w.location.hash = r;
  try {
    const html = renderToString(React.createElement(App));
    const ok = html && html.length > 200;
    console.log(`${ok ? "✓" : "·"} ${r.padEnd(34)} ${html.length} chars`);
    if (!ok) fail++;
  } catch (e) {
    console.log(`✗ ${r.padEnd(34)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    fail++;
  }
}
await vite.close();
console.log(fail ? `\n✗ ${fail}/${ROUTES.length} route(s) failed` : `\n✓ all ${ROUTES.length} routes render without throwing`);
process.exit(fail ? 1 : 0);

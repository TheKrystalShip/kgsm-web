// Client-mount smoke: actually mount <App/> with react-dom/client in jsdom so
// useEffect / subscriptions / timers run (renderToString skips them). Catches
// effect-time crashes. Run: node scripts/smoke-mount.mjs
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "Event", "CustomEvent", "navigator"]) {
  try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {}
}
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
w.scrollTo = () => {};
w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
w.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "haru", provider: "discord", stay: true, role: "admin", id: "u_haru" }));

const errors = [];
w.addEventListener("error", (e) => errors.push("window.error: " + (e?.error?.message || e?.message)));
process.on("unhandledRejection", (r) => errors.push("unhandledRejection: " + (r?.message || r)));
const origErr = console.error;
console.error = (...a) => { const s = a.join(" "); if (!/not wrapped in act|ReactDOM.render|useLayoutEffect does nothing on the server/.test(s)) errors.push("console.error: " + s.slice(0, 160)); };

const ROUTES = ["#/", "#/servers", "#/fleet", "#/assistant", "#/servers/valheim", "#/alerts"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { App } = await vite.ssrLoadModule("/src/App.jsx");

let fail = 0;
for (const r of ROUTES) {
  errors.length = 0;
  w.location.hash = r;
  w.document.getElementById("root").innerHTML = "";
  const root = createRoot(w.document.getElementById("root"));
  try {
    root.render(React.createElement(App));
    await sleep(450);            // let effects + mock api latency (300ms) settle
    const html = w.document.getElementById("root").innerHTML;
    const ok = html.length > 200 && errors.length === 0;
    console.log(`${ok ? "✓" : "✗"} ${r.padEnd(24)} ${html.length} chars${errors.length ? "  ERRORS: " + errors.slice(0, 2).join(" | ") : ""}`);
    if (!ok) fail++;
  } catch (e) {
    console.log(`✗ ${r.padEnd(24)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    fail++;
  }
  root.unmount();
}
console.error = origErr;
await vite.close();
console.log(fail ? `\n✗ ${fail}/${ROUTES.length} failed` : `\n✓ all ${ROUTES.length} mounted + ran effects cleanly`);
process.exit(fail ? 1 : 0);

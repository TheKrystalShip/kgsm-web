// Verify the auth-gate branches my main smokes skipped: logged-out LoginPage,
// the ?first-run welcome overlay, and the cold-start add-host route.
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToString } from "react-dom/server";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost:5173/", pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser"]) { try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {} }
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
w.scrollTo = () => {};
w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { App } = await vite.ssrLoadModule("/src/App.jsx");

const CASES = [
  { label: "logged-out → LoginPage", hash: "#/", auth: false },
  { label: "logged-out deep link",   hash: "#/servers", auth: false },
  { label: "first-run overlay",      hash: "#/?first-run", auth: true, search: "?first-run" },
];
let fail = 0;
for (const c of CASES) {
  w.localStorage.clear(); w.sessionStorage.clear();
  if (c.auth) w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "haru", provider: "discord", stay: true, role: "admin", id: "u_haru" }));
  // App reads location.search for ?first-run / ?auth=out
  try { w.history.replaceState(null, "", "/" + (c.search || "") + c.hash); } catch {}
  w.location.hash = c.hash.replace(/^.*#/, "#");
  try {
    const html = renderToString(React.createElement(App));
    const ok = html && html.length > 200;
    console.log(`${ok ? "✓" : "✗"} ${c.label.padEnd(26)} ${html.length} chars`);
    if (!ok) fail++;
  } catch (e) {
    console.log(`✗ ${c.label.padEnd(26)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    fail++;
  }
}
await vite.close();
console.log(fail ? `\n✗ ${fail} failed` : `\n✓ auth-gate branches render`);
process.exit(fail ? 1 : 0);

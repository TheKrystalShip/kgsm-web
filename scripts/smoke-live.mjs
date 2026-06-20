// Live wiring smoke: point the SPA at a real kgsm-api (VITE_API_BASE) and mount
// the read-path routes in jsdom so the boot-hydrate fetch + adapters + render
// actually run against the backend. Asserts real backend data appears (not the
// fixtures) and that no route throws / falls back to the crash boundary.
//
//   Usage: KGSM_API=http://127.0.0.1:8097 node scripts/smoke-live.mjs
//   (defaults to http://127.0.0.1:8097)
import { createServer } from "vite";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";

const API = process.env.KGSM_API || "http://127.0.0.1:8097";

// Preflight: the backend must be reachable, else this smoke is meaningless.
try {
  const r = await fetch(API + "/api/v1");
  if (!r.ok) throw new Error("status " + r.status);
} catch (e) {
  console.error(`✗ backend not reachable at ${API}/api/v1 (${e.message}). Start kgsm-api first.`);
  process.exit(2);
}

// Vite reads VITE_API_BASE from .env.local — write it just for this run.
const ENV = new URL("../.env.local", import.meta.url).pathname;
const hadEnv = existsSync(ENV);
const prevEnv = hadEnv ? readFileSync(ENV, "utf8") : null;
writeFileSync(ENV, `VITE_API_BASE=${API}\n`);
const restoreEnv = () => { try { if (hadEnv) writeFileSync(ENV, prevEnv); else unlinkSync(ENV); } catch {} };

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost:5173/", pretendToBeVisual: true,
});
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "Event", "CustomEvent", "navigator", "location", "history"]) {
  try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {}
}
w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
w.scrollTo = () => {};
w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
w.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "dev", provider: "discord", stay: true, role: "admin", id: "u_dev" }));

const errors = [];
w.addEventListener("error", (e) => errors.push("window.error: " + (e?.error?.message || e?.message)));
process.on("unhandledRejection", (r) => errors.push("unhandledRejection: " + (r?.message || r)));
const origErr = console.error;
console.error = (...a) => { const s = a.join(" "); if (!/not wrapped in act|ReactDOM.render|useLayoutEffect does nothing on the server/.test(s)) errors.push("console.error: " + s.slice(0, 200)); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

let fail = 0;
try {
  const cfg = await vite.ssrLoadModule("/src/lib/config.js");
  if (!cfg.LIVE || cfg.API_V1 !== API + "/api/v1") {
    console.error(`✗ config not live: LIVE=${cfg.LIVE} API_V1=${cfg.API_V1} (expected ${API}/api/v1)`);
    fail++;
  } else {
    console.log(`✓ config wired live → ${cfg.API_V1}`);
  }

  // ---- OAuth fragment capture (mechanical) --------------------------------
  // Simulate the kgsm-api callback redirect landing on the SPA with the session
  // in the URL fragment; the SPA must parse + stash + strip it before the hash
  // router sees it (the real Discord consent round-trip is owed-to-human).
  const assertEarly = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };
  {
    const ar = await vite.ssrLoadModule("/src/lib/authRedirect.js");
    w.history.replaceState(null, "", "/#access=tok_AAA&refresh=tok_BBB");
    const cap = ar.captureOAuthFragment();
    assertEarly(cap && cap.access === "tok_AAA" && cap.refresh === "tok_BBB", "OAuth fragment parsed (access+refresh)");
    assertEarly(!String(w.location.hash || "").includes("access="), "OAuth fragment stripped from URL after capture");
    const p = ar.takePendingTokens();
    assertEarly(p && p.access === "tok_AAA", "pending tokens stashed for the session layer");
    assertEarly(ar.takePendingTokens() === null, "pending tokens are one-shot (no replay)");
    w.history.replaceState(null, "", "/#error=denied");
    const cerr = ar.captureOAuthFragment();
    assertEarly(cerr && cerr.error === "denied", "OAuth error fragment parsed (#error=denied)");
    assertEarly(ar.takeOAuthError() === "denied", "OAuth error surfaced one-shot to LoginPage");
    w.history.replaceState(null, "", "/");   // clean slate for the render phases
  }

  // ---- Phase 1: data-level honest mapping (persona-independent) -----------
  // Fetch real backend payloads and run them through the adapters; assert the
  // honest-unknown contract holds (no fabricated 0s) and the no-fabricated-meters
  // guard returns [] when the host's metrics capability is down.
  const adapt = await vite.ssrLoadModule("/src/lib/adapters.js");
  const diag = await vite.ssrLoadModule("/src/pages/DiagnosticsPage.jsx");
  const assert = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

  const rawServers = await (await fetch(API + "/api/v1/servers")).json();
  const servers = adapt.adaptServers(rawServers);
  assert(servers.length === rawServers.length && servers.length > 0, `adaptServers maps ${servers.length} server(s)`);
  assert(servers.every((s) => s.players === null), "servers: players → null (honest, not 0)");
  assert(servers.every((s) => ["online", "offline", "unknown"].includes(s.status)), "servers: status vocab remapped");
  assert(servers.every((s) => (s.metrics == null ? s.cpu === null && s.ram === null : true)), "servers: cpu/ram → null when no metrics (not 0)");
  assert(servers.every((s) => Array.isArray(s.log)), "servers: log → [] (console gap)");

  const rawHosts = await (await fetch(API + "/api/v1/hosts")).json();
  const hosts = adapt.adaptHosts(rawHosts);
  assert(hosts.length === rawHosts.length && hosts.length > 0, `adaptHosts maps ${hosts.length} host(s)`);
  assert(hosts.every((h) => typeof h.online === "boolean" && h.name != null), "hosts: status→online bool, label→name");
  assert(hosts.every((h) => h.capabilities && h.capabilities.metrics), "hosts: capabilities passthrough intact");
  // The live host's metrics capability is down → meters must be empty (no fabricated CPU/RAM bars).
  const metricsDownHost = hosts.find((h) => h.capabilities.metrics && h.capabilities.metrics.status !== "operational");
  if (metricsDownHost) {
    assert(diag.hostCapacityMeters(metricsDownHost).length === 0, "hostCapacityMeters([] when metrics down — no fabricated meters)");
  }

  // ---- Phase 2: live UI render (viewer-reachable routes) ------------------
  // Mount once, navigate via hashchange (the App's own listener). NOTE: with no
  // per-host session yet, the frontend persona is tier "none" → admin surfaces
  // (dashboard/fleet) resolve to the viewer home (servers). Those are gated
  // until the auth slice; here we verify the viewer-reachable read path renders
  // real backend data without crashing.
  const { App } = await vite.ssrLoadModule("/src/App.jsx");
  w.sessionStorage.clear();
  w.location.hash = "#/servers";
  const root = createRoot(w.document.getElementById("root"));
  root.render(React.createElement(App));
  await sleep(800);                           // boot fetch + adapters + first paint

  const nav = async (hash) => {
    w.location.hash = hash;
    w.dispatchEvent(new w.Event("hashchange"));   // App keys off location.hash, not event data
    await sleep(400);
    return w.document.getElementById("root").innerHTML;
  };

  const CASES = [
    { hash: "#/servers", must: ["factorio-test", "terraria-hardmode"], label: "Servers roster (live)" },
    { hash: "#/servers/factorio-test", must: ["factorio-test", "Players", "native"], label: "Server detail (live)" },  // "native" = runtime chip
  ];
  for (const c of CASES) {
    errors.length = 0;
    let ok = false, html = "";
    try {
      html = await nav(c.hash);
      const crashed = /Something went wrong|AppCrash|crash-screen/i.test(html);
      const missing = c.must.filter((s) => !html.includes(s));
      ok = html.length > 200 && !crashed && errors.length === 0 && missing.length === 0;
      const why = [];
      if (crashed) why.push("CRASH FALLBACK");
      if (missing.length) why.push("missing: " + missing.join(","));
      if (errors.length) why.push("errors: " + errors.slice(0, 2).join(" | "));
      console.log(`${ok ? "✓" : "✗"} ${c.label.padEnd(26)} ${html.length} chars${why.length ? "  " + why.join("; ") : ""}`);
    } catch (e) {
      console.log(`✗ ${c.label.padEnd(26)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    }
    if (!ok) fail++;
  }
  // honest-unknown is actually on screen (offline servers report no players/cpu/ram).
  const rosterHtml = await nav("#/servers");
  assert(rosterHtml.includes("—"), "roster shows '—' for unmeasured fields (honest-unknown on screen)");

  // game-name resolution ran: every server's display `game` equals the /library
  // name for its blueprint (a no-op today since curated name==id upstream, but it
  // proves the cross-store join is wired + consistent and will self-heal on
  // curation). Reads the live singleton stores App just cold-booted.
  const st = await vite.ssrLoadModule("/src/lib/stores.js");
  // The store may be a freshly-evaluated module instance still mid cold-boot —
  // wait for both lists to hydrate. resolveGameNames runs synchronously inside
  // setState's emit, so once both are populated the join is already applied.
  let svList = [], libList = [];
  for (let i = 0; i < 30; i++) {
    svList = st.serversStore.getState().list;
    libList = st.libraryStore.getState().list;
    if (svList.length && libList.length) break;
    await sleep(100);
  }
  const byId = new Map(libList.map((g) => [g.id, g.name]));
  const joinOk = libList.length > 0 && svList.length > 0 &&
    svList.every((s) => byId.has(s.blueprint) && s.game === byId.get(s.blueprint));
  assert(joinOk, `game name joined via /library by blueprint (${svList.length} servers, ${libList.length} catalog)`);

  // ---- Phase 3: gated surfaces, ungated by the /me-driven tier ------------
  // Auth is now wired: the per-host tier comes from GET /me (admin, since the
  // backend runs auth-disabled) — NOT a forced "Preview as" lens. So fleet /
  // library / audit / alerts must render without bouncing to the viewer home,
  // proving the tier resolution + persona gate work against the live backend.
  // (No `persona` key here on purpose — the gate must come from /me alone.)
  w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "dev", provider: "discord", stay: true, id: "u_dev" }));
  const FAB = /0 cores|load 0\.0|CPU 0%/;          // fabricated zero readouts must NOT appear
  const GATED = [
    { hash: "#/fleet",         label: "Fleet (admin)",        must: ["Fleet"] },
    { hash: "#/fleet/hotrod",  label: "Host deep-dive (admin)", must: ["hotrod"], noFab: true },
    { hash: "#/library",       label: "Library (admin, live)", must: ["Catalog"] },
    { hash: "#/audit",         label: "Audit (admin, 500→empty)", must: [] },
    { hash: "#/alerts",        label: "Alerts (admin, live empty)", must: [] },
  ];
  for (const c of GATED) {
    errors.length = 0;
    let ok = false, html = "";
    try {
      html = await nav(c.hash);
      const txt = html.replace(/<[^>]+>/g, " ");
      const crashed = /Something went wrong|AppCrash|crash-screen/i.test(html);
      const redirected = txt.includes("installed ·");      // bounced to the servers home
      const missing = c.must.filter((s) => !html.includes(s));
      const fab = c.noFab && FAB.test(txt);
      ok = html.length > 200 && !crashed && !redirected && !fab && errors.length === 0 && missing.length === 0;
      const why = [];
      if (crashed) why.push("CRASH");
      if (redirected) why.push("redirected→servers");
      if (fab) why.push("FABRICATED ZEROS");
      if (missing.length) why.push("missing: " + missing.join(","));
      if (errors.length) why.push("errors: " + errors.slice(0, 2).join(" | "));
      console.log(`${ok ? "✓" : "✗"} ${c.label.padEnd(26)} ${html.length} chars${why.length ? "  " + why.join("; ") : ""}`);
    } catch (e) {
      console.log(`✗ ${c.label.padEnd(26)} THROW: ${(e.message || e).toString().split("\n")[0]}`);
    }
    if (!ok) fail++;
  }
  // alerts must NOT carry the demo fixtures in live mode (they'd read as real).
  const alertsHtml = await nav("#/alerts");
  assert(!/won.t stay up|backups 94% full|zombie/i.test(alertsHtml), "alerts: no fixture leakage in live mode");

  // GamePage instances are scoped by blueprint, not the null===null match-all:
  // the factorio blueprint detail must list factorio-test and NOT terraria-hardmode.
  const bpHtml = await nav("#/library/factorio");
  assert(bpHtml.includes("factorio-test") && !bpHtml.includes("terraria-hardmode"),
    "GamePage instances scoped by blueprint (factorio shows factorio-test, not terraria)");

  // Library cards share the same blueprint join: factorio + terraria each have 1
  // instance → "1 server" must appear, and the match-all "2 servers" must NOT.
  const libHtml2 = await nav("#/library");
  assert(libHtml2.includes("1 server") && !libHtml2.includes("2 servers"),
    "library cards count per blueprint (1 each, not the match-all 2)");

  // The gate is driven by the /me tier, not a persona override: confirm the live
  // host's session resolved to admin (auth-disabled → admin) from GET /me.
  const ss = await vite.ssrLoadModule("/src/lib/sessionStore.js");
  const hid = (st.hostsStore.getState().list[0] || {}).id;
  let tier = null;
  for (let i = 0; i < 30; i++) { tier = ss.sessionStore.tierOf(hid); if (tier && tier !== "none") break; await sleep(100); }
  assert(tier === "admin", `tier resolved from GET /me (${hid} → ${tier}); gates via /me, not a persona lens`);
  root.unmount();
} finally {
  console.error = origErr;
  await vite.close();
  restoreEnv();
}
console.log(fail ? `\n✗ ${fail} live check(s) failed` : `\n✓ live wiring verified against ${API}`);
process.exit(fail ? 1 : 0);

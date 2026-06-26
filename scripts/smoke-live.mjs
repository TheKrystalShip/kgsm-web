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

// The instance name this smoke emits SYNTHETIC `instance-started` events for, to drive
// the live audit/realtime checks below. The audit log is append-only and persistent, so
// these rows outlive the run — they MUST NOT masquerade as a real game-server start.
// Using an obviously-synthetic name (not a real instance like factorio-test) keeps the
// pipeline test honest: a `server.start` row for "__smoke_probe__" reads as test data,
// never a phantom factorio-test start in the operator's audit trail. kgsm `events emit`
// does not validate the name, so no such instance need exist.
const AUDIT_PROBE = "__smoke_probe__";

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
  // "Live" = at least one resolved connection (the VITE_API_BASE seed). config.js dropped
  // the old LIVE/MOCK duality, so CONNECTIONS is the only signal (cfg.LIVE is gone — the
  // old check silently always-failed, swallowed by the console.error wrapper).
  if (!cfg.CONNECTIONS || cfg.CONNECTIONS.length < 1 || cfg.API_V1 !== API + "/api/v1") {
    console.error(`✗ config not live: CONNECTIONS=${cfg.CONNECTIONS && cfg.CONNECTIONS.length} API_V1=${cfg.API_V1} (expected ${API}/api/v1)`);
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

  // ---- connect-at-login: probe the REAL backend (not the stub) ------------
  // smoke-offline unit-tests connectHost with a stubbed fetch; this proves it
  // against the live API's actual shapes (handshake + /me + /hosts) — the real
  // exchange a browser performs on the connect screen (minus the reload). Catches
  // stub-vs-reality drift in the probe.
  const conn = await vite.ssrLoadModule("/src/lib/connect.js");
  const cr = await conn.connectHost(API);   // real global fetch → the running backend
  assert(cr.status === "ok", `connectHost(real backend) → ok (handshake + /me resolved)`);
  assert(cr.hostId && typeof cr.hostId === "string", `connectHost: real host id probed from GET /hosts (${cr.hostId})`);
  assert(cr.user && cr.user.provider === "discord" && cr.tier, `connectHost: identity + tier resolved from /me (tier=${cr.tier})`);

  const rawServers = await (await fetch(API + "/api/v1/servers")).json();
  const servers = adapt.adaptServers(rawServers);
  assert(servers.length === rawServers.length && servers.length > 0, `adaptServers maps ${servers.length} server(s)`);
  assert(servers.every((s) => s.players === null), "servers: players → null (honest, not 0)");
  assert(servers.every((s) => ["online", "offline", "unknown"].includes(s.status)), "servers: status vocab remapped");
  assert(servers.every((s) => (s.metrics == null ? s.cpu === null && s.ram === null : true)), "servers: cpu/ram → null when no metrics (not 0)");
  assert(servers.every((s) => Array.isArray(s.log)), "servers: log → [] (console is a separate endpoint, not on the server DTO)");

  const rawHosts = await (await fetch(API + "/api/v1/hosts")).json();
  const hosts = adapt.adaptHosts(rawHosts);
  assert(hosts.length === rawHosts.length && hosts.length > 0, `adaptHosts maps ${hosts.length} host(s)`);
  assert(hosts.every((h) => typeof h.online === "boolean" && h.name != null), "hosts: status→online bool, label→name");
  assert(hosts.every((h) => h.capabilities && h.capabilities.metrics), "hosts: capabilities passthrough intact");
  // Diagnostics B-enrichment: when the metrics capability is operational (a live monitor), the adapter
  // maps the full snapshot — per-core, load, swap, fs, disk-IO, interfaces, hostname, uptime — AND keeps
  // every unsourced field honestly null/"—", never a fabricated 0°C / SMART "ok" / iface address.
  const opHost = hosts.find((h) => h.capabilities.metrics && h.capabilities.metrics.status === "operational");
  if (opHost) {
    assert(diag.hostCapacityMeters(opHost).length === 3, "hostCapacityMeters → 3 real meters when metrics operational (live monitor)");
    assert(Array.isArray(opHost.cpu.per_core) && opHost.cpu.per_core.length > 0 && opHost.cpu.cores === opHost.cpu.per_core.length,
      `host cpu: per_core[${opHost.cpu.per_core.length}] mapped + cores derived from it`);
    assert(Array.isArray(opHost.cpu.load_avg) && opHost.cpu.load_avg.length === 3, "host cpu: load_avg [1m,5m,15m] mapped");
    assert(opHost.ram.total_gb > 0 && opHost.ram.free_gb != null && opHost.ram.swap_total_gb != null, "host mem: total/free/swap mapped");
    assert(opHost.disks.length > 0 && opHost.disks.every((d) => d.fs && d.fs !== "—"), "host disks: filesystem type mapped");
    assert(typeof opHost.hostname === "string" && opHost.hostname.length > 0 && opHost.boot_time != null,
      "host: hostname + boot_time (derived from uptime) mapped");
    assert(Array.isArray(opHost.network.interfaces) && opHost.network.interfaces.length > 0
           && opHost.network.interfaces.every((i) => typeof i.rx_kbps === "number"),
      "host net: interface throughput mapped (bytes/s → kbps)");
    // M-diag depth (Monitor.Contracts 1.1.0) is now SOURCED — the adapter stopped discarding cpu identity,
    // sensors, mem cached/buffers, disk device, iface mac. Assert they're real…
    assert(typeof opHost.cpu.model === "string" && opHost.cpu.model !== "—",
      "host cpu: model sourced (M-diag depth — not the '—' placeholder)");
    assert(Array.isArray(opHost.sensors) && opHost.sensors.length > 0 && opHost.sensors.every((s) => typeof s.value_c === "number"),
      "host sensors: hwmon temps sourced (real °C, not a hidden temp KPI)");
    assert(opHost.ram.cached_gb != null && opHost.ram.buffers_gb != null, "host mem: cached/buffers sourced (M-diag depth)");
    assert(opHost.disks.every((d) => d.device && d.device !== "—"), "host disks: backing-device model sourced");
    assert(opHost.network.interfaces.every((i) => i.mac != null), "host net: interface MAC sourced");
    // …while the fields that STILL have no honest source stay null/"—" beside the real data.
    assert(opHost.cpu.temp_c === null, "host cpu: temp_c stays null (temps live in sensors, never a fabricated cpu field)");
    assert(opHost.disks.every((d) => d.smart === null) && opHost.network.interfaces.every((i) => i.ip === null),
      "host: SMART health / iface IP honest-null (no source → no fabricated claim or address)");
  } else {
    // Metrics capability down → meters must be empty (no fabricated CPU/RAM bars).
    assert(diag.hostCapacityMeters(hosts[0]).length === 0, "hostCapacityMeters([] when metrics down — no fabricated meters)");
  }

  // Alerts adapter: the API carries no `icon` (presentation, not a measured
  // fact) → derive one from the honest source/severity, pass everything else
  // through. Deterministic (live /alerts is empty until a crash fires), so feed
  // a synthetic watchdog crash record and assert the derive + passthrough.
  const adaptedAlerts = adapt.adaptAlerts({ data: [
    { id: "crash:x", severity: "danger", source: "watchdog", title: "t", detail: "d",
      serverId: "x", hostId: "h", status: "firing", raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 1 },
  ] });
  assert(adaptedAlerts.length === 1 && adaptedAlerts[0].icon === "alert-triangle" && adaptedAlerts[0].status === "firing",
    "adaptAlerts derives an icon from source + passes status through");

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
    { hash: "#/audit",         label: "Audit (admin, live)", must: [] },
    { hash: "#/alerts",        label: "Alerts (admin, live)", must: [] },
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
  // Diagnostics honesty: the host process LIST has no source (§9 C-gap), so the deep-dive must render
  // the honest "no process source" state — NOT a populated-looking Processes card reading "0" (which
  // would be a fabricated "this host has zero processes" claim, the same class as the hidden temp KPI).
  const deepHtml = await nav("#/fleet/hotrod");
  assert(deepHtml.includes("expose a process list"),
    "host deep-dive: Processes shows honest 'no process source' (not a fabricated 0-row table)");

  // alerts must NOT carry the demo fixtures in live mode (they'd read as real).
  const alertsHtml = await nav("#/alerts");
  assert(!/won.t stay up|backups 94% full|zombie/i.test(alertsHtml), "alerts: no fixture leakage in live mode");

  // Alerts read is now wired live (was deliberately empty before this slice):
  // the store hydrates from GET /alerts (firing + 24h resolved), so its feed must
  // match the live count exactly — proving the fetch ran and no fixtures leaked.
  const aApi = await vite.ssrLoadModule("/src/lib/alertsApi.js");
  await aApi.alertsStore.refresh().catch(() => {});
  const rawAlerts = await (await fetch(API + "/api/v1/alerts")).json();
  const liveAlertCount = (rawAlerts.data || []).length;
  assert(typeof aApi.alertsStore.refresh === "function", "alertsStore.refresh wired (live hydrate)");
  assert(aApi.alertsStore.getState().list.length === liveAlertCount,
    `alerts hydrated from GET /alerts (${liveAlertCount} live, no fixtures)`);

  // Render-with-data: live /alerts is empty and the mock smoke's fixtures carry
  // their own icon, so the adaptAlerts→AlertCard composition (with a DERIVED
  // icon) renders nowhere else. Inject two API-shaped alerts via ingest — a
  // watchdog crash (the live producer → alert-triangle) and a host-monitor one
  // (a fallback → server) — and assert both titles + their derived lucide glyphs
  // render, then retract so the no-fixture-leakage invariant stays clean.
  const synth = (id, source) => adapt.adaptAlerts({ data: [
    { id, severity: "danger", source, title: `SMOKE ${source} alert`, detail: "synthetic",
      serverId: "factorio-test", hostId: "hotrod", status: "firing",
      raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 1 },
  ] })[0];
  aApi.KrystalAlerts.ingest({ kind: "raise", alert: synth("crash:smoke", "watchdog") });
  aApi.KrystalAlerts.ingest({ kind: "raise", alert: synth("hm:smoke", "host-monitor") });
  const renderHtml = await nav("#/alerts");
  assert(renderHtml.includes("SMOKE watchdog alert") && renderHtml.includes("SMOKE host-monitor alert"),
    "alerts render-with-data: adaptAlerts→AlertCard shows the titles");
  assert(renderHtml.includes("lucide-triangle-alert") && renderHtml.includes("lucide-server"),
    "alerts render-with-data: derived icons resolve to real lucide glyphs (source→icon)");
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "crash:smoke" });
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "hm:smoke" });

  // GamePage instances are scoped by blueprint, not the null===null match-all:
  // the factorio blueprint detail must list factorio-test and NOT terraria-hardmode.
  // Scope the check to the PAGE content — the global assistant dock's scope chip
  // lists every server on the host (so it carries terraria-hardmode whenever the
  // assistant capability is operational), which would falsely trip the negative
  // check. Clone + strip `.chat-page` so this asserts GamePage's scoping, not the
  // dock's roster. (Non-destructive: the live React tree is untouched.)
  await nav("#/library/factorio");
  const bpClone = w.document.getElementById("root").cloneNode(true);
  bpClone.querySelectorAll(".chat-page").forEach((n) => n.remove());
  const bpHtml = bpClone.innerHTML;
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

  // ---- Phase 4: realtime (real WebSocket) ---------------------------------
  // The app boots a real WS to /api/v1/stream (createLiveStream). Prove the
  // transport is live (audit.append flows end-to-end from a kgsm emit) and that
  // the server.patch/server.removed/job.patch remaps mutate the stores. kgsm
  // `events emit` only drives audit.append, so the other three are injected at
  // the dispatch seam (api.__dispatch — RAW server frame → adapt → dispatch),
  // exactly as the socket would deliver them.
  const { api, realtimeStore } = await vite.ssrLoadModule("/src/lib/apiClient.js");
  const { execSync } = await import("node:child_process");

  // (a) the socket reaches "live"
  let rtMode = null;
  for (let i = 0; i < 40; i++) {
    rtMode = (Object.values(realtimeStore.getState().hosts || {})[0] || {}).mode;
    if (rtMode === "live") break;
    await sleep(150);
  }
  assert(rtMode === "live", `realtime WS connected (mode=${rtMode})`);

  // (b) audit.append end-to-end: a real kgsm event → WS → prepended row.
  // Emitted for the synthetic AUDIT_PROBE, not a real instance, so this persistent
  // append doesn't leave a phantom factorio-test start in the audit log.
  const beforeTop = (st.auditStore.getState().list[0] || {}).id;
  execSync(`/home/heisen/tks/kgsm/kgsm.sh events emit instance-started ${AUDIT_PROBE}`);
  let appended = false;
  for (let i = 0; i < 40; i++) {
    const top = st.auditStore.getState().list[0];
    if (top && top.id !== beforeTop && top.action === "server.start") { appended = true; break; }
    await sleep(150);
  }
  assert(appended, "audit.append e2e: kgsm emit → WS → auditStore prepends a server.start row");

  // (c) server.patch remap: RAW API status 'running' → adapted 'online'
  api.__dispatch({ topic: "servers", type: "server.patch",
    data: { id: "factorio-test", name: "factorio-test", blueprint: "factorio", status: "running", runtime: "native", hostId: "hotrod" } });
  assert((st.serversStore.find("factorio-test") || {}).status === "online",
    "server.patch: raw 'running' adapted to 'online' and merged by id");

  // (d) server.removed tombstone drops the instance
  api.__dispatch({ topic: "servers", type: "server.patch",
    data: { id: "smoke-srv", name: "smoke", blueprint: "factorio", status: "running", runtime: "native", hostId: "hotrod" } });
  const wasAdded = !!st.serversStore.find("smoke-srv");
  api.__dispatch({ topic: "servers", type: "server.removed", data: { id: "smoke-srv" } });
  assert(wasAdded && !st.serversStore.find("smoke-srv"), "server.removed: tombstone drops the instance from the roster");

  // (e) job.patch remap: running → {verb,state}; terminal succeeded → cleared
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "j1", serverId: "factorio-test", verb: "start", state: "running" } });
  const jobRunning = (st.serversStore.find("factorio-test") || {}).job;
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "j1", serverId: "factorio-test", verb: "start", state: "succeeded" } });
  const jobCleared = (st.serversStore.find("factorio-test") || {}).job;
  assert(jobRunning && jobRunning.state === "running" && jobCleared == null,
    "job.patch: running tracked; terminal (succeeded) clears the job");

  // (f) alert.raise over the FULL WS chain: adaptStreamMessage → adaptAlert
  // (derived icon) → dispatch → alertsStore upsert (slice 3 only tested REST +
  // a direct ingest, skipping the stream adaptation — this closes the chain).
  api.__dispatch({ topic: "alerts", type: "alert.raise",
    data: { id: "crash:wschain", severity: "danger", source: "watchdog", title: "WS chain alert",
      detail: "synthetic", serverId: "factorio-test", hostId: "hotrod", status: "firing",
      raisedAt: "2026-06-20T00:00:00Z", escalated: false, attempts: 1 } });
  const wsAlert = aApi.alertsStore.getState().list.find(a => a.id === "crash:wschain");
  assert(wsAlert && wsAlert.icon === "alert-triangle",
    "alert.raise: WS frame → adaptAlert (derived icon) → alertsStore upsert");
  aApi.KrystalAlerts.ingest({ kind: "retract", id: "crash:wschain" });

  // (g) host.metrics live tick (slice 7 follow-on) -------------------------
  // The diagnostics deep-dive subscribes hosts/{id}/metrics while open; each tick
  // merges clobber-safe (telemetry only — never the capability block or firewall grid).
  const hmId = (st.hostsStore.getState().list[0] || {}).id;
  const synthSnap = (cpu) => ({
    cpuPct: cpu, mem: { used: 4, total: 16, available: 12, swapUsed: 0, swapTotal: 2 },
    disks: [{ mount: "/", used: 50, total: 100, fs: "ext4" }],
    perCore: [cpu, cpu], load: { one: 0.5, five: 0.6, fifteen: 0.7 },
    diskIo: { readBps: 1000, writeBps: 2000 },
    interfaces: [{ name: "eth0", rxBps: 1000, txBps: 2000, rxPps: 10, txPps: 20 }],
    uptimeSec: 12345, sampleTs: 1718400000000,
  });

  // (g1) CLOBBER-SAFETY (store-level, race-free) — a tick must NEVER wipe the firewall
  // open-ports grid or a capability. Seed those (the tick carries none of them), merge a
  // tick directly, and assert they survive while only the telemetry fields change.
  const seed0 = st.hostsStore.find(hmId);
  st.hostsStore.patch(hmId, {
    network: { ...(seed0.network || {}), open_ports: [{ port: 25565, proto: "tcp", server: "factorio-test", app: "factorio" }] },
    sensors: [{ label: "pkg", value_c: 42 }],
    processes: [{ pid: 1, name: "init", cpu_pct: 0, ram_mb: 1, threads: 1, fds: 1, state: "running" }],
    capabilities: { ...seed0.capabilities, metrics: { ...(seed0.capabilities.metrics || {}), status: "operational", provisioned: true } },
  });
  st.hostsStore.mergeMetrics(hmId, adapt.adaptHostMetrics(synthSnap(73)));
  const merged = st.hostsStore.find(hmId);
  assert(merged.cpu.usage_pct === 73 && merged.ram.total_gb === 16 && merged.network.interfaces[0].name === "eth0",
    "host.metrics merge: cpu / mem / iface throughput swapped in from the tick");
  assert(merged.network.open_ports.length === 1 && merged.network.open_ports[0].port === 25565,
    "host.metrics merge: firewall open_ports PRESERVED (tick carries interfaces only — clobber-safe)");
  assert(merged.sensors.length === 1 && merged.processes.length === 1 && merged.capabilities.metrics.status === "operational",
    "host.metrics merge: a sensor-less tick doesn't wipe seeded sensors / processes / capability status");
  assert(merged.capabilities.metrics.last_sample_at != null, "host.metrics merge: per-tick freshness stamped (receipt time)");
  // sensors ARE dynamic depth now — a tick that CARRIES them updates in place (honest live temps).
  st.hostsStore.mergeMetrics(hmId, adapt.adaptHostMetrics({ ...synthSnap(73), sensors: [{ chip: "k10temp", label: "Tctl", valueC: 55 }] }));
  const mergedS = st.hostsStore.find(hmId);
  assert(mergedS.sensors.length === 1 && mergedS.sensors[0].value_c === 55,
    "host.metrics merge: a tick carrying sensors updates them (dynamic depth)");
  // STATIC cpu identity (model/threads — Host-view-only) set by REST must survive a tick that omits it.
  st.hostsStore.patch(hmId, { cpu: { ...(mergedS.cpu || {}), model: "Test CPU", threads: 16 } });
  st.hostsStore.mergeMetrics(hmId, adapt.adaptHostMetrics(synthSnap(80)));
  const mergedC = st.hostsStore.find(hmId);
  assert(mergedC.cpu.model === "Test CPU" && mergedC.cpu.threads === 16 && mergedC.cpu.usage_pct === 80,
    "host.metrics merge: static cpu identity (model/threads) PRESERVED while dynamic usage updates");

  // (g2) EFFECT SUBSCRIPTION + live re-render — nav into the deep-dive, clear the stamp,
  // then push a tick through the dispatch seam. It merges ONLY if the deep-dive's effect
  // subscribed hosts/{id}/metrics (there is no module-level listener for this topic). The
  // value read is synchronous (race-free vs the real monitor's own ~1s ticks).
  await nav("#/fleet/" + hmId);
  st.hostsStore.clearMetricsStamp(hmId);
  api.__dispatch({ topic: "hosts/" + hmId + "/metrics", type: "host.metrics", data: synthSnap(91) });
  const tick = st.hostsStore.find(hmId);
  assert(tick && tick.cpu.usage_pct === 91 && (tick.capabilities.metrics || {}).last_sample_at != null,
    "host.metrics: deep-dive effect subscribed → tick merged (cpu updated + freshness stamped)");
  await sleep(150);
  assert(w.document.getElementById("root").innerHTML.includes(hmId),
    "host deep-dive re-rendered after the live tick (subscribe → merge → render)");

  // (g3) DISPOSER lifecycle — leaving the deep-dive unsubscribes the socket topic AND clears
  // the stamp, so the WS-frozen treatment never leaks to the per-server surfaces that share
  // hostMetricsFreshness once you stop inspecting the host.
  await nav("#/fleet");
  await sleep(150);
  assert((st.hostsStore.find(hmId).capabilities.metrics || {}).last_sample_at == null,
    "host.metrics: leaving the deep-dive clears the freshness stamp (disposer ran)");

  // (h) live console (#8) — REST tail hydrate + per-server WS follow. Assert the
  // scrollback shape, then mount a server's overview and prove a live console.line
  // followed onto the rendered panel (the full subscribe → append → render path).
  const cSv = st.serversStore.getState().list[0];
  if (cSv) {
    const tailRes = await api.host(cSv.hostId).get("/servers/" + cSv.id + "/console?tail=5");
    assert(tailRes && Array.isArray(tailRes.lines), "console REST: GET ?tail=N → { lines:[...] } (scrollback shape)");
    await nav("#/servers/" + cSv.id);
    await sleep(220);   // REST tail hydrate
    assert(!w.document.getElementById("root").innerHTML.includes("Loading console…"),
      "console: hydrated past the loading state (REST tail landed)");
    const SENT = "SMOKE_CONSOLE_FOLLOW_LINE";
    api.__dispatch({ topic: "servers/" + cSv.id + "/console", type: "console.line", data: { id: cSv.id, seq: 999999, line: SENT } });
    await sleep(140);
    assert(w.document.getElementById("root").innerHTML.includes(SENT),
      "console: a live console.line followed onto the panel (subscribe → append → render)");

    // (h2) Players still has no LIVE source → honest work-in-progress state, never a fixture roster.
    const ovHtml = w.document.getElementById("root").innerHTML;
    assert(ovHtml.includes("no roster source on this host yet"),
      "players: LIVE shows the honest work-in-progress empty-state (not fixture players)");
    await nav("#/fleet");
  }

  // (i) per-server LIVE metrics (Performance deep-dive) ---------------------
  // The monitor samples each RUNNING server's cgroup/proc tree at ~1 Hz and kgsm-api
  // re-publishes it on servers/{id}/metrics (metrics.tick). The tab seeds from the REST
  // metrics block then follows the tick into a live rolling window. There is NO history
  // store anywhere → this is live-only by design. Prove the adapter, the WS subscribe→
  // point chain (deterministic), and a REAL monitor tick growing the rendered window.

  // (i1) adapter: ServerMetricsDto → chart point. cpu is % of ONE core (UNCAPPED — a
  // multithreaded server exceeds 100); mem/disk are raw bytes; null io/disk stay null.
  const pAdapt = adapt.adaptServerMetrics({ cpuPctCore: 250.37, memBytes: 2147483648, ioReadBps: 1024, ioWriteBps: 2048, pids: 12, diskBytes: 5e8 });
  assert(pAdapt.cpu === 250.4 && pAdapt.memBytes === 2147483648 && pAdapt.ioReadBps === 1024 && pAdapt.pids === 12,
    "adaptServerMetrics: cpu rounded + UNCAPPED (>100), mem/disk raw bytes, io passthrough");
  assert(adapt.adaptServerMetrics({ cpuPctCore: 1, memBytes: 1, ioReadBps: null, ioWriteBps: null, pids: 1, diskBytes: null }).ioReadBps === null
      && adapt.adaptServerMetrics(null) === null,
    "adaptServerMetrics: null io/disk stay null (never fabricated 0); null sample → null");

  // (i2) WS chain: a raw metrics.tick frame → adaptStreamMessage → dispatch →
  // subscribeServerMetrics callback. The server id is in the TOPIC, not the payload.
  let pPoint = null;
  const disposeSM = st.subscribeServerMetrics("factorio-test", (p) => { pPoint = p; });
  api.__dispatch({ topic: "servers/factorio-test/metrics", type: "metrics.tick",
    data: { cpuPctCore: 312.9, memBytes: 1073741824, ioReadBps: 4096, ioWriteBps: 8192, pids: 7, diskBytes: 9e8 } });
  assert(pPoint && pPoint.cpu === 312.9 && pPoint.memBytes === 1073741824 && pPoint.ioWriteBps === 8192,
    "metrics.tick: WS frame → adaptServerMetrics → subscribeServerMetrics callback (full chain, cpu uncapped)");
  disposeSM();

  // (i3) REAL pipeline render: open a RUNNING server's Performance tab. It seeds from the
  // REST metrics block (immediate chart) then a real monitor tick grows the live window.
  const liveSv = st.serversStore.getState().list.find((s) => s.status === "online");
  if (liveSv) {
    await nav("#/servers/" + liveSv.id + "/performance");
    await sleep(250);   // mount + REST seed
    const perfHtml = w.document.getElementById("root").innerHTML;
    assert(/live · 1 Hz|% core/.test(perfHtml) && !perfHtml.includes("Work in progress"),
      "performance: live charts render from the REST seed (subscribe → seed → chart, not the old WIP state)");
    // The subscriber-gated pump now ticks ~1 Hz → the rendered "live window · N samples" grows past the seed.
    let grew = false;
    for (let i = 0; i < 60; i++) {
      const m = w.document.getElementById("root").innerHTML.match(/live window · (\d+) sample/);
      if (m && Number(m[1]) >= 2) { grew = true; break; }
      await sleep(150);
    }
    assert(grew, "performance: a REAL monitor metrics.tick grew the live window (subscribe → WS → render)");
    await nav("#/fleet");
  } else {
    console.log("  ⚠ skip performance (i3): no running server on this backend to prove live ticks");
  }

  // ---- Phase 5: command + install write paths (slice 6) -------------------
  // The two mutation paths into the engine, both through the host-scoped client
  // (origin:"ui" stamped, bearer injected when held). NON-DESTRUCTIVE: intercept
  // the outbound POST and return a synthetic 202 { job }, so no real start /
  // install runs on the host — we assert only the request the FE constructs (the
  // live start→watchdog and install→download round-trips need the full engine up
  // and are validated by hand, not in this smoke).
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers(\/[^/]+\/commands)?$/.test(u)) {
      captured = { url: u, body: JSON.parse(opts.body || "null") };
      return new Response(JSON.stringify({ job: {
        id: "job_smoke", serverId: "factorio-test", verb: (captured.body || {}).verb || "install",
        state: "queued", createdAt: "2026-06-20T00:00:00Z", settledAt: null, error: null,
      } }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
  await st.commandServer({ id: "factorio-test", hostId: hmId }, "start").catch(() => {});
  assert(captured && captured.url.endsWith("/api/v1/servers/factorio-test/commands")
    && captured.body.verb === "start" && captured.body.origin === "ui",
    "commandServer → POST /servers/{id}/commands { verb, origin:'ui' } via the host-scoped client");
  captured = null;
  await st.installServer({ game: { id: "factorio" }, name: "My Factorio", hostId: hmId }).catch(() => {});
  assert(captured && captured.url.endsWith("/api/v1/servers")
    && captured.body.blueprint === "factorio" && captured.body.name === "My Factorio" && captured.body.origin === "ui",
    "installServer → POST /servers { blueprint, name, origin:'ui' } (no fabricated server row)");
  globalThis.fetch = realFetch;

  // The `update` verb is deferred upstream (M3 has no update verb → it would 400 in
  // LIVE), so the server detail must render the Update chip disabled with an honest
  // reason — the reason text appears in the title ONLY when the button is disabled,
  // so its presence proves the live-gate (never a 400-bound enabled button).
  const detailHtml = await nav("#/servers/factorio-test");
  assert(detailHtml.includes("Update isn't available yet"),
    "server detail: Update chip disabled in LIVE with an honest reason (no 400-bound button)");

  // ---- Phase 6: assistant turn SSE (slice 9a) -----------------------------
  // The assistant turn is an SSE relay (kgsm-api POST /assistant/turn → §5·a
  // frames). NON-LEAF + deterministic: intercept the outbound POST and feed a
  // canned §5·a stream, so the seam's SSE parser + frame translation are asserted
  // regardless of whether an assistant leaf is running. (The REAL relay through
  // kgsm-api's AssistantController + the capability gate flipping operational were
  // validated live this session against a thin SSE stub at KGSM_API_ASSISTANT_URL;
  // the real-leaf / Ollama round-trip is owed-to-human.)
  const enc = new TextEncoder();
  const CANNED = [
    'event: text.delta\ndata: {"type":"text.delta","text":"Let me check "}\n\n',
    'event: text.delta\ndata: {"type":"text.delta","text":"factorio-test."}\n\n',
    'event: tool.start\ndata: {"type":"tool.start","id":"tc_0_0","tool":"run_health_check","arguments":{"server_id":"factorio-test"}}\n\n',
    'event: tool.result\ndata: {"type":"tool.result","id":"tc_0_0","tool":"run_health_check","summary":"All checks passed (5/5)."}\n\n',
    'event: done\ndata: {"type":"done","text":"It looks healthy."}\n\n',
  ].join("");
  // Split the canned bytes at a boundary that falls MID-FRAME, to prove the parser
  // buffers across reads (a §5·a frame can arrive split over two chunks).
  const half = Math.floor(CANNED.length / 2) + 13;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/assistant\/turn$/.test(u)) {
      const parts = [CANNED.slice(0, half), CANNED.slice(half)];
      const stream = new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return realFetch(url, opts);
  };
  const frames = [];
  await api.host(hmId).turn({ prompt: "is factorio-test healthy?" }, { onEvent: (e) => frames.push(e) })
    .catch((e) => frames.push({ type: "__throw__", message: e.message }));
  globalThis.fetch = realFetch;
  const types = frames.map((f) => f.type).join(",");
  assert(types === "text.delta,text.delta,tool.start,tool.result,done",
    `assistant turn: SSE parsed into the ordered §5·a frames (${types})`);
  const streamed = frames.filter((f) => f.type === "text.delta").map((f) => f.text).join("");
  assert(streamed === "Let me check factorio-test.",
    "assistant turn: text.delta slices reassemble across a mid-frame chunk boundary");
  const ts = frames.find((f) => f.type === "tool.start");
  const tr = frames.find((f) => f.type === "tool.result");
  assert(ts && ts.id === "tc_0_0" && ts.tool === "run_health_check", "assistant turn: tool.start carries id + tool name");
  assert(tr && tr.id === "tc_0_0" && tr.summary === "All checks passed (5/5).",
    "assistant turn: tool.result pairs to its start by id + carries the summary");

  // Pre-stream degrade surfaces as a thrown apiError (NOT a silent empty turn): a
  // provisioned-but-down assistant answers 503 BEFORE the stream commits, so the
  // SPA can render the honest reason instead of an empty bubble.
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/assistant\/turn$/.test(u))
      return new Response(JSON.stringify({ error: { code: "unavailable", message: "the assistant is currently unavailable" } }),
        { status: 503, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  let turnErr = null;
  await api.host(hmId).turn({ prompt: "x" }, { onEvent: () => {} }).catch((e) => { turnErr = e; });
  globalThis.fetch = realFetch;
  assert(turnErr && turnErr.code === 503,
    `assistant turn: pre-stream degrade (503) throws an apiError the SPA renders (code=${turnErr && turnErr.code})`);

  // The frame→message translation IS slice 9a's deliverable (sendLive just wraps this pure
  // reducer in setConvos). Tool calls ride ON the assistant bubble (tools[]) — grouped under
  // its turn, NOT spliced as a separate row before it. Exercise a TWO-turn sequence: tool-call
  // ids reset per turn (tc_0_0), so turn-2's tool.result must resolve ITS tool — naturally
  // isolated now, since each bubble owns only its own tools.
  const { reduceTurnFrame: R } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  let m = [{ role: "user", content: "q1" }, { role: "assistant", content: "" }];
  m = R(m, { type: "text.delta", text: "Checking " });
  m = R(m, { type: "text.delta", text: "factorio-test…" });
  m = R(m, { type: "tool.start", id: "tc_0_0", tool: "run_health_check" });
  m = R(m, { type: "tool.result", id: "tc_0_0", summary: "5/5 passed" });
  m = R(m, { type: "done", text: "All healthy." });
  const bubble1 = m.find((x) => x.role === "assistant");
  const tool1 = bubble1.tools && bubble1.tools.find((t) => t.id === "tc_0_0");
  assert(tool1 && tool1.state === "done" && tool1.label === "Running health check" && tool1.summary === "5/5 passed",
    "reduceTurnFrame: tool.start→tool on the bubble; tool.result resolves it by id (friendly label + summary, turn 1)");
  assert(m[m.length - 1].role === "assistant" && m[m.length - 1].content === "All healthy.",
    "reduceTurnFrame: text.delta streams into the bubble; done reconciles it to the full reply");
  // Turn 2 — same turn-local tool id reused on a fresh bubble.
  m = [...m, { role: "user", content: "q2" }, { role: "assistant", content: "" }];
  m = R(m, { type: "tool.start", id: "tc_0_0", tool: "get_status" });
  m = R(m, { type: "tool.result", id: "tc_0_0", summary: "online" });
  const bubbles = m.filter((x) => x.role === "assistant");
  const t1 = bubbles[0].tools.find((t) => t.id === "tc_0_0");
  const t2 = bubbles[1].tools.find((t) => t.id === "tc_0_0");
  assert(bubbles.length === 2 && t1.summary === "5/5 passed" && t2.summary === "online" && t1.state === "done" && t2.state === "done",
    "reduceTurnFrame: turn-2 tool.result (reused id) resolves turn-2's tool, NOT turn-1's resolved one");

  // ---- Phase 5c: structured tool.result → rich Evidence card --------------
  // A `tool.result` carrying the §5·a `result` envelope (run_health_check →
  // HealthData) is projected onto the bubble as a `health` Evidence card, ALONGSIDE
  // the resolved text pill (additive). A result-less tool.result adds no card —
  // honest, no fabrication. The pure adapter is exercised directly too.
  const { adaptResultCard: A } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  let hm = [{ role: "user", content: "health?" }, { role: "assistant", content: "" }];
  hm = R(hm, { type: "tool.start", id: "tc_0_0", tool: "run_health_check" });
  hm = R(hm, { type: "tool.result", id: "tc_0_0", summary: "passed with warnings (1/2)",
    result: { tool: "run_health_check", confidence: "confirmed",
      subject: { resource: "server", id: "factorio-test" },
      data: { overall: "warn", passed: 1, total: 2, skipped: 0, checks: [
        { name: "liveness", state: "pass", severity: "success", detail: "Running." },
        { name: "updates", state: "warn", severity: "update", detail: "Update available." },
      ] } } });
  hm = R(hm, { type: "done", text: "One thing to watch." });
  const hbub = hm.find((x) => x.role === "assistant");
  const hcard = hbub.cards && hbub.cards[0];
  assert(hcard && hcard.kind === "health" && hcard.serverId === "factorio-test"
    && hcard.confidence === "confirmed" && hcard.passes === 1 && hcard.warns === 1 && hcard.fails === 0
    && hcard.checks.length === 2 && hcard.checks[0].label === "Server" && hcard.checks[1].status === "warn",
    "reduceTurnFrame: structured tool.result → a `health` Evidence card on the bubble (counts + labels from HealthData)");
  const hpill = hbub.tools && hbub.tools[0];
  assert(hpill && hpill.state === "done" && hpill.summary === "passed with warnings (1/2)",
    "reduceTurnFrame: structured result is additive — the resolved tool pill keeps its summary");
  let nm = [{ role: "user", content: "status?" }, { role: "assistant", content: "" }];
  nm = R(nm, { type: "tool.start", id: "tc_0_0", tool: "get_status" });
  nm = R(nm, { type: "tool.result", id: "tc_0_0", summary: "online" });
  const nbub = nm.find((x) => x.role === "assistant");
  assert(!nbub.cards, "reduceTurnFrame: a result-less tool.result adds no card (honest — text pill only)");
  assert(A({ tool: "get_status", subject: { id: "x" }, data: { servers: [] } }).kind === "fleet"
    && A({ tool: "run_health_check", confidence: "likely", subject: { id: "y" },
         data: { passed: 0, total: 1, skipped: 0, checks: [{ name: "disk", state: "fail", detail: "94% full" }] } }).fails === 1,
    "adaptResultCard: get_status fleet → fleet card; run_health_check → card with computed fail count");
  // get_status fleet (FleetStatusData) → a `fleet` Evidence card; stopped is neutral
  // (idle, not red), an unreadable server stays unknown/warn with its reason (never stopped).
  let fm = [{ role: "user", content: "status?" }, { role: "assistant", content: "" }];
  fm = R(fm, { type: "tool.start", id: "tc_0_0", tool: "get_status" });
  fm = R(fm, { type: "tool.result", id: "tc_0_0", summary: "2 running, 1 stopped, 1 unavailable",
    result: { tool: "get_status", confidence: "confirmed", subject: { resource: "host", id: "primary" },
      data: { running: 2, stopped: 1, unavailable: 1, total: 4, servers: [
        { instance: "factorio-test", state: "running", severity: "success", reason: null },
        { instance: "terraria-hardmode", state: "stopped", severity: "info", reason: null },
        { instance: "valheim", state: "unknown", severity: "warn", reason: "Could not read run-state." },
      ] } } });
  const fcard = fm.find((x) => x.role === "assistant").cards[0];
  assert(fcard && fcard.kind === "fleet" && fcard.confidence === "confirmed"
    && fcard.summary === "2 running · 1 stopped · 1 unavailable" && fcard.servers.length === 3
    && fcard.servers[0].tone === "success" && fcard.servers[1].tone === "idle"
    && fcard.servers[2].tone === "warn" && fcard.servers[2].state === "unknown"
    && fcard.servers[2].reason === "Could not read run-state.",
    "reduceTurnFrame: get_status fleet result → a `fleet` card (running=success, stopped=idle, unreadable=warn+reason)");

  // ---- Phase 6b: command proposals — fork (a) / slice 9b ------------------
  // A §5·a command.proposed → a confirm-first card; Confirm runs the M3 path
  // (origin:"assistant", NO double-write/fabricated audit); the SPA composes the
  // command.verified block from the job outcome the WS carries back.
  const { API_COMMAND_VERBS: AV, composeVerified: CV } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");

  // (1) the reducer splices the card FROM THE PROPOSAL (not a store lookup), and
  //     `done` reorders it BELOW the reply (reply → action).
  let cm = [{ role: "user", content: "start it" }, { role: "assistant", content: "" }];
  cm = R(cm, { type: "text.delta", text: "I can start factorio-test." });
  cm = R(cm, { type: "command.proposed", id: "cmd_0", verb: "start",
    subject: { resource: "server", id: "factorio-test" }, confirm: "Start factorio-test?", token: "tok_inert" });
  const card0 = cm.find((x) => x.role === "command");
  assert(card0 && card0.verb === "start" && card0.subjectId === "factorio-test"
    && card0.confirm === "Start factorio-test?" && card0.state === "proposed",
    "reduceTurnFrame: command.proposed → a confirm-first card from the proposal (verb/subject/confirm)");
  cm = R(cm, { type: "done", text: "Ready when you are." });
  const ci = cm.findIndex((x) => x.role === "command");
  const bi = cm.findIndex((x) => x.role === "assistant");
  assert(bi >= 0 && ci === bi + 1 && cm[bi].content === "Ready when you are.",
    "reduceTurnFrame: done moves the command card BELOW the reply (reply → action)");

  // (2) verb gating — API-backed vs proposed-but-not-executable (spec §6 matrix).
  assert(["start", "stop", "restart", "open_ports"].every((v) => AV.has(v))
    && !AV.has("update") && !AV.has("install") && !AV.has("backup") && !AV.has("set_config"),
    "command verbs: start/stop/restart/open_ports are API-backed; update/install/backup/set_config are not");

  // (3) command.verified composition (SPA-side, honest).
  const okV = CV("start", "factorio-test", { status: "succeeded" });
  assert(okV.ok === true && /Started factorio-test/.test(okV.headline),
    "composeVerified: succeeded → ok + 'Started …' headline");
  const failV = CV("stop", "factorio-test", { status: "failed", job: { error: "engine refused" } });
  assert(failV.ok === false && failV.lines.some((l) => /engine refused/.test(l.detail)),
    "composeVerified: failed → not-ok + the real job error as a line (no fabrication)");
  const unkV = CV("start", "factorio-test", { status: "unknown" });
  assert(unkV.ok === false && /Couldn’t confirm/.test(unkV.headline),
    "composeVerified: unknown (no WS response) → honest 'couldn’t confirm', never a fake ✓");
  const opV = CV("open_ports", "factorio-test", { status: "succeeded" });
  assert(opV.ok === true && !/\d/.test(opV.headline) && /required ports/.test(opV.headline),
    "composeVerified: open_ports headline is generic (intent-only — never fabricates port numbers)");

  // (4) THE GLUE — full confirm path end to end (advisor: test the wiring, not just
  // the units). confirmCommand → POST /commands {verb,origin:'assistant'} (captured →
  // synthetic 202 {job}) → a WS job.patch (succeeded) via __dispatch → awaitJob
  // resolves → the outcome is composed; AND the LIVE confirm does NOT mutate the audit
  // store (the backend writes that row from the kgsm echo — the no-double-write proof).
  let cmdCap = null;
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/[^/]+\/commands$/.test(u)) {
      cmdCap = { url: u, body: JSON.parse(opts.body || "null") };
      return new Response(JSON.stringify({ job: {
        id: "job_9b", serverId: "factorio-test", verb: cmdCap.body.verb, state: "queued", error: null,
      } }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, opts);
  };
  const auditLenBefore = st.auditStore.getState().list.length;
  const verifyP = st.confirmCommand({ id: "factorio-test", hostId: hmId }, "start");
  await sleep(20);                                 // let the POST resolve + awaitJob attach
  // a non-terminal frame first (progress), then the terminal succeeded frame.
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_9b", serverId: "factorio-test", verb: "start", state: "running" } });
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_9b", serverId: "factorio-test", verb: "start", state: "succeeded", error: null } });
  const settled = await verifyP;
  globalThis.fetch = realFetch;
  assert(cmdCap && cmdCap.url.endsWith("/api/v1/servers/factorio-test/commands")
    && cmdCap.body.verb === "start" && cmdCap.body.origin === "assistant",
    "confirmCommand → POST /servers/{id}/commands { verb, origin:'assistant' } (fork (a), not 'ui')");
  assert(settled.status === "succeeded" && settled.jobId === "job_9b",
    "confirmCommand: WS job.patch (succeeded) resolves the verify via awaitJob (job-id correlation)");
  assert(st.auditStore.getState().list.length === auditLenBefore,
    "LIVE confirm does NOT fabricate an audit row (backend writes it from the kgsm echo — no double-write)");

  // (5) awaitJob race-free — a terminal frame already in the store before we await
  // still resolves (check-current-then-subscribe; no missed-frame window).
  globalThis.fetch = async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/[^/]+\/commands$/.test(u))
      return new Response(JSON.stringify({ job: { id: "job_race", serverId: "factorio-test", verb: "stop", state: "queued", error: null } }),
        { status: 202, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_race", serverId: "factorio-test", verb: "stop", state: "succeeded", error: null } });
  const raced = await st.confirmCommand({ id: "factorio-test", hostId: hmId }, "stop");
  globalThis.fetch = realFetch;
  assert(raced.status === "succeeded",
    "awaitJob: a terminal frame already in the store resolves (check-then-subscribe, no missed-frame window)");

  // (5b) the give-up is SOCKET-LIVENESS-gated, NOT wall-clock (advisor): a slow job
  // that sits at `running` with NO frames far longer than the dead window, while the
  // socket is UP, must KEEP WAITING and still resolve on the late `done` — surrendering
  // on elapsed time would flip a command that actually succeeds into a stale, permanent
  // "couldn't confirm". A sustained-DOWN socket (the outcome frame can't arrive) is the
  // ONLY give-up trigger. Timing + liveness are injected so both paths are fast+exact.
  const cmd202 = (id, verb) => async (url, opts) => {
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (opts && opts.method === "POST" && /\/api\/v1\/servers\/[^/]+\/commands$/.test(u))
      return new Response(JSON.stringify({ job: { id, serverId: "factorio-test", verb, state: "queued", error: null } }),
        { status: 202, headers: { "content-type": "application/json" } });
    return realFetch(url, opts);
  };
  st.__setJobTiming({ pollMs: 10, deadMs: 40, liveProbe: () => true });   // socket UP
  globalThis.fetch = cmd202("job_slow", "start");
  const slowP = st.confirmCommand({ id: "factorio-test", hostId: hmId }, "start");
  await sleep(20);
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_slow", serverId: "factorio-test", verb: "start", state: "running" } });
  await sleep(120);                              // >> dead window: a slow `running` with the socket up must NOT give up
  api.__dispatch({ topic: "jobs", type: "job.patch", data: { id: "job_slow", serverId: "factorio-test", verb: "start", state: "succeeded", error: null } });
  const slow = await slowP;
  assert(slow.status === "succeeded",
    "awaitJob: a slow job (long silent `running`) with the socket UP keeps waiting → resolves on the late done (NOT a wall-clock give-up)");
  st.__setJobTiming({ pollMs: 10, deadMs: 40, liveProbe: () => false });  // socket DOWN, never a frame
  globalThis.fetch = cmd202("job_dead", "start");
  const dead = await st.confirmCommand({ id: "factorio-test", hostId: hmId }, "start");
  assert(dead.status === "unknown",
    "awaitJob: a sustained-DOWN socket (no frame can arrive) resolves to honest 'unknown' after the grace");
  globalThis.fetch = realFetch;
  st.__setJobTiming(null);                       // restore production timing

  // (5c) the `done` reorder is TURN-SCOPED — a second turn's card must not drag the
  // first turn's card along (the 9a two-turn precedent: single-turn coverage is blind).
  let tt = [{ role: "user", content: "q1" }, { role: "assistant", content: "" }];
  tt = R(tt, { type: "text.delta", text: "reply 1" });
  tt = R(tt, { type: "command.proposed", id: "cmd_a", verb: "start", subject: { resource: "server", id: "srv-a" }, confirm: "Start srv-a?" });
  tt = R(tt, { type: "done", text: "reply 1" });
  tt = [...tt, { role: "user", content: "q2" }, { role: "assistant", content: "" }];
  tt = R(tt, { type: "text.delta", text: "reply 2" });
  tt = R(tt, { type: "command.proposed", id: "cmd_b", verb: "stop", subject: { resource: "server", id: "srv-b" }, confirm: "Stop srv-b?" });
  tt = R(tt, { type: "done", text: "reply 2" });
  const ai1 = tt.findIndex((x) => x.role === "assistant" && x.content === "reply 1");
  const ca = tt.findIndex((x) => x.role === "command" && x.cmdId === "cmd_a");
  const ai2 = tt.findIndex((x) => x.role === "assistant" && x.content === "reply 2");
  const cb = tt.findIndex((x) => x.role === "command" && x.cmdId === "cmd_b");
  assert(ca === ai1 + 1 && cb === ai2 + 1 && ca < ai2,
    "reduceTurnFrame: done-reorder is turn-scoped — turn-1's card stays after reply-1, doesn't migrate past turn-2");

  // (6) the COMPONENT renders (not just the pure helpers): an API-backed proposal
  // shows the confirm-first action; a non-API verb renders disabled with the honest
  // reason — exercising ChatCommand itself, not only the reducer/composer.
  const { ChatCommand } = await vite.ssrLoadModule("/src/pages/ChatPage.jsx");
  const renderCmd = async (msg) => {
    const node = w.document.createElement("div");
    const root = createRoot(node);
    root.render(React.createElement(ChatCommand, { msg, onRun: () => {} }));
    await sleep(30);
    const html = node.innerHTML;
    root.unmount();
    return html;
  };
  const startHtml = await renderCmd({ role: "command", cmdId: "cmd_0", verb: "start", subjectId: "factorio-test", confirm: "Start factorio-test?", state: "proposed" });
  assert(startHtml.includes("Start") && startHtml.includes("factorio-test") && !startHtml.includes("Not available"),
    "ChatCommand: an API-backed proposal renders a runnable confirm-first action");
  const updHtml = await renderCmd({ role: "command", cmdId: "cmd_1", verb: "update", subjectId: "factorio-test", confirm: "Update factorio-test?", state: "proposed" });
  assert(updHtml.includes("Not available from the panel yet") && /disabled/.test(updHtml),
    "ChatCommand: a non-API verb (update) renders disabled with an honest reason (no 400-bound button)");

  // ---- Phase 7: integrations (Discord) wiring -----------------------------
  // (a) The webhook-PATCH footgun is the one place a bug = silent data loss: the
  // secret is write-only (GET returns only a masked hint), so the body must never
  // carry `webhook` unless the user typed a new value. Assert the pure builder.
  const intg = await vite.ssrLoadModule("/src/pages/DiscordPage.jsx");
  const B = intg.buildIntegrationPatch;
  assert(!("webhook" in B({})), "buildIntegrationPatch: no webhook key when nothing typed (can't wipe the secret)");
  assert(!("webhook" in B({ webhook: "…/webhooks/123/abc***", webhookDirty: false })),
    "buildIntegrationPatch: a non-dirty input (the masked hint) never round-trips the webhook");
  assert(!("webhook" in B({ webhook: "   ", webhookDirty: true })),
    "buildIntegrationPatch: dirty-but-blank omits webhook (no accidental clear)");
  assert(B({ webhook: "https://x", webhookDirty: true }).webhook === "https://x",
    "buildIntegrationPatch: a typed non-empty webhook is sent");
  assert(B({ clearWebhook: true }).webhook === "",
    "buildIntegrationPatch: explicit clear sends webhook:'' ");
  assert(B({ channelLabel: "#ops" }).channelLabel === "#ops" && !("webhook" in B({ channelLabel: "#ops" })),
    "buildIntegrationPatch: channelLabel travels alone (never drags the webhook)");

  // (b) Real persistent round-trip through the host-scoped client (admin under
  // auth-disabled). NON-DESTRUCTIVE: every mutation is reverted; baseline here is
  // an unconfigured webhook, so the set→clear leaves it as found.
  const ig = (p) => api.host(hmId).get("/integrations/discord");
  const base = await ig();
  assert(base && base.provider === "discord" && Array.isArray(base.events) && base.events.length > 0,
    `integrations GET: live Discord view (${base.events.length} server-defined events)`);
  // honest catalog — the FE's fabricated mock-only events are NOT in the live set
  assert(!base.events.some((e) => e.id === "join" || e.id === "lowdisk"),
    "integrations GET: server catalog omits player-join / resource events (no honest source) — not faked");

  // toggle round-trip: flip 'online', confirm it persisted, restore it
  const before = base.events.find((e) => e.id === "online");
  await api.host(hmId).patch("/integrations/discord", { events: [{ id: "online", enabled: !before.enabled }] });
  const flipped = await ig();
  assert(flipped.events.find((e) => e.id === "online").enabled === !before.enabled,
    "integrations PATCH: an event toggle persists (GET-back confirms)");
  await api.host(hmId).patch("/integrations/discord", { events: [{ id: "online", enabled: before.enabled }] });
  assert((await ig()).events.find((e) => e.id === "online").enabled === before.enabled,
    "integrations PATCH: toggle restored to baseline");

  // webhook round-trip (baseline unconfigured → set a VALID-FORMAT but fake URL,
  // never delivered; then clear). Assert the secret never echoes back.
  if (!base.webhook.configured) {
    const FAKE = "https://discord.com/api/webhooks/123456789012345678/SMOKEtok_DO_NOT_DELIVER_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    try {
      await api.host(hmId).patch("/integrations/discord", { webhook: FAKE });
      const set = await ig();
      assert(set.webhook.configured === true && !!set.webhook.hint,
        "integrations PATCH: webhook set → configured:true + a masked hint");
      assert(!JSON.stringify(set).includes("SMOKEtok_DO_NOT_DELIVER"),
        "integrations GET: the raw webhook secret NEVER echoes back (masked hint only)");
    } finally {
      // ALWAYS clear — a throw between set and clear must not leave the fake webhook
      // on the (persistent) dev host, especially as the stack is left up between runs.
      await api.host(hmId).patch("/integrations/discord", { webhook: "" }).catch(() => {});
    }
    assert((await ig()).webhook.configured === false, "integrations PATCH: explicit clear removes the webhook (baseline restored)");
  } else {
    console.log("• integrations: webhook already configured on this host — skipped the set/clear round-trip (non-destructive)");
  }

  // /test on an unconfigured webhook is the honest 409 (no send, no channel spam)
  let testErr = null;
  await api.host(hmId).post("/integrations/discord/test").catch((e) => { testErr = e; });
  assert(testErr && testErr.code === 409,
    `integrations /test: unconfigured webhook → honest 409, never a faked ok (code=${testErr && testErr.code})`);

  // ---- Phase 7b: Files (file browser & editor — Tier 3 #12) --------------
  // The operator-gated GET/PUT /servers/{id}/files surface behind the FileBrowser
  // page. Proofs: (1) the page RENDERS the real working-dir tree in the app (view,
  // full stack); (2) a live round-trip through the host-scoped client's new
  // get/put seam — list (dirs-first) → read (etag) → save-back IDENTICAL bytes
  // (200, unchanged etag) → stale-etag (412) → traversal escape (404). The save is
  // NON-DESTRUCTIVE (re-writes identical content; same sha256).
  const fSv = (st.serversStore.getState().list.find((s) => s.id === "factorio-test")
            || st.serversStore.getState().list[0] || {}).id;
  if (fSv) {
    let filesHtml = await nav("#/servers/" + fSv + "/files");
    for (let i = 0; i < 12 && !/\.config\.ini|\bsaves\b|\binstall\b/.test(filesHtml); i++) {
      await sleep(150); filesHtml = w.document.getElementById("root").innerHTML;
    }
    assert(/\.config\.ini|\bsaves\b|\binstall\b/.test(filesHtml) && !/Something went wrong/i.test(filesHtml),
      "Files page: renders the real working-dir tree (view path, full stack)");

    const listing = await api.host(hmId).get("/servers/" + fSv + "/files");
    assert(listing && Array.isArray(listing.entries)
      && listing.entries.some((e) => e.kind === "dir") && listing.entries.some((e) => e.kind === "file"),
      `Files list: dirs + files returned (${listing && listing.entries ? listing.entries.length : 0} entries)`);
    const firstFileIdx = listing.entries.findIndex((e) => e.kind === "file");
    const lastDirIdx = listing.entries.map((e) => e.kind).lastIndexOf("dir");
    assert(firstFileIdx === -1 || lastDirIdx === -1 || lastDirIdx < firstFileIdx,
      "Files list: dirs sort before files (deterministic truncation order)");

    const cfg = listing.entries.find((e) => e.kind === "file" && e.editable !== false
                  && /\.(ini|cfg|conf|txt|properties|json)$/.test(e.name))
             || listing.entries.find((e) => e.kind === "file" && e.editable !== false);
    if (cfg) {
      const p = "/servers/" + fSv + "/files/content?path=" + encodeURIComponent(cfg.name);
      const read = await api.host(hmId).get(p);
      assert(read && typeof read.content === "string" && /^sha256:/.test(read.etag || ""),
        "Files read: raw text + sha256 etag");
      const saved = await api.host(hmId).put(p, { content: read.content, etag: read.etag, origin: "ui" });
      assert(saved && saved.etag === read.etag,
        "Files save: identical-bytes PUT → 200 + unchanged etag (put seam works end-to-end)");
      let staleErr = null;
      await api.host(hmId).put(p, { content: read.content + "\n", etag: "sha256:deadbeef", origin: "ui" })
        .catch((e) => { staleErr = e; });
      assert(staleErr && (staleErr.code === 412 || staleErr.envCode === "precondition_failed"),
        `Files save: stale etag → 412 (code=${staleErr && staleErr.code})`);
    }

    let escErr = null;
    await api.host(hmId).get("/servers/" + fSv + "/files/content?path="
      + encodeURIComponent("../../../../etc/passwd")).catch((e) => { escErr = e; });
    assert(escErr && escErr.code === 404, `Files jail: traversal escape → 404 (code=${escErr && escErr.code})`);
  } else {
    console.log("• Files: no servers in the live roster — skipped the file-browser round-trip");
  }

  // ---- Phase 8: audit paging + filters (keyset cursor walk + pushdown) ----
  // Two fixes: (1) the log fetched ONE page, leaving older events unreachable —
  // refresh() now WALKS the keyset cursor + loadMore() pulls older pages, with a
  // non-null cursor disclosing incompleteness so client free-text search never
  // looks exhaustive when it isn't; (2) the structured filters (severity incl.
  // attention=warn,danger / serverId / actor / since / category) PUSH DOWN to the
  // backend so the cursor walks the FILTERED log (old matching events stay
  // reachable behind newer noise). DB was wiped (Ts storage changed to ticks), so
  // seed it deterministically first.
  // Seed against the synthetic AUDIT_PROBE (not a real instance): these rows persist in
  // the append-only audit log, so they must read as test data, never phantom real starts.
  for (let i = 0; i < 6; i++) execSync(`/home/heisen/tks/kgsm/kgsm.sh events emit instance-started ${AUDIT_PROBE}`);
  let seeded = 0;
  for (let i = 0; i < 50; i++) {
    seeded = (await api.get("/audit?limit=200")).rows.length;
    if (seeded >= 6) break;
    await sleep(150);
  }
  assert(seeded >= 6, `audit seed: ${seeded} rows landed (kgsm emit → socket → audit) — need ≥6 for paging tests`);

  // (a) adaptAudit preserves the page envelope (both wire shapes + the empty case)
  const env = adapt.adaptAudit({ data: [{ id: "evt_x" }], nextCursor: "42" });
  assert(Array.isArray(env.rows) && env.rows.length === 1 && env.rows[0].id === "evt_x" && env.nextCursor === "42",
    "adaptAudit: { data, nextCursor } → { rows, nextCursor } (envelope preserved, not flattened)");
  const envBare = adapt.adaptAudit([{ id: "evt_y" }]);
  assert(envBare.rows.length === 1 && envBare.nextCursor === null,
    "adaptAudit: a bare array (mock shape) → { rows, nextCursor:null }");
  assert(adapt.adaptAudit(null).rows.length === 0 && adapt.adaptAudit(null).nextCursor === null,
    "adaptAudit: null/garbage → empty page, never throws");

  // (a2) auditServerParams — the pure FE-filter → backend-query mapping
  const auditPage = await vite.ssrLoadModule("/src/pages/AuditLogPage.jsx");
  const ASP = auditPage.auditServerParams;
  const NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
  assert(ASP({ severity: "attention" }).severity === "warn,danger",
    "auditServerParams: 'attention' (Alerts view) → severity=warn,danger (multi-value)");
  assert(ASP({ severity: "danger" }).severity === "danger" && !("serverId" in ASP({ severity: "danger" })),
    "auditServerParams: a single severity passes through; unset dims omitted");
  assert(!("severity" in ASP({ severity: "all" })) && !("since" in ASP({ range: "all" }, NOW)),
    "auditServerParams: 'all' / range 'all' → omitted (no filter, unbounded)");
  assert(ASP({ server: "factorio-test" }).serverId === "factorio-test" && ASP({ actor: "haru" }).actor === "haru"
    && ASP({ category: "server" }).category === "server",
    "auditServerParams: server→serverId, actor→actor, category→category");
  assert(ASP({ range: "24h" }, NOW).since === new Date(NOW - 86400e3).toISOString(),
    "auditServerParams: range 24h → since = now-24h ISO lower bound");
  assert(Object.keys(ASP({ severity: "all", server: "all", actor: "all", range: "all", category: "all" }, NOW)).length === 0,
    "auditServerParams: all-default filter → empty params (no query string)");

  // (b) the server genuinely pages — a tiny limit yields a cursor (older exist)
  const tiny = await api.get("/audit?limit=1");
  assert(tiny.rows.length === 1 && tiny.nextCursor != null,
    `audit keyset: limit=1 returns one row + a non-null cursor (older reachable; cursor=${tiny.nextCursor})`);

  // (b2) PUSHDOWN through the store: a serverId filter walks only that server's
  // rows; an unknown server → 0 (filtered server-side, not client-trimmed); a
  // future `since` → 0 while a 1h-ago `since` returns the recent rows (a real
  // bound, not all-or-nothing). Proves the params reach the backend + filter there.
  const fScoped = await st.auditStore.refresh({ serverId: AUDIT_PROBE });
  assert(fScoped.length > 0 && fScoped.every(r => r.serverId === AUDIT_PROBE),
    `audit pushdown: refresh({serverId}) → ${fScoped.length} rows, all scoped to ${AUDIT_PROBE}`);
  const fNone = await st.auditStore.refresh({ serverId: "no-such-server-xyz" });
  assert(fNone.length === 0 && st.auditStore.getState().nextCursor === null,
    "audit pushdown: refresh({serverId:unknown}) → 0 rows (filtered server-side, cursor null)");
  const fFuture = await st.auditStore.refresh({ since: new Date(Date.now() + 3600e3).toISOString() });
  assert(fFuture.length === 0,
    "audit pushdown: refresh({since:future}) → 0 rows (?since= is a real server-side lower bound)");
  const fRecent = await st.auditStore.refresh({ since: new Date(Date.now() - 3600e3).toISOString() });
  assert(fRecent.length > 0,
    "audit pushdown: refresh({since:1h-ago}) → the recent rows (since bounds, not all-or-nothing)");

  // (b3) END-TO-END through the PAGE — the glue between the pure mapper and
  // refresh(params). The Alerts→audit deep-link (?severity=attention) must drive
  // filter state → auditServerParams → the mount effect → refresh(), landing the
  // pushed query in the store's active filterParams. If this glue is miswired,
  // filters silently degrade to client-only-over-window (the exact bug this slice
  // kills) with NO other symptom — so assert it through the real route, not a
  // hand-built refresh() call. Also covers the attention→warn,danger round-trip.
  await nav("#/audit?severity=attention");
  let fp = {};
  for (let i = 0; i < 30; i++) {
    fp = st.auditStore.getState().filterParams || {};
    if (fp.severity === "warn,danger") break;
    await sleep(100);
  }
  assert(fp.severity === "warn,danger",
    "audit page→backend glue: deep-link ?severity=attention → effect → refresh({severity:'warn,danger'}) (filters truly push down, not client-only)");
  await nav("#/dashboard");

  // (c) refresh() walks to completion on a small per-host log → cursor null = the
  // whole log is loaded, so NO incompleteness disclosure.
  const fullRows = await st.auditStore.refresh();
  assert(fullRows.length > 1 && st.auditStore.getState().nextCursor === null,
    `audit refresh: walked the cursor to completion (${fullRows.length} rows, nextCursor null = complete)`);

  // (d) loadMore() is a no-op once complete (no cursor) — never double-fetches
  const lenComplete = st.auditStore.getState().list.length;
  await st.auditStore.loadMore();
  assert(st.auditStore.getState().list.length === lenComplete,
    "audit loadMore: no-op when the log is complete (no cursor → nothing to pull)");

  // (e) the cursor WALK + incomplete UI. The page's mount effect re-queries to a
  // complete load, so to exercise the partial-window UI we nav FIRST (effect loads
  // full), THEN seed a partial window via setState (no filter change → the effect
  // won't re-fire and clobber it).
  await nav("#/audit");
  await sleep(140);
  const p1 = await api.get("/audit?limit=2");
  st.auditStore.setState(s => ({ ...s, list: p1.rows.slice(), nextCursor: p1.nextCursor, loadingMore: false, status: "ready", everLoaded: true }));
  assert(st.auditStore.getState().nextCursor != null,
    "audit walk: seeded a partial window (cursor present = incomplete)");
  await sleep(140);
  const auditHtml = w.document.getElementById("root").innerHTML;
  assert(auditHtml.includes("Load older events") && auditHtml.includes("most recent events are loaded"),
    "audit page (incomplete): renders the disclosure note + a 'Load older events' affordance");

  await st.auditStore.loadMore();
  const walked = st.auditStore.getState().list;
  assert(walked.length > p1.rows.length,
    `audit loadMore: appended the older page (${p1.rows.length} → ${walked.length} rows reached)`);
  assert(new Set(walked.map(r => r.id)).size === walked.length,
    "audit loadMore: no duplicate rows across the page boundary (dedup by id)");
  assert(walked.every((r, i) => i === 0 || new Date(r.ts) <= new Date(walked[i - 1].ts)),
    "audit loadMore: newest-first order preserved across the appended page");
  assert(st.auditStore.getState().nextCursor === null,
    "audit loadMore: reaching the tail clears the cursor (complete)");
  await sleep(140);
  assert(!w.document.getElementById("root").innerHTML.includes("Load older events"),
    "audit page (complete after load): the disclosure + load-older affordance disappear");

  await nav("#/dashboard");
  await st.auditStore.refresh();   // restore the store to a clean, complete state

  root.unmount();
} finally {
  console.error = origErr;
  await vite.close();
  restoreEnv();
}
console.log(fail ? `\n✗ ${fail} live check(s) failed` : `\n✓ live wiring verified against ${API}`);
process.exit(fail ? 1 : 0);

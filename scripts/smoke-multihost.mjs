// Multi-host (N≥2) smoke (Slice B). One live backend can't exercise fan-out, so
// this seeds a TWO-connection registry before the app's config loads, stubs fetch
// to answer per-host, and proves: (1) config routes each host id to its own base
// URL/WS, and (2) api.fanOut + the store refreshes roll two hosts' data up into
// one merged, host-tagged view. The pure merges are covered in smoke-offline; this
// is the orchestration around them.
import { createServer } from "vite";
import { JSDOM } from "jsdom";

// LIVE mode spins up per-host WebSocket transports + lazy dynamic imports; after
// the asserts finish, tearing down vite can race a pending module fetch. That
// teardown noise is benign and must not flip the exit code — swallow it so the
// result is deterministic (the asserts + explicit process.exit are the verdict).
process.on("unhandledRejection", () => {});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost:5173/", pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "navigator", "location"]) { try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {} }

// Seed a TWO-host registry + a logged-in user BEFORE config.js evaluates → LIVE,
// MULTI, two connections with real ids. No krystal:mock (this is LIVE fan-out).
w.localStorage.setItem("krystal:hosts:registry", JSON.stringify([
  { id: "h1", url: "http://h1.test", name: "Host One" },
  { id: "h2", url: "http://h2.test", name: "Host Two" },
]));
w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "dev", provider: "discord", stay: true, id: "u_dev" }));

let fail = 0;
const assert = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) fail++; };

// Per-host stub fetch: route by origin. Returns backend-DTO-shaped data so the
// adapters map it. Anything unrecognized → empty/ok so cold-boot never throws.
const J = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function stubFetch(url) {
  const u = String(url);
  const host = u.includes("//h1.test") ? "h1" : u.includes("//h2.test") ? "h2" : null;
  if (!host) return Promise.resolve(J({}, 404));
  if (u.endsWith("/api/v1")) return Promise.resolve(J({ name: "kgsm-api", version: "v1" }));
  if (u.includes("/me")) return Promise.resolve(J({ user: { id: "discord:dev", username: "dev", display: "dev" }, tier: "admin" }));
  if (u.includes("/hosts")) return Promise.resolve(J([{ id: host, label: host.toUpperCase(), status: "online", capabilities: {} }]));
  if (u.includes("/servers")) return Promise.resolve(J([{ id: host + "-srv", name: host + "-srv", hostId: host, blueprint: "factorio", status: "running", runtime: "native" }]));
  if (u.includes("/library")) return Promise.resolve(J([{ id: host === "h1" ? "factorio" : "valheim", name: host === "h1" ? "Factorio" : "Valheim", type: "game" }]));
  if (u.includes("/audit")) return Promise.resolve(J({ data: [{ id: host + "-evt", ts: "2026-06-2" + (host === "h1" ? "1" : "2") + "T00:00:00Z", action: "server.start", serverId: host + "-srv" }], nextCursor: null }));
  if (u.includes("/alerts")) return Promise.resolve(J({ data: [] }));
  return Promise.resolve(J({}, 404));
}
globalThis.fetch = w.fetch = stubFetch;
// A WebSocket stub that never opens (fan-out under test is the REST path); avoids
// real socket attempts to the fake hosts. Stays "connecting" forever → harmless.
globalThis.WebSocket = w.WebSocket = class { constructor() {} addEventListener() {} send() {} close() {} get readyState() { return 0; } };

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const cfg = await vite.ssrLoadModule("/src/lib/config.js");
const { api } = await vite.ssrLoadModule("/src/lib/apiClient.js");
const st = await vite.ssrLoadModule("/src/lib/stores.js");

// --- config: tri-state + per-host routing ---------------------------------
assert(cfg.LIVE === true && cfg.MULTI === true && cfg.CONNECTIONS.length === 2, "config: two registry entries → LIVE + MULTI (2 connections)");
assert(cfg.apiV1Of("h1") === "http://h1.test/api/v1" && cfg.apiV1Of("h2") === "http://h2.test/api/v1", "config: each host id routes to its OWN base URL (exact match at N≥2)");
assert(cfg.wsUrlOf("h1") === "ws://h1.test/api/v1/stream" && cfg.wsUrlOf("h2") === "ws://h2.test/api/v1/stream", "config: each host id → its own WS URL");

// --- api.fanOut: hits BOTH hosts ------------------------------------------
const fan = await api.fanOut("/servers");
assert(fan.length === 2 && fan.every((r) => r.ok), "fanOut: queried both connections, both ok");
assert(fan.some((r) => r.conn && r.conn.id === "h1") && fan.some((r) => r.conn && r.conn.id === "h2"), "fanOut: results tagged with their connection");

// --- store roll-up: two hosts merged into one host-tagged view ------------
await st.serversStore.refresh();
const servers = st.serversStore.getState().list;
assert(servers.length === 2 && servers.some((s) => s.id === "h1-srv" && s.hostId === "h1") && servers.some((s) => s.id === "h2-srv" && s.hostId === "h2"),
  "serversStore: both hosts' rosters merged, host attribution preserved");

await st.hostsStore.refresh();
const hosts = st.hostsStore.getState().list;
assert(hosts.length === 2 && hosts.some((h) => h.id === "h1") && hosts.some((h) => h.id === "h2"), "hostsStore: one host per connection → 2 merged");

await st.libraryStore.refresh();
const lib = st.libraryStore.getState().list;
assert(lib.length === 2 && lib.find((g) => g.id === "factorio").hosts.includes("h1") && lib.find((g) => g.id === "valheim").hosts.includes("h2"),
  "libraryStore: per-host catalogs merged, availability tagged by host");

await st.auditStore.refresh();
const audit = st.auditStore.getState().list;
assert(audit.length === 2 && audit[0].id === "h2-evt" && audit[1].id === "h1-evt", "auditStore: cross-host logs merge-sorted newest-first");

// --- scope: filtering by a host narrows to that host ----------------------
assert(st.scopeServers(servers, "h1").length === 1 && st.scopeServers(servers, "h1")[0].hostId === "h1", "scopeServers: a host scope narrows the merged roster to that host");
assert(st.scopeServers(servers, "all").length === 2, "scopeServers: 'all' → the full merged fleet");

try { await vite.close(); } catch (e) { /* benign teardown race — see handler above */ }
console.log(fail ? `\n✗ ${fail} multi-host check(s) failed` : `\n✓ multi-host (N≥2) fan-out verified`);
process.exit(fail ? 1 : 0);

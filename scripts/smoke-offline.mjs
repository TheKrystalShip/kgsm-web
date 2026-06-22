// Offline / connect-at-login smoke (Slice C). Boots with NO connection, NO mock
// flag, NO seed → the app must show the "connect to an API" screen (never fixtures
// or a blank shell). Plus unit-tests the pure connect helpers + connectHost's
// status branches (fetch injected), since the live + mock harnesses both pre-seed
// a connection and so never exercise the OFFLINE path.
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

// Deliberately NOTHING seeded: no krystal:mock, no krystal:auth, no registry, no .env.
let fail = 0;
const assert = (cond, label) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const cfg = await vite.ssrLoadModule("/src/lib/config.js");
const conn = await vite.ssrLoadModule("/src/lib/connect.js");
const { App } = await vite.ssrLoadModule("/src/App.jsx");

// --- config tri-state: empty everything → OFFLINE -------------------------
assert(cfg.OFFLINE === true && cfg.LIVE === false && cfg.MOCK === false,
  "config: empty registry + no seed + no mock → OFFLINE (not LIVE, not MOCK)");

// --- App boots to the connect screen, NOT fixtures / LoginPage ------------
try {
  const html = renderToString(React.createElement(App));
  assert(html.includes("Connect your first host"), "offline boot → AddHostPage connect screen renders");
  assert(html.includes("Host address"), "connect screen shows the host-address field");
  assert(!html.includes("Sign in to Krystal"), "offline boot does NOT fall through to the global LoginPage");
  // No fixtures must leak: a mock server name (e.g. Valheim) would mean fixtures rendered.
  assert(!/valheim|terraria|Minecraft Survival/i.test(html), "offline boot shows NO fixture data (mocks are tests-only)");
} catch (e) {
  assert(false, "offline boot render: THREW " + (e.message || e).toString().split("\n")[0]);
}

// --- pure connect helpers -------------------------------------------------
assert(conn.normalizeHostUrl("127.0.0.1:8097") === "https://127.0.0.1:8097", "normalizeHostUrl: bare host → https origin");
assert(conn.normalizeHostUrl("http://127.0.0.1:8097") === "http://127.0.0.1:8097", "normalizeHostUrl: explicit http scheme kept (local dev)");
assert(conn.normalizeHostUrl("https://krystal-1.example/") === "https://krystal-1.example", "normalizeHostUrl: trailing slash / path dropped → origin");
assert(conn.normalizeHostUrl("  ") === "", "normalizeHostUrl: blank → empty");

assert(conn.parseHandshake({ name: "kgsm-api", version: "v1" }).ok === true, "parseHandshake: kgsm-api handshake → ok");
assert(conn.parseHandshake({ hello: "world" }).ok === false, "parseHandshake: non-kgsm body → not ok");
assert(conn.parseHandshake(null).ok === false, "parseHandshake: null → not ok (never throws)");

const u = conn.userFromMe({ user: { username: "dev", display: "dev (auth disabled)", id: "discord:dev" }, tier: "admin" });
assert(u.name === "dev (auth disabled)" && u.id === "discord:dev" && u.provider === "discord" && u.stay === true, "userFromMe: maps /me.user → app-shell identity");
assert(conn.userFromMe({}).name === "Discord user", "userFromMe: missing user → safe default name");

const re = conn.registryEntry("https://h.example", "H");
assert(re.id === null && re.url === "https://h.example" && re.name === "H", "registryEntry: { id:null, url, name } (id reconciles via cold-boot)");

// --- connectHost status branches (fetch injected) -------------------------
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const stubFetch = (routes) => async (url) => {
  for (const [frag, r] of routes) { if (url.endsWith(frag)) return typeof r === "function" ? r() : r; }
  throw new Error("unrouted " + url);
};
const HS = res(200, { name: "kgsm-api", version: "v1" });
const ME = res(200, { user: { username: "dev", display: "dev (auth disabled)", id: "discord:dev" }, tier: "admin" });

const ok = await conn.connectHost("http://127.0.0.1:8097", { fetchImpl: stubFetch([["/api/v1/me", ME], ["/api/v1", HS]]) });
assert(ok.status === "ok" && ok.origin === "http://127.0.0.1:8097" && ok.user.name === "dev (auth disabled)" && ok.tier === "admin",
  "connectHost: handshake + /me 200 → ok (identity + tier resolved, auth-disabled path)");

const na = await conn.connectHost("http://x:1", { fetchImpl: stubFetch([["/api/v1/me", res(401, {})], ["/api/v1", HS]]) });
assert(na.status === "needs_auth", "connectHost: /me 401 → needs_auth (auth-enabled, OAuth handoff is a backend gap)");

const nk = await conn.connectHost("http://x:1", { fetchImpl: stubFetch([["/api/v1", res(200, { hello: 1 })]]) });
assert(nk.status === "not_kgsm", "connectHost: reachable but non-kgsm handshake → not_kgsm");

const ur = await conn.connectHost("http://x:1", { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
assert(ur.status === "unreachable", "connectHost: transport throw → unreachable");

const bad = await conn.connectHost("", { fetchImpl: stubFetch([]) });
assert(bad.status === "unreachable", "connectHost: empty/unparseable URL → unreachable (never throws)");

// --- merge.js: N-host roll-up (Slice B) — synthetic 2-host inputs ---------
const mg = await vite.ssrLoadModule("/src/lib/merge.js");

const srv = mg.mergeServers([[{ id: "a", hostId: "h1" }], [{ id: "b", hostId: "h2" }]]);
assert(srv.length === 2 && srv.some(s => s.id === "a" && s.hostId === "h1") && srv.some(s => s.id === "b" && s.hostId === "h2"),
  "mergeServers: two hosts' rosters concat, host attribution preserved");
assert(mg.mergeServers([[{ id: "a", v: 1 }], [{ id: "a", v: 2 }]]).length === 1,
  "mergeServers: de-dup by id (defensive — last wins)");
assert(mg.mergeHosts([[{ id: "h1" }], [{ id: "h2" }]]).length === 2, "mergeHosts: one host per connection → N");
assert(mg.mergeAlerts([[{ id: "x" }], [{ id: "y" }, { id: "x" }]]).length === 2, "mergeAlerts: concat + de-dup by id");

const lib = mg.mergeLibrary([
  { hostId: "h1", list: [{ id: "factorio", name: "Factorio" }] },
  { hostId: "h2", list: [{ id: "factorio", name: "Factorio" }, { id: "valheim", name: "Valheim" }] },
]);
const fac = lib.find(g => g.id === "factorio");
const val = lib.find(g => g.id === "valheim");
assert(lib.length === 2, "mergeLibrary: same game across hosts de-dups to one entry");
assert(fac && fac.hosts.includes("h1") && fac.hosts.includes("h2"), "mergeLibrary: availability UNIONs across hosts (factorio on both)");
assert(val && val.hosts.length === 1 && val.hosts[0] === "h2", "mergeLibrary: a host-exclusive game lists only its host");

const parseTs = (s) => Date.parse(s);
const aud = mg.mergeAuditRows(
  [{ id: 1, ts: "2026-01-01T00:00:00Z", hostId: "h1" }, { id: 3, ts: "2026-03-01T00:00:00Z", hostId: "h2" }, { id: 2, ts: "2026-02-01T00:00:00Z", hostId: "h1" }, { id: 1, ts: "2026-01-01T00:00:00Z", hostId: "h1" }],
  parseTs);
assert(aud.length === 3 && aud[0].id === 3 && aud[1].id === 2 && aud[2].id === 1,
  "mergeAuditRows: cross-host concat, newest-first, de-dup by id");
assert(mg.mergeAuditRows([{ id: 9, ts: "nonsense" }], parseTs).length === 1, "mergeAuditRows: unparseable ts sorts last, never throws");

await vite.close();
console.log(fail ? `\n✗ ${fail} offline check(s) failed` : `\n✓ offline / connect-at-login verified`);
process.exit(fail ? 1 : 0);

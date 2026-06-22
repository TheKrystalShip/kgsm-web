// config.js — runtime wiring config: the set of kgsm-api hosts the SPA talks to.
//
// HISTORY: this used to be a single, build-time `VITE_API_BASE`. The SPA is a
// MULTI-HOST client (one kgsm-api == one host's aggregator), so the source of
// truth is now a RUNTIME registry of connected hosts in localStorage. There is
// no longer one global base URL; each host carries its own.
//
//   VITE_API_BASE — OPTIONAL single-host SEED (origin, no /api/v1). When the
//                   registry is empty it stands in as one connection. This is
//                   how the smoke:live harness flips the app into LIVE mode
//                   (it writes .env.local VITE_API_BASE=…) and a handy dev
//                   shortcut — but it is no longer the gate. Blank + empty
//                   registry → the app runs offline (fixtures / connect prompt).
//   VITE_WS_BASE  — OPTIONAL ws(s):// override for the seed's realtime socket.
//
// `LIVE` stays a MODULE-LOAD constant on purpose: it's read at import time by
// several module-load sites (stores `_cold`, the WS/channel seeding, the session
// seed). Making it reactive would be a large, bug-prone refactor. Instead the
// registry is read synchronously here, and the app does a FULL PAGE RELOAD on
// any registry change (connect / disconnect) — exactly as it already reloads on
// login / logout / session-loss — so every module-load read re-evaluates cleanly.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

function clean(u) { return (u || "").trim().replace(/\/+$/, ""); }

// The host-URL registry (URLs only, never tokens). Shared with sessionStore,
// which writes it; config OWNS the key so the base layer can read it with no
// import cycle. Shape: [{ id, url, name }] — `id` is the BACKEND host id (from
// probing GET /hosts at connect time), `url` an origin (with or without scheme).
export const REGISTRY_KEY = "krystal:hosts:registry";

function readRegistry() {
  try {
    const arr = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(REGISTRY_KEY)) || "[]");
    return Array.isArray(arr) ? arr.filter(h => h && h.url) : [];
  } catch (e) { return []; }
}

// Optional single-host seed from the build/dev env (also the smoke:live lever).
const SEED_URL = clean(env.VITE_API_BASE);
const SEED_WS = clean(env.VITE_WS_BASE);

// The connection set the app drives. Real registry wins; otherwise the seed
// stands in as one connection with NO known backend id yet (id:null) — the
// sole-connection fallback in connOf() routes it id-agnostically, and cold-boot
// reconciles the real id from GET /hosts. A registry entry already carries its
// probed id (connect resolves it).
const registry = readRegistry();
export const CONNECTIONS = registry.length
  ? registry.map(h => ({ id: h.id || null, url: h.url, name: h.name || null }))
  : (SEED_URL ? [{ id: null, url: SEED_URL, name: null, seed: true, ws: SEED_WS || null }] : []);

// LIVE = we have at least one connection (registry OR seed). MULTI = N ≥ 2.
export const LIVE = CONNECTIONS.length > 0;
export const MULTI = CONNECTIONS.length > 1;

// Explicit demo / fixtures mode — DISTINCT from LIVE. A real browser with no
// connection configured is OFFLINE (→ the connect screen), NOT a fixtures demo.
// MOCK is opt-in: the smoke harness sets localStorage `krystal:mock`, and
// `?mock=1` / `VITE_MOCK=true` enable the bundled offline demo by hand.
function readMock() {
  try {
    if (env.VITE_MOCK === "true" || env.VITE_MOCK === true) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("krystal:mock") === "1") return true;
    if (typeof location !== "undefined" && new URLSearchParams(location.search || "").get("mock") === "1") return true;
  } catch (e) {}
  return false;
}
export const MOCK = readMock();
// OFFLINE = no real connection AND not the fixtures demo → the app shows the
// "connect to an API" screen instead of fixtures or any data surface.
export const OFFLINE = !LIVE && !MOCK;

// Normalize a stored host URL to an http(s) origin. A URL with an explicit
// scheme is kept verbatim (the seed is a full URL, e.g. http://127.0.0.1:8097);
// a bare host (the registry stores these) defaults to https.
function originOf(url) {
  const u = clean(url);
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : "https://" + u;
}

// Resolve a connection by BACKEND host id, with the SOLE-CONNECTION FALLBACK:
// when there's exactly one connection we route to it regardless of the id
// argument — that is literally the old single global-API_V1 behavior, so an
// id we haven't reconciled yet (seed, or pre-GET /hosts) can't break N=1.
// Exact id→URL matching only matters at N ≥ 2 (the fan-out slice).
function connOf(hostId) {
  if (CONNECTIONS.length === 1) return CONNECTIONS[0];
  if (hostId) { const c = CONNECTIONS.find(c => c.id === hostId); if (c) return c; }
  return CONNECTIONS[0] || null;   // default to the first when unscoped / unknown
}

// Per-host REST base ("…/api/v1") and realtime WS URL ("…/api/v1/stream").
// Empty string when there's no connection (offline) — callers guard on LIVE.
export function apiV1Of(hostId) {
  const c = connOf(hostId);
  return c ? originOf(c.url) + "/api/v1" : "";
}
export function wsUrlOf(hostId) {
  const c = connOf(hostId);
  if (!c) return "";
  if (c.ws) return c.ws;                                   // explicit override (seed VITE_WS_BASE)
  return originOf(c.url).replace(/^http/i, "ws") + "/api/v1/stream";
}

// ---- backwards-compatible single-host aliases ---------------------------
// The "sole / default connection" values. Existing single-host call sites
// (authRedirect /me, LoginPage redirect, the lone WS) read these; they resolve
// to the first/only connection, preserving N=1 behavior. Per-host call sites
// pass an explicit id to apiV1Of/wsUrlOf instead.
export const API_BASE = CONNECTIONS[0] ? originOf(CONNECTIONS[0].url) : "";
export const API_V1 = apiV1Of(null);
export const WS_URL = wsUrlOf(null);

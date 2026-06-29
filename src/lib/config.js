// config.js — runtime wiring config: the set of kgsm-api hosts the SPA talks to.
//
// The SPA is a multi-host client (one kgsm-api == one host's aggregator): the
// source of truth is a RUNTIME registry of connected hosts in localStorage.
// There is no single global base URL; each host carries its own. An empty
// registry means no host is connected yet → the app shows the connect screen.
//
//   VITE_API_BASE — OPTIONAL single-host SEED (origin, no /api/v1). When the
//                   registry is empty it stands in as one connection — how the
//                   smoke:live harness points the app at a backend, and a handy
//                   dev shortcut.
//   VITE_WS_BASE  — OPTIONAL ws(s):// override for the seed's realtime socket.
//
// CONNECTIONS is read once at module load; the app does a FULL PAGE RELOAD on any
// registry change (connect / disconnect) — exactly as it reloads on login /
// logout / session-loss — so every module-load read re-evaluates cleanly.

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
    // Self-heal: a registry URL is always a full http(s) ORIGIN (connect.js stores `new URL().origin`).
    // A scheme-less entry (e.g. a bare "hotrod") is a corruption artifact — it would resolve to
    // https://hotrod via originOf and break every call. Drop it so the seed / connect screen take over.
    return Array.isArray(arr) ? arr.filter(h => h && h.url && /^https?:\/\//i.test(h.url)) : [];
  } catch (e) { return []; }
}

// Optional single-host seed from the build/dev env (also the smoke:live lever).
// SAME-ORIGIN deployment: when kgsm-api serves this bundle at / and the API under /api/v1 on
// the SAME host, build with VITE_API_BASE="self" (or "same-origin") — the seed then resolves to
// the origin that served the page (window.location.origin), so the bundle carries no baked URL
// and talks to wherever it was loaded from. Any other value is used verbatim (a full origin).
const RAW_SEED = clean(env.VITE_API_BASE);
const SEED_URL = /^(self|same-origin)$/i.test(RAW_SEED)
  ? (typeof location !== "undefined" ? clean(location.origin) : "")
  : RAW_SEED;
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
// Empty string when there's no connection — callers guard on CONNECTIONS.length.
export function apiV1Of(hostId) {
  const c = connOf(hostId);
  return c ? originOf(c.url) + "/api/v1" : "";
}
// The bare host ORIGIN (no /api/v1). The auth endpoints (/auth/discord/*,
// /auth/session/refresh) are root-routed on the backend, NOT under /api/v1.
export function apiOriginOf(hostId) {
  const c = connOf(hostId);
  return c ? originOf(c.url) : "";
}
// The bare HOSTNAME/IP of a host (no scheme, no port) — the address the SPA
// reached this host's api at. kgsm/monitor source no ip address, so the connect
// origin IS the honest host address (the api and its game servers are co-located
// per host). Used to compose a server's player-facing connect address (host:port).
// Empty string when no such connection — callers fall back to honest-unknown.
export function hostAddressOf(hostId) {
  const o = apiOriginOf(hostId);
  if (!o) return "";
  try { return new URL(o).hostname; } catch (e) { return ""; }
}
export function wsUrlOf(hostId) {
  const c = connOf(hostId);
  if (!c) return "";
  if (c.ws) return c.ws;                                   // explicit override (seed VITE_WS_BASE)
  return originOf(c.url).replace(/^http/i, "ws") + "/api/v1/stream";
}

// Reconcile a connection's BACKEND host id once it's known (from connect's GET
// /hosts probe, or cold-boot). Sets it in-memory (so apiV1Of/wsUrlOf exact-match
// it) AND persists it into the registry so the next load routes by id immediately
// — no reconnect window. A no-op for the lone seed (kept id-less; sole-connection
// fallback routes N=1 anyway), unless that seed already has a registry entry.
export function reconcileConnectionId(url, id) {
  if (!id) return;
  const o = originOf(url);
  const c = CONNECTIONS.find((c) => originOf(c.url) === o);
  if (c) c.id = id;
  try {
    const reg = readRegistry();
    let changed = false;
    for (const e of reg) { if (originOf(e.url) === o && e.id !== id) { e.id = id; changed = true; } }
    if (changed) localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  } catch (e) {}
}

// ---- backwards-compatible single-host aliases ---------------------------
// The "sole / default connection" values. Existing single-host call sites
// (authRedirect /me, LoginPage redirect, the lone WS) read these; they resolve
// to the first/only connection, preserving N=1 behavior. Per-host call sites
// pass an explicit id to apiV1Of/wsUrlOf instead.
export const API_BASE = CONNECTIONS[0] ? originOf(CONNECTIONS[0].url) : "";
export const API_V1 = apiV1Of(null);
export const WS_URL = wsUrlOf(null);

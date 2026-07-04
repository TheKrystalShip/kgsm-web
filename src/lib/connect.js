// connect.js — adding a kgsm-api host (the connect-at-login flow, Slice C).
//
// The SPA is a multi-host client with no global API: you tell it WHICH kgsm-api
// to talk to, and it verifies identity against THAT host. This module owns the
// probe + the registry/identity writes. The pure helpers are unit-testable;
// connectHost is the impure orchestrator (fetch injectable).
//
// SCOPE: the auth-DISABLED connect path is the live one. A real auth-enabled
// host returns 401 from /me (no bearer yet) and completing Discord OAuth needs a
// backend token-handoff that isn't built (WIRING §6) — so we surface that
// honestly ("needs_auth") rather than bounce into a flow that can't finish.

import { REGISTRY_KEY } from "./config.js";

const AUTH_LS_KEY = "krystal:auth";   // app-shell identity (same key App.jsx / authRedirect use)

// Normalize a user-typed host address to an http(s) ORIGIN: keep an explicit
// scheme, default a bare host to https, drop any path/trailing slash. "" if unparseable.
export function normalizeHostUrl(input) {
  let s = (input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s).origin; } catch { return ""; }
}

// Is a GET /api/v1 handshake body a kgsm-api? → { ok, name, version }.
export function parseHandshake(json) {
  const ok = !!(json && typeof json === "object" && (json.name === "kgsm-api" || (json.name && json.version)));
  return { ok, name: (json && json.name) || null, version: (json && json.version) || null };
}

// App-shell identity from GET /me. Under auth-disabled /me carries a synthesized
// user ({ id, username, display }); under a real login it carries the Discord one.
export function userFromMe(me) {
  const u = (me && me.user) || {};
  return {
    name: u.display || u.username || "Discord user",
    display: u.display || u.username || null,
    provider: "discord", id: u.id || null, stay: true,
  };
}

// A registry entry for a connected host. `id` is the backend host id (probed at
// connect time) so multi-host routing is exact from the first load; null falls
// back to the Slice-A sole-connection routing (fine for a lone host).
export function registryEntry(origin, name, id) {
  return { id: id || null, url: origin, name: name || null };
}

// ---- impure: localStorage registry + app identity -----------------------
function readRegistry() {
  try { const a = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
// Add (or replace, by origin) a connection in the registry. URLs only, no tokens.
export function addConnection(entry) {
  const norm = normalizeHostUrl(entry.url);
  const list = readRegistry().filter((h) => normalizeHostUrl(h.url) !== norm);
  list.push(entry);
  try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(list)); } catch {}
}
export function setAppUser(user) { try { localStorage.setItem(AUTH_LS_KEY, JSON.stringify(user)); } catch {} }

// ---- impure: probe a candidate host (fetch injectable for tests) --------
// Returns { status, origin, name?, version?, user?, tier? } where status ∈
//   "ok"          reachable kgsm-api, identity resolved (auth-disabled or already authed)
//   "needs_auth"  reachable, but /me 401 (auth-enabled — OAuth handoff is a backend gap)
//   "not_kgsm"    reachable, but the handshake isn't a kgsm-api
//   "unreachable" transport error / bad URL / non-2xx handshake
export async function connectHost(input, opts) {
  const fetchImpl = (opts && opts.fetchImpl) || (typeof fetch !== "undefined" ? fetch : null);
  const origin = normalizeHostUrl(input);
  if (!origin || !fetchImpl) return { status: "unreachable", origin };

  let hs;
  try {
    const r = await fetchImpl(origin + "/api/v1", { headers: { Accept: "application/json" } });
    if (!r.ok) return { status: "unreachable", origin };
    hs = parseHandshake(await r.json());
  } catch { return { status: "unreachable", origin }; }
  if (!hs.ok) return { status: "not_kgsm", origin };

  // /me is auth-gated. Under auth-disabled it 200s with a user; under auth-enabled
  // it 401s (no bearer yet → needs the Discord flow the backend can't hand back yet).
  try {
    const r = await fetchImpl(origin + "/api/v1/me", { headers: { Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) return { status: "needs_auth", origin, name: hs.name, version: hs.version };
    if (!r.ok) return { status: "unreachable", origin };
    const me = await r.json();
    // Probe the host id (GET /hosts → array of this one host) so the registry
    // records it — multi-host routing is exact from the next load. Best-effort:
    // a failure here just leaves id null (sole-connection fallback still works).
    let hostId = null;
    try {
      const hr = await fetchImpl(origin + "/api/v1/hosts", { headers: { Accept: "application/json" } });
      if (hr.ok) { const arr = await hr.json(); const h = Array.isArray(arr) ? arr[0] : (arr && arr.data && arr.data[0]); hostId = (h && h.id) || null; }
    } catch {}
    return { status: "ok", origin, name: hs.name, version: hs.version, user: userFromMe(me), tier: (me && me.tier) || "none", hostId };
  } catch { return { status: "unreachable", origin }; }
}

// ---- dev-only: auto-connect a seed against an auth-DISABLED host ------------
// A VITE_API_BASE seed (the dev profile, .env.development) would otherwise land on
// the LoginPage: the app-shell `user` is written ONLY by the Discord callback or
// the connect screen, and a seed skips both — so an auth-DISABLED dev backend (no
// Discord to bounce to) is a dead end. Under `npm run dev` we instead resolve the
// seed's identity exactly as the connect screen does (connectHost → /me 200 →
// synthesized admin) and establish the session BEFORE the app mounts, so dev boots
// straight in. This is the same finalize HostAccess does on a successful connect
// (addConnection + setAppUser), minus the reload — it runs pre-mount.
//
// No-op (returns false) unless ALL hold: a seed is set; nothing is configured yet
// (no stored user, empty registry — never override a real session or a chosen
// host); and the host is reachable + auth-disabled. An auth-ENABLED seed returns
// "needs_auth" → we do nothing and the normal LoginPage shows. The CALLER gates on
// dev mode (import.meta.env.DEV), so this whole path is dead-code-eliminated from a
// production build.
export async function devSeedAutoConnect(seedUrl, opts) {
  if (!seedUrl) return false;
  try { if (localStorage.getItem(AUTH_LS_KEY)) return false; } catch {}   // already signed in
  if (readRegistry().length) return false;                                    // a real connection is configured
  const res = await connectHost(seedUrl, opts);
  if (res.status !== "ok") return false;                                      // needs_auth / unreachable → normal flow
  addConnection(registryEntry(res.origin, res.name, res.hostId));
  setAppUser(res.user);                                                       // app-shell identity from /me
  return true;
}

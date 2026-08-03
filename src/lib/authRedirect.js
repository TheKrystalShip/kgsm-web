// authRedirect.js — the SPA side of the OAuth fragment handoff (WIRING §6/§8).
//
// kgsm-api's /auth/discord/callback 302s the browser back to the SPA with the
// session in the URL FRAGMENT (#access=…&refresh=… on success, #error=… on
// failure) — never the query, so the tokens never reach access logs or Referer.
// We capture it at boot BEFORE the hash router reads location.hash: parse, stash
// the tokens for the session layer, strip the fragment, and (on success)
// establish the app-shell identity from /me so the app mounts authed with no
// LoginPage flash. A normal load (a #/route or no hash) is a no-op.

import { CONNECTIONS, soleConnectionOrigin, reconcileConnectionId } from "./config.js";

const PENDING_KEY = "krystal:oauth:pending";   // sessionStorage {access,refresh} (one-shot)
const ERROR_KEY = "krystal:oauth:error";       // sessionStorage error code (one-shot)
const ANCHOR_KEY = "krystal:oauth:anchor";     // sessionStorage origin of the node we signed in through
const AUTH_LS_KEY = "krystal:auth";

function stripHash() {
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
}

// Parse the OAuth fragment the callback handed back, then strip it from the URL.
// Returns { access, refresh } on success, { error } on failure, or null when the
// fragment isn't an OAuth landing (a normal #/route or empty hash).
export function captureOAuthFragment() {
  try {
    const h = (location.hash || "").replace(/^#/, "");
    if (!h || !/(^|&)(access|error)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    const error = p.get("error");
    if (error) { try { sessionStorage.setItem(ERROR_KEY, error); } catch {} stripHash(); return { error }; }
    const access = p.get("access");
    const refresh = p.get("refresh");
    if (!access) { stripHash(); return null; }
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ access, refresh: refresh || null })); } catch {}
    stripHash();
    return { access, refresh: refresh || null };
  } catch { return null; }
}

// Hand the stashed tokens to the session layer (single-host: the lone host owns
// them; multi-host token routing is deferred — WIRING §1/§8). One-shot.
export function takePendingTokens() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

// The node the sign-in bounce goes through, recorded by LoginPage before it hands
// the browser to Discord. The tokens that come back were minted by THAT node, so
// the return leg (/me, /hosts, the registry entry) must address it and no other —
// with several nodes connected, asking the first one would present another node's
// identity under this session's token.
export function rememberAuthAnchor(origin) {
  try { sessionStorage.setItem(ANCHOR_KEY, origin || ""); } catch {}
}
// Resolve the node a returning login belongs to: the origin LoginPage recorded,
// else the sole connection (nothing to disambiguate). Null when neither holds —
// the login can't be completed honestly and the caller says so.
function authAnchorOrigin() {
  let stashed = null;
  try { stashed = sessionStorage.getItem(ANCHOR_KEY); } catch {}
  const origin = stashed || soleConnectionOrigin();
  if (!origin) return null;
  return CONNECTIONS.some(c => c.url === origin) ? origin : null;
}

// One-shot read of a captured login error (the LoginPage surfaces it).
export function takeOAuthError() {
  try { const e = sessionStorage.getItem(ERROR_KEY); if (e) sessionStorage.removeItem(ERROR_KEY); return e; }
  catch { return null; }
}

// On a fresh OAuth landing, establish the session BEFORE the app mounts (so it
// boots authed — no LoginPage flash, no reload), in three steps with the access
// token as the bearer:
//   1. /me        → the app-shell identity (+ the host tier).
//   2. /hosts     → the host's REAL backend id. The connect probe couldn't read
//                   it (/hosts is 401 pre-login); with the bearer it 200s.
//                   reconcileConnectionId sets conn.id, which flips fanOut onto
//                   the per-host auth gate (id:null routes UNauthenticated).
//   3. adopt      → set the live session for that id DIRECTLY (deterministic, no
//                   bootstrap race on the one-shot token stash), then hydrate the
//                   surfaces (the module-load cold refresh ran before login with
//                   no token, so it loaded nothing).
// On failure we drop the stash so we never half-authenticate, and record an error.
export async function completeOAuthLogin(captured) {
  if (!CONNECTIONS.length || !captured || !captured.access) return;
  const anchor = authAnchorOrigin();
  if (!anchor) {
    // We hold a token but not the node that issued it — probing an arbitrary one
    // would either 401 or, worse, adopt the session under the wrong node's id.
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    try { sessionStorage.setItem(ERROR_KEY, "login_failed"); } catch {}
    return;
  }
  const apiV1 = anchor + "/api/v1";
  const bearer = "Bearer " + captured.access;
  const authHeaders = { Authorization: bearer, Accept: "application/json" };
  try {
    const res = await fetch(apiV1 + "/me", { headers: authHeaders });
    if (!res.ok) throw new Error("me " + res.status);
    const me = await res.json();
    const u = (me && me.user) || {};
    localStorage.setItem(AUTH_LS_KEY, JSON.stringify({
      name: u.display || u.username || "Discord user",
      display: u.display || u.username || null,
      provider: "discord", id: u.id || null, stay: true,
    }));

    // 2 + 3: resolve the real host id, adopt the session under it, hydrate. Best-
    // effort — a hiccup here leaves the user signed in (identity is set) but with
    // data unloaded until the next call heals it, never a broken half-login.
    let hostId = null, hostName = null;
    try {
      const hr = await fetch(apiV1 + "/hosts", { headers: authHeaders });
      if (hr.ok) {
        const arr = await hr.json();
        const h = Array.isArray(arr) ? arr[0] : (arr && arr.data && arr.data[0]);
        hostId = (h && h.id) || null;
        hostName = (h && (h.label || h.name)) || null;
      }
    } catch {}
    if (hostId) {
      reconcileConnectionId(anchor, hostId);
      takePendingTokens();                       // consume the one-shot stash; we adopt directly
      try {
        const { sessionStore } = await import("./sessionStore.js");
        sessionStore.adoptSession(hostId, {
          token: captured.access, refresh: captured.refresh || null, tier: (me && me.tier) || "none",
        });
        // Persist this host (with its REAL id) into the localStorage registry so a RELOAD
        // re-derives the connection WITH that stable id. The per-host session (keyed by id) then
        // resumes from sessionStorage / the refresh token. Without this a same-origin "self" seed
        // reverts to an id-less connection on reload and the session can't be matched back —
        // dropping the user to the unauthenticated/Viewer state with every call 401-ing.
        sessionStore.register({ id: hostId, url: anchor, name: hostName });
      } catch {}
      try {
        const stores = await import("./stores.js");
        ["serversStore", "hostsStore", "libraryStore", "auditStore"].forEach((n) => {
          try { if (stores[n] && stores[n].refresh) stores[n].refresh().catch(() => {}); } catch {}
        });
      } catch {}
    }
  } catch {
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    try { sessionStorage.setItem(ERROR_KEY, "login_failed"); } catch {}
  }
}

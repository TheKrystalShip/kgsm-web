// authRedirect.js — the SPA side of the OAuth fragment handoff (WIRING §6/§8).
//
// kgsm-api's /auth/discord/callback 302s the browser back to the SPA with the
// session in the URL FRAGMENT (#access=…&refresh=… on success, #error=… on
// failure) — never the query, so the tokens never reach access logs or Referer.
// We capture it at boot BEFORE the hash router reads location.hash: parse, stash
// the tokens for the session layer, strip the fragment, and (on success)
// establish the app-shell identity from /me so the app mounts authed with no
// sign-in flash. A normal load (a #/route or no hash) is a no-op.

import { CONNECTIONS, soleConnectionOrigin, reconcileConnectionId } from "./config.js";
// The fragment parser is its own module (both surfaces boot with it, and the standalone assistant
// must not import the node connection model). Re-exported so the panel keeps one import site.
import { captureOAuthFragment, ERROR_KEY, PENDING_KEY } from "./oauthFragment.js";
export { captureOAuthFragment };

const ANCHOR_KEY = "krystal:oauth:anchor";   // sessionStorage: the node we signed in through
const AUTH_LS_KEY = "krystal:auth";

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

// The node the sign-in bounce goes through, recorded by the sign-in before it hands
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

// Does this node run an assistant the browser should be signed into, and can it be done without
// asking the user for anything? Read from the `/hosts` row we just fetched rather than from
// hostsStore, which is still empty this early.
//
// Every condition here is a reason NOT to bounce, and each is a real case:
//   • no assistant on this node, or one the node reports no public address for → nowhere to go.
//     A cluster with no assistants at all never bounces; neither does one whose leaf has no
//     browser route.
//   • the leaf is not answering → the round trip would fail; the dock says it is unavailable.
//   • we already hold a session, or a refresh token to rotate → nothing to buy with a redirect.
//   • this tab already tried → never twice, whatever the reason it did not take.
// A node's `/hosts` describes that node alone, so this can name at most one assistant however
// many the cluster runs; the others are picked up once the roster loads.
async function assistantToChain(hostRow, hostId) {
  if (!hostRow || !hostId) return null;
  const cap = hostRow.capabilities && hostRow.capabilities.assistant;
  if (!cap || cap.provisioned === false) return null;
  if (cap.status !== "operational" && cap.status !== "degraded") return null;
  const url = cap.info && typeof cap.info.url === "string" ? cap.info.url.trim() : "";
  if (!url) return null;
  try {
    const { assistantSession } = await import("./assistantSession.js");
    const status = assistantSession.statusOf(hostId);
    if (status !== "none") return null;                 // live, bootstrapping or denied — not ours to fix
    if (assistantSession.attempted(hostId)) return null;
  } catch { return null; }
  return { hostId, origin: url.replace(/\/+$/, "") };
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
//
// Returns `{ chainAssistant: { hostId, origin } }` when this node runs an assistant the browser
// still owes a session to. The caller bounces there instead of mounting: the browser is already
// mid-redirect, so the assistant's own (silent) round trip costs nothing the user can see, and
// signing into the panel ends with the dock ready. The `/hosts` read above is where we learn it,
// which is also why this is bounded to ONE assistant — that response describes this node alone.
export async function completeOAuthLogin(captured) {
  if (!CONNECTIONS.length || !captured || !captured.access) return;
  if (captured.issuer === "assistant") return;   // a leaf's token; kgsm-api can only 401 on it
  const anchor = authAnchorOrigin();
  if (!anchor) {
    // We hold a token but not the node that issued it — probing an arbitrary one
    // would either 401 or, worse, adopt the session under the wrong node's id.
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    try { sessionStorage.setItem(ERROR_KEY, "login_failed"); } catch {}
    return;
  }
  return establishNodeSession(anchor, captured);
}

// Turn a freshly-minted token pair into a live session on `anchor`, and hydrate.
//
// Extracted from completeOAuthLogin because a KGSM password sign-in ends in exactly the same
// place: the tokens arrive, and everything after that — /me for the identity, /hosts for the
// node's real backend id, adopt, register, hydrate — is about the tokens, not about the door
// they came through. A second copy would be a second place for a login to half-succeed.
export async function establishNodeSession(anchor, captured) {
  const apiV1 = anchor + "/api/v1";
  const bearer = "Bearer " + captured.access;
  const authHeaders = { Authorization: bearer, Accept: "application/json" };
  try {
    const res = await fetch(apiV1 + "/me", { headers: authHeaders });
    if (!res.ok) throw new Error("me " + res.status);
    const me = await res.json();
    const u = (me && me.user) || {};
    // The provider is read off the id the backend returned (`provider:subject`), never assumed:
    // a KGSM password sign-in and a Discord one both land here, and stamping "discord" on a
    // local account would put the wrong mark beside their name everywhere it is shown.
    const provider = String(u.id || "").includes(":") ? String(u.id).split(":")[0] : "local";
    localStorage.setItem(AUTH_LS_KEY, JSON.stringify({
      name: u.display || u.username || "KGSM user",
      display: u.display || u.username || null,
      provider, id: u.id || null, stay: true,
    }));

    // 2 + 3: resolve the real host id, adopt the session under it, hydrate. Best-
    // effort — a hiccup here leaves the user signed in (identity is set) but with
    // data unloaded until the next call heals it, never a broken half-login.
    let hostId = null, hostName = null, hostRow = null;
    try {
      const hr = await fetch(apiV1 + "/hosts", { headers: authHeaders });
      if (hr.ok) {
        const arr = await hr.json();
        const h = Array.isArray(arr) ? arr[0] : (arr && arr.data && arr.data[0]);
        hostRow = h || null;
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
          // Carried from the /me just read, so a tierless arrival can be told WHY on the very
          // first paint rather than after the next reload re-reads it.
          account: (me && me.status) || "unknown",
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

      // The node session is written to storage synchronously above, so navigating away now cannot
      // lose it. Hand the caller the assistant to chain to, if this node has one we owe a session.
      const chainAssistant = await assistantToChain(hostRow, hostId);
      if (chainAssistant) return { chainAssistant };
    }
  } catch {
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
    try { sessionStorage.setItem(ERROR_KEY, "login_failed"); } catch {}
  }
}

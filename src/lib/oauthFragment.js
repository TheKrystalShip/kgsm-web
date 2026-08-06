// oauthFragment.js — parsing the OAuth handoff, and nothing else.
//
// A callback 302s the browser back to the SPA with the session in the URL FRAGMENT
// (#access=…&refresh=… on success, #error=… on failure) — never the query, so the tokens never
// reach an access log or a Referer header. This module captures it at boot, BEFORE anything reads
// location, and says WHICH service issued it.
//
// Deliberately free of every other import: both surfaces run it at boot, and the standalone
// assistant has no node connection model to drag in behind it. Acting on what it parsed — adopting
// a node session, resolving an identity — is authRedirect.js's job on the panel and main.jsx's on
// the assistant.

// The query key an assistant-leaf sign-in puts in its return address (assistantSession.signIn
// writes it, and the leaf preserves the query when it redirects). Spelled here rather than
// imported so this module stays a leaf of the graph: the session layer already imports it.
const ASSISTANT_LOGIN_PARAM = "assistant_login";

const PENDING_KEY = "krystal:oauth:pending";   // sessionStorage {access,refresh} (one-shot)
const ERROR_KEY = "krystal:oauth:error";       // sessionStorage error code (one-shot)

function stripHash(alsoDropParam) {
  try {
    const url = new URL(location.href);
    url.hash = "";
    if (alsoDropParam) url.searchParams.delete(alsoDropParam);
    history.replaceState(null, "", url.pathname + url.search);
  } catch {}
}

// Which service issued the fragment we landed with. Both a node login and an assistant-leaf
// login return to THIS origin carrying the same `access`/`refresh`/`error` keys, so the
// fragment alone cannot say — the issuer is named by the marker the sign-in put in the return
// address (assistantSession.signIn), which survives the round trip in the query. Without it a
// leaf's token would be presented to kgsm-api, which can only ever answer 401.
function issuerOfLanding() {
  try {
    const hostId = new URL(location.href).searchParams.get(ASSISTANT_LOGIN_PARAM);
    return hostId ? { kind: "assistant", hostId } : { kind: "node", hostId: null };
  } catch { return { kind: "node", hostId: null }; }
}

// Parse the OAuth fragment the callback handed back, then strip it from the URL.
// Returns { issuer, hostId, access, refresh } on success, { issuer, hostId, error }
// on failure, or null when the fragment isn't an OAuth landing (a normal #/route or
// empty hash).
export function captureOAuthFragment() {
  try {
    const h = (location.hash || "").replace(/^#/, "");
    if (!h || !/(^|&)(access|error)=/.test(h)) return null;
    const { kind, hostId } = issuerOfLanding();
    const drop = kind === "assistant" ? ASSISTANT_LOGIN_PARAM : null;
    const p = new URLSearchParams(h);
    const error = p.get("error");
    const access = p.get("access");
    const refresh = p.get("refresh");

    // An assistant landing never touches the node stash: its tokens belong to the leaf session
    // for the host the marker names, and its failures are that surface's to report — the panel's
    // own sign-in is unaffected either way. Adoption is the caller's (adoptAssistantLanding), so
    // this module stays a parser and the two session layers keep their own storage.
    if (kind === "assistant") {
      stripHash(drop);
      return {
        issuer: "assistant", hostId, error: error || null,
        access: access || null, refresh: refresh || null, tier: p.get("tier") || null,
      };
    }

    if (error) { try { sessionStorage.setItem(ERROR_KEY, error); } catch {} stripHash(); return { issuer: "node", hostId: null, error }; }
    if (!access) { stripHash(); return null; }
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ access, refresh: refresh || null })); } catch {}
    stripHash();
    return { issuer: "node", hostId: null, access, refresh: refresh || null };
  } catch { return null; }
}

export { ASSISTANT_LOGIN_PARAM, ERROR_KEY, PENDING_KEY };

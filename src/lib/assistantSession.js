import { createStore } from "./store.js";

// assistantSession.js — the browser's session with an assistant LEAF.
//
// The assistant is a standalone service, not a feature of kgsm-api. It serves its own
// browser clients on its own public origin, authenticates people itself through Discord,
// and issues its own tokens — so the panel holds a session with the LEAF that is separate
// from the session it holds with the node's kgsm-api. Two sign-ins, two token families,
// two revocation surfaces; neither can mint or refresh the other's.
//
// Sessions are still keyed by HOST ID, because that is what the surfaces address: a host
// has an assistant or it does not, and a node's chat talks to that node's leaf. The leaf's
// public origin comes from the node's assistant capability (`info.url`), which is the only
// thing the aggregator contributes here — discovery, not transport.
//
// Storage mirrors the node sessions deliberately, so the two age the same way:
//   • access token  → sessionStorage. Short-lived; survives a reload, gone on tab close.
//   • refresh token → localStorage. The long-lived "stay signed in" credential.
// A leaf with no configured public origin has no browser route at all: `originOf` returns
// null and every caller reports the assistant unreachable rather than falling back to the
// node's relay, which would quietly restore the coupling going direct exists to remove.

const TOKEN_PREFIX = "krystal:assistant:session:";    // sessionStorage {token,tier}
const REFRESH_PREFIX = "krystal:assistant:refresh:";  // localStorage (long-lived)
const ATTEMPT_PREFIX = "krystal:assistant:tried:";    // sessionStorage — one silent bounce per tab
const CONSENT_PREFIX = "krystal:assistant:consent:";  // sessionStorage — Discord wants a human
const ROUTE_KEY = "krystal:assistant:route";          // sessionStorage — the route to come back to

// The query key the leaf's return leg carries back, naming the host whose assistant issued
// the tokens in the fragment. The boot-time fragment capture reads it to tell an assistant
// landing from a node one — they arrive on the same origin with the same fragment keys.
const ASSISTANT_LOGIN_PARAM = "assistant_login";

const store = createStore({ byHost: {} });

const rotations = {};   // hostId → in-flight rotate (dedupe concurrent 401 heals)

const recOf = (id) => store.getState().byHost[id] || null;

// How a host id becomes the leaf's address, INSTALLED BY THE SURFACE — because the answer differs
// in kind, not in detail. The Control Panel discovers it, reading the address off the node's
// assistant capability across a cluster it may add nodes to at runtime; the standalone assistant
// has one leaf at a known address and nothing to discover. Resolving it here would mean this module
// importing the host store, which drags the whole node data layer into a surface that has no nodes.
//
// Not installed ⇒ no route, which is the honest answer for a surface that has not said.
let resolveOrigin = () => null;
function setOriginResolver(fn) { resolveOrigin = typeof fn === "function" ? fn : () => null; }

// The leaf's public origin for a host. Null is an honest "no route" — never guessed from the
// panel's own origin, which would send a turn to whatever happened to serve the bundle.
function originOf(hostId) {
  if (!hostId) return null;
  const url = resolveOrigin(hostId);
  return typeof url === "string" && url.trim() ? url.trim().replace(/\/+$/, "") : null;
}

const hasRoute = (hostId) => !!originOf(hostId);
const statusOf = (id) => { const r = recOf(id); return r ? r.status : "none"; };
const tokenOf = (id) => { const r = recOf(id); return r && r.status === "live" ? (r.token || null) : null; };
const tierOf = (id) => { const r = recOf(id); return r ? (r.tier || null) : null; };
const isLive = (id) => statusOf(id) === "live";
const isDenied = (id) => statusOf(id) === "denied";

function setRec(id, partial) {
  store.setState((s) => ({ byHost: { ...s.byHost, [id]: { ...(s.byHost[id] || {}), ...partial } } }));
}

function writeAccess(id, token, tier) {
  try { sessionStorage.setItem(TOKEN_PREFIX + id, JSON.stringify({ token, tier: tier || null })); } catch {}
}
function readAccess(id) {
  try { const raw = sessionStorage.getItem(TOKEN_PREFIX + id); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function writeRefresh(id, token) {
  try { if (token) localStorage.setItem(REFRESH_PREFIX + id, token); else localStorage.removeItem(REFRESH_PREFIX + id); } catch {}
}
function readRefresh(id) {
  try { return localStorage.getItem(REFRESH_PREFIX + id) || null; } catch { return null; }
}

// ---- the silent sign-in's guard rails ----
// A silent sign-in navigates the whole page, so it gets exactly ONE attempt per host per tab. The
// marker is written before leaving and cleared only on a session actually arriving; a landing that
// came back empty leaves it set, which is what stops a leaf that always refuses from bouncing the
// browser in a loop. sessionStorage, because the answer is only true of THIS tab's journey.
function markAttempted(id) { try { sessionStorage.setItem(ATTEMPT_PREFIX + id, "1"); } catch {} }
function clearAttempted(id) { try { sessionStorage.removeItem(ATTEMPT_PREFIX + id); } catch {} }
function attempted(id) { try { return sessionStorage.getItem(ATTEMPT_PREFIX + id) === "1"; } catch { return false; } }

// Discord declined a silent sign-in and wants a human. Recorded so the dock can offer the one
// button that will work, rather than silently retrying something we know will be refused again.
function markConsentNeeded(id) { try { sessionStorage.setItem(CONSENT_PREFIX + id, "1"); } catch {} }
function needsConsent(id) { try { return sessionStorage.getItem(CONSENT_PREFIX + id) === "1"; } catch { return false; } }

// The route the browser was on when it left. The fragment carries the handoff, so it cannot also
// carry the route; keeping it out of the query too means a sign-in never writes where someone was
// into an access log. One slot: only one sign-in can be in flight, since it navigates the page.
function stashRoute(hash) {
  try {
    if (hash && hash !== "#") sessionStorage.setItem(ROUTE_KEY, hash);
    else sessionStorage.removeItem(ROUTE_KEY);
  } catch {}
}
function takeRoute() {
  try { const r = sessionStorage.getItem(ROUTE_KEY); sessionStorage.removeItem(ROUTE_KEY); return r || null; }
  catch { return null; }
}

// Adopt a session the leaf just issued (the OAuth return leg, or a rotation).
function adopt(hostId, sess) {
  if (!hostId || !sess || !sess.token) return;
  // A session arrived: whatever the last attempt cost, it is spent and the guards are done.
  clearAttempted(hostId);
  try { sessionStorage.removeItem(CONSENT_PREFIX + hostId); } catch {}
  writeAccess(hostId, sess.token, sess.tier);
  if (sess.refresh !== undefined) writeRefresh(hostId, sess.refresh || null);
  setRec(hostId, {
    status: "live", token: sess.token, tier: sess.tier || null, error: null,
    refresh: sess.refresh !== undefined ? (sess.refresh || null) : readRefresh(hostId),
  });
}

// Identity verified, no access on that host. Terminal: never retried, because retrying a
// role decision loops forever without ever changing the answer.
function deny(hostId) {
  writeAccess(hostId, null, null);
  try { sessionStorage.removeItem(TOKEN_PREFIX + hostId); } catch {}
  writeRefresh(hostId, null);
  setRec(hostId, { status: "denied", token: null, refresh: null, tier: "none", error: "denied" });
}

function signOut(hostId) {
  // Signing out is a decision to be signed out. Leaving the attempt marker set is what stops the
  // automatic sign-in from immediately undoing it.
  markAttempted(hostId);
  try { sessionStorage.removeItem(TOKEN_PREFIX + hostId); } catch {}
  writeRefresh(hostId, null);
  setRec(hostId, { status: "none", token: null, refresh: null, tier: null, error: null });
}

// Exchange the long-lived refresh token for a fresh pair, straight at the leaf. The leaf
// rotates the refresh token too, so the reply's `refresh` replaces the stored one. A refusal
// is terminal for this session: the token was revoked or aged out, and only a new Discord
// consent produces another.
function rotate(hostId) {
  if (rotations[hostId]) return rotations[hostId];
  const origin = originOf(hostId);
  const refresh = (recOf(hostId) || {}).refresh || readRefresh(hostId);
  if (!origin || !refresh) {
    setRec(hostId, { status: "expired", token: null, error: "expired" });
    return Promise.resolve(null);
  }
  const p = fetch(origin + "/auth/session/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ refresh }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(res)))
    .then((j) => {
      const token = (j && (j.access || j.token)) || null;
      if (!token) throw new Error("no token in refresh response");
      adopt(hostId, { token, refresh: (j && j.refresh) || refresh, tier: (j && j.tier) || tierOf(hostId) });
      return token;
    })
    .catch(() => {
      // The refresh token no longer buys a session — say so and stop, rather than holding a
      // token we know is dead and re-presenting it on every call.
      try { sessionStorage.removeItem(TOKEN_PREFIX + hostId); } catch {}
      writeRefresh(hostId, null);
      setRec(hostId, { status: "expired", token: null, refresh: null, error: "expired" });
      return null;
    })
    .finally(() => { delete rotations[hostId]; });
  rotations[hostId] = p;
  return p;
}

// Ensure a live session for a host, silently, without asking the user for anything. A seeded
// refresh token is spent here rather than at the first call, because the surfaces read `statusOf`
// on their first render — healing only on demand shows a Sign in prompt to someone who is, in
// every sense that matters, already signed in. Resolves to whether we now hold a session.
function authorize(hostId) {
  if (!hostId || !originOf(hostId)) return Promise.resolve(false);
  const status = statusOf(hostId);
  if (status === "live") return Promise.resolve(true);
  if (status === "denied" || status === "none") return Promise.resolve(false);
  return rotate(hostId).then((t) => !!t);
}

// The one decision point for "we want to be talking to this leaf". Ranked by what it costs the
// user: a live session is free, a held refresh token is one silent request, and only a browser
// with neither is worth a redirect. Called wherever a host becomes the assistant we address.
function ensureSession(hostId) {
  if (!hostId || !originOf(hostId)) return Promise.resolve(false);
  const status = statusOf(hostId);
  if (status === "live") return Promise.resolve(true);
  if (status === "denied") return Promise.resolve(false);          // terminal; a retry loops forever
  if (status === "bootstrapping") return authorize(hostId);        // spend the refresh token instead
  if (attempted(hostId)) return Promise.resolve(false);            // already bounced this tab; the UI asks
  signIn(hostId);
  return Promise.resolve(false);                                   // we are navigating away
}

// Hand the browser to the leaf's Discord sign-in, asking to be returned HERE.
//
// **This is normally invisible.** Every surface on the host is the SAME Discord application — one
// client id in /etc/kgsm/discord-auth.env, differing only in redirect URI — so a browser that
// authorized the app to sign into the panel has already authorized it for the assistant. Discord
// answers `prompt=none` with two 302s and renders nothing. `prompt=consent` is the fallback for the
// one case that genuinely needs a human, and is passed only after a silent attempt asked for it.
//
// The marker in the return address is what tells the landing which service issued the fragment —
// the node login lands on the same origin with the same key names, and without it the panel would
// present an assistant token to kgsm-api.
// The navigation itself, behind a seam. A sign-in leaves the page, which a test harness cannot let
// happen and jsdom cannot perform — so the smoke swaps this to record the bounce it would have made
// (the `__setJobTiming` pattern in stores/servers.js). Production never touches it.
let navigate = (url) => { window.location.href = url; };
function __setNavigator(fn) { navigate = fn || ((url) => { window.location.href = url; }); }

function signIn(hostId, opts) {
  // `origin` is passed by the caller that runs BEFORE the app mounts (the login chain), where the
  // host roster is not loaded yet and there is nothing to resolve an address from.
  const origin = (opts && opts.origin) || originOf(hostId);
  if (!origin) return false;
  const back = new URL(window.location.href);
  // The fragment is the handoff's, so the route travels out of band and is put back after landing.
  stashRoute(back.hash);
  back.hash = "";
  back.searchParams.set(ASSISTANT_LOGIN_PARAM, hostId);
  markAttempted(hostId);
  const prompt = opts && opts.prompt ? "prompt=" + encodeURIComponent(opts.prompt) + "&" : "";
  navigate(origin + "/auth/discord/start?" + prompt + "return_to=" + encodeURIComponent(back.toString()));
  return true;
}

// Restore what survived the tab: the access token from sessionStorage, else a refresh token
// from localStorage (a fresh tab, days later) which the first call rotates. Nothing is probed
// here — a session is proven by the leaf answering, not by us holding bytes.
function seed() {
  const ids = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(TOKEN_PREFIX)) ids.push(k.slice(TOKEN_PREFIX.length));
    }
  } catch {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(REFRESH_PREFIX)) {
        const id = k.slice(REFRESH_PREFIX.length);
        if (!ids.includes(id)) ids.push(id);
      }
    }
  } catch {}
  for (const id of ids) {
    const acc = readAccess(id);
    const ref = readRefresh(id);
    if (acc && acc.token) setRec(id, { status: "live", token: acc.token, tier: acc.tier || null, refresh: ref, error: null });
    // A refresh token with no access token is the ORDINARY state of a new tab: sessionStorage is
    // per-tab and localStorage is not. It is `bootstrapping`, not `expired` — the long-lived
    // credential is exactly what spares the user another sign-in, and prompting for one while
    // holding it is asking for something we already have.
    else if (ref) setRec(id, { status: "bootstrapping", token: null, tier: null, refresh: ref, error: null });
  }
}

const assistantSession = Object.assign(store, {
  ASSISTANT_LOGIN_PARAM,
  __setNavigator, setOriginResolver,
  adopt, attempted, authorize, deny, ensureSession, hasRoute, isDenied, isLive, needsConsent,
  markConsentNeeded, originOf, rotate, seed, signIn, signOut, statusOf, takeRoute, tierOf, tokenOf,
});

// Restore at module load: the surfaces read `statusOf` on their first render, and a store that
// starts empty and fills a tick later shows a signed-in user a sign-in prompt for that tick.
seed();

export { ASSISTANT_LOGIN_PARAM, assistantSession };

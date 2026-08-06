import { createStore } from "./store.js";
import { hostsStore } from "./stores.js";

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

// The query key the leaf's return leg carries back, naming the host whose assistant issued
// the tokens in the fragment. The boot-time fragment capture reads it to tell an assistant
// landing from a node one — they arrive on the same origin with the same fragment keys.
const ASSISTANT_LOGIN_PARAM = "assistant_login";

const store = createStore({ byHost: {} });

const rotations = {};   // hostId → in-flight rotate (dedupe concurrent 401 heals)

const recOf = (id) => store.getState().byHost[id] || null;

// The leaf's public origin for a host, from that host's assistant capability. Null when the
// host has no assistant, or has one the node reports no browser address for — an honest
// "no route", never guessed from the panel's own origin.
function originOf(hostId) {
  if (!hostId) return null;
  const host = hostsStore.find(hostId);
  const cap = host && host.capabilities && host.capabilities.assistant;
  if (!cap || cap.provisioned === false) return null;
  const url = cap.info && typeof cap.info.url === "string" ? cap.info.url.trim() : "";
  if (!url) return null;
  return url.replace(/\/+$/, "");
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

// Adopt a session the leaf just issued (the OAuth return leg, or a rotation).
function adopt(hostId, sess) {
  if (!hostId || !sess || !sess.token) return;
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

// Hand the browser to the leaf's Discord consent, asking to be returned HERE. The marker in
// the return address is what tells the landing which service issued the fragment — the node
// login lands on the same origin with the same key names, and without it the panel would
// present an assistant token to kgsm-api. `prompt=consent` because the first authorization
// on a new client cannot be silent.
function signIn(hostId) {
  const origin = originOf(hostId);
  if (!origin) return false;
  const back = new URL(window.location.href);
  back.hash = "";
  back.searchParams.set(ASSISTANT_LOGIN_PARAM, hostId);
  window.location.href = origin + "/auth/discord/start?prompt=consent&return_to="
    + encodeURIComponent(back.toString());
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
    else if (ref) setRec(id, { status: "expired", token: null, tier: null, refresh: ref, error: null });
  }
}

const assistantSession = Object.assign(store, {
  ASSISTANT_LOGIN_PARAM,
  adopt, deny, hasRoute, isDenied, isLive, originOf, rotate, seed, signIn, signOut,
  statusOf, tierOf, tokenOf,
});

// Restore at module load: the surfaces read `statusOf` on their first render, and a store that
// starts empty and fills a tick later shows a signed-in user a sign-in prompt for that tick.
seed();

export { ASSISTANT_LOGIN_PARAM, assistantSession };

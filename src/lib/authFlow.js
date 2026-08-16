// authFlow.js — the way in, before there is anything to show.
//
// Three screens sit in front of the app, and this module owns the two questions they
// turn on: WHICH node is being signed in to, and WHAT that node offers as a way in.
// It talks to a host directly rather than through `apiClient`, because every call here
// is anonymous by definition and the seam's whole job is attaching a bearer to a node
// the caller has already been authorized against.

import { CONNECTIONS, addConnections, originOfHost } from "./config.js";
import { addConnection, normalizeHostUrl, registryEntry } from "./connect.js";

// The node this browser last signed in through. A returning visitor goes straight to its
// sign-in rather than being asked to pick from a list of one, so this is what makes the
// node screen an exception rather than a toll gate.
const LAST_NODE_KEY = "krystal:node:last";

function lastNodeOrigin() {
  try { return localStorage.getItem(LAST_NODE_KEY) || ""; } catch { return ""; }
}

function rememberNode(origin) {
  try { if (origin) localStorage.setItem(LAST_NODE_KEY, origin); } catch {}
}

function forgetNode() {
  try { localStorage.removeItem(LAST_NODE_KEY); } catch {}
}

// The nodes this browser knows, as the node screen lists them. Read off the live
// connection set so a peer cluster discovery registered is offered too.
function knownNodes() {
  return CONNECTIONS
    .map(c => ({ id: c.id || null, origin: originOfHost(c.id) || c.url, name: c.name || null }))
    .filter(n => n.origin);
}

// What a node says about itself, and how to get in — one anonymous round trip each,
// run together because a row that cannot say whether it is reachable is not worth drawing.
//
// GET /api/v1 is also the reachability probe. That is deliberate: a row is green because
// something answered as a kgsm-api, never because an address was typed in. Everything on
// the row — the label, the region, the build — is that answer, so a node is named the way
// it names itself rather than by the address this browser happens to hold.
async function probeNode(origin, { fetchImpl = fetch, signal } = {}) {
  const base = normalizeHostUrl(origin);
  if (!base) return { origin, reachable: false, reason: "That is not a usable address." };

  let meta;
  try {
    const res = await fetchImpl(base + "/api/v1", { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return { origin: base, reachable: false, reason: "Answered " + res.status + "." };
    meta = await res.json();
  } catch {
    return { origin: base, reachable: false, reason: "Didn’t answer." };
  }

  // Reached something, but not one of ours. A different sentence, because "check it is
  // running" is useless advice to somebody pointed at the wrong thing entirely.
  if (!meta || (meta.name !== "kgsm-api" && !(meta.name && meta.version)))
    return { origin: base, reachable: false, reason: "Not a kgsm-api." };

  // Which doors are open. A failure here is not a failure of the node — it is reachable
  // and it is ours; we simply do not know what it offers, and an empty set draws no
  // buttons rather than wrong ones.
  let providers = [];
  let registration = false;
  try {
    const res = await fetchImpl(base + "/auth/providers", { headers: { Accept: "application/json" }, signal });
    if (res.ok) {
      const body = await res.json();
      providers = (body && body.providers) || [];
      registration = !!(body && body.registration);
    }
  } catch {}

  return {
    origin: base,
    reachable: true,
    label: meta.label || null,
    region: meta.region || null,
    build: meta.build ? String(meta.build).split("+")[0] : null,
    providers,
    registration,
  };
}

// Register a node this browser has just been pointed at, so the rest of the app can
// address it. Idempotent by origin — `addConnection` replaces a matching entry rather
// than growing a second one for the same host under a different spelling.
function adoptNode(probe) {
  if (!probe || !probe.reachable) return;
  const entry = registryEntry(probe.origin, probe.label, null);
  const known = CONNECTIONS.some(c => normalizeHostUrl(c.url) === probe.origin);
  if (known) addConnections([]);   // nothing to add; keeps the call shape uniform
  else addConnection(entry);
  rememberNode(probe.origin);
}

// How a refusal from a node should read.
//
// The backend answers a wrong username and a wrong password identically and this must not
// re-open that by guessing at one. The rest are real, different facts somebody needs:
// being locked out, being switched off, and the host's own account store being unreadable
// — which is the host's problem rather than theirs, and saying "wrong password" there
// sends them hunting for something they cannot fix.
function refusalText(body, res) {
  const code = body && body.error && body.error.code;
  if (code === "too_many_attempts") {
    const wait = Number(res && res.headers && res.headers.get("Retry-After"));
    return wait > 0
      ? `Too many attempts. Try again in ${wait} second${wait === 1 ? "" : "s"}.`
      : "Too many attempts. Try again shortly.";
  }
  if (code === "account_disabled") return "That account is disabled on this host.";
  if (code === "users_unavailable") return "This host can’t reach its accounts right now.";
  if (code === "invalid_credentials") return "That username and password don’t match an account here.";
  if (code === "username_taken") return "That username is already taken here.";
  if (code === "registration_closed") return "This host isn’t taking new accounts.";
  if (code === "not_accepting_accounts")
    return "This host is holding as many accounts awaiting approval as it will. Ask an administrator.";
  if (body && body.error && body.error.message) return body.error.message;
  return "That didn’t work — please try again.";
}

// Sign in, or sign up, against one node. Both answer with the same session shape, so the
// caller adopts one identically whichever door it came through — which is the API's own
// arrangement, not a convenience invented here.
async function submitCredentials(origin, path, payload) {
  let res;
  try {
    res = await fetch(origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Couldn’t reach this host. Check it’s running and try again.", unreachable: true };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: refusalText(body, res), code: body && body.error && body.error.code };
  return { ok: true, session: body };
}

const signIn = (origin, username, password) =>
  submitCredentials(origin, "/auth/login", { username, password });

const signUp = (origin, username, displayName, password) =>
  submitCredentials(origin, "/auth/register", { username, displayName: displayName || null, password });

// ---- The session of somebody who holds nothing ------------------------------------
//
// A pending account cannot be carried by `sessionStore`, and the reason is structural
// rather than an oversight: that store is keyed by BACKEND HOST ID, and the only way to
// learn a host's id is `GET /hosts`, which is viewer-gated. A pending caller is tier
// `none`, so they are refused it — there is no id to file them under, on any node.
//
// So the gate holds their session itself, keyed by origin, for exactly as long as they
// are waiting. `sessionStorage` because it is this tab's, like the access token it
// carries; the moment approval lands, `establishNodeSession` succeeds in full and the
// ordinary per-host session takes over and this is dropped.

const PENDING_KEY = "krystal:pending:session";

function stashPendingSession(origin, session) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      origin,
      token: session.token,
      refresh: session.refresh,
      status: session.status || "unknown",
    }));
  } catch {}
}

function readPendingSession() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.origin && p.token ? p : null;
  } catch { return null; }
}

function clearPendingSession() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch {}
}

// What this node says about the caller right now. Bare-authorized on the API precisely so
// a tierless caller can ask what they are waiting for, which makes it the one thing a
// pending browser can poll.
async function fetchMe(origin, token) {
  try {
    const res = await fetch(origin + "/api/v1/me", {
      headers: { Accept: "application/json", Authorization: "Bearer " + token },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: true, tier: body.tier || "none", status: body.status || "unknown", user: body.user || null };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ---- What a client may check before spending a round trip -------------------------
//
// Every one of these is also enforced by the node, which is the only place the answer is
// decided. They exist so somebody is told what is wrong while typing rather than after
// submitting, and a disagreement between them and the node is resolved by the node.

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 12;

// Mirrors kgsm-auth's `Usernames.IsValid`: ASCII letters, digits, '.', '_' or '-',
// beginning with a letter or a digit.
function usernameProblem(username) {
  const v = (username || "").trim();
  if (!v) return null;                       // nothing typed yet is not a complaint
  if (v.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (v.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!/^[A-Za-z0-9]/.test(v)) return "Must start with a letter or a digit.";
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return "Letters, digits, dots, underscores and hyphens only.";
  return null;
}

function usernameOk(username) {
  const v = (username || "").trim();
  return !!v && !usernameProblem(v);
}

// Four bands, because a five-point scale invites a number nothing measures. Length is
// what the node enforces; the extra bands describe a password that is comfortably past
// the floor rather than sitting on it.
function passwordStrength(password) {
  const v = password || "";
  if (!v) return { level: 0, label: "" };
  if (v.length < PASSWORD_MIN) return { level: 1, label: "Too short" };
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(v)).length;
  if (v.length >= 20 || (v.length >= 16 && variety >= 3)) return { level: 4, label: "Strong" };
  if (v.length >= 14 || variety >= 3) return { level: 3, label: "Good" };
  return { level: 2, label: "Fair" };
}

const passwordOk = (password) => (password || "").length >= PASSWORD_MIN;

export {
  LAST_NODE_KEY, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN,
  adoptNode, clearPendingSession, fetchMe, forgetNode, knownNodes, lastNodeOrigin,
  passwordOk, passwordStrength, probeNode, readPendingSession, refusalText, rememberNode,
  signIn, signUp, stashPendingSession, usernameOk, usernameProblem,
};

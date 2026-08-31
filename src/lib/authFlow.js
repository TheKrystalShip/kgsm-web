// authFlow.js — the way in, before there is anything to show.
//
// Two questions sit in front of the app: WHERE this cluster signs people in, and WHAT it offers as a
// way in. Neither is a question about a node. Identity belongs to the cluster, so the answer comes
// from the anchor — and the only thing a member is asked is where the anchor is, which it will tell
// anybody, because a browser asking has no session yet.
//
// Everything here talks to a host directly rather than through `apiClient`: every call is anonymous
// by definition, and the seam's whole job is attaching a session to a call for a member.

import { anchorIdentity, authDoors } from "./anchor.js";
import { CONNECTIONS } from "./config.js";
import { addConnection, normalizeHostUrl, registryEntry } from "./connect.js";

// The member this browser last reached the cluster through. A route and nothing more — the cluster
// is the same whichever member answers — so it saves a question rather than settling one.
const LAST_MEMBER_KEY = "krystal:member:last";

function lastMemberOrigin() {
  try { return localStorage.getItem(LAST_MEMBER_KEY) || ""; } catch { return ""; }
}
function rememberMember(origin) {
  try { if (origin) localStorage.setItem(LAST_MEMBER_KEY, origin); } catch { /* private mode */ }
}
function forgetMember() {
  try { localStorage.removeItem(LAST_MEMBER_KEY); } catch { /* private mode */ }
}

// What a member says about itself. `GET /api/v1` is also the reachability probe, deliberately: a row
// is green because something answered as a kgsm-api, never because an address was typed. Everything
// on the row is that answer, so a member is named the way it names itself.
async function probeMember(origin, { fetchImpl = fetch, signal } = {}) {
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

  // Reached something, but not one of ours — a different sentence, because "check it is running" is
  // useless advice to somebody pointed at the wrong thing entirely.
  if (!meta || (meta.name !== "kgsm-api" && !(meta.name && meta.version)))
    return { origin: base, reachable: false, reason: "Not a kgsm-api." };

  return {
    origin: base,
    reachable: true,
    label: meta.label || null,
    region: meta.region || null,
    build: meta.build ? String(meta.build).split("+")[0] : null,
  };
}

// What is at this address — the one question a fresh browser can ask, and the only thing that
// decides what happens next.
//
// There are TWO entry paths and neither is above the other. An auth anchor holds a cluster's
// accounts: sign in there, and it names the cluster's members afterwards. A standalone node holds
// its own: sign in there, and it is the whole deployment. A node that belongs to a cluster is not an
// entry path at all — it serves no auth and announces nothing about its cluster, so it can only be
// refused, and the refusal names the holder because a name is not an address.
//
// Asked of the address itself, never through anything else. Nothing here discovers a second machine.
//
//   anchor          an anchor holding a cluster's accounts — the door
//   anchor-standby  an anchor that is not holding. A promotion candidate, not a second authority,
//                   and offering it as a door puts somebody in front of one that refuses them
//   standalone      a node holding its own accounts — also a door, and the common case
//   held-elsewhere  a node whose cluster keeps its accounts somewhere this node will not name
//   unreachable     nothing answered, or what answered is not ours
//   invalid         not an address
async function identifyAddress(address, opts = {}) {
  const origin = normalizeHostUrl(address);
  if (!origin) return { kind: "invalid", origin: String(address || ""), reason: "That is not a usable address." };

  // The anchor first, because it is the only one that can name itself in a single unauthenticated
  // call. A node cannot answer this, so a miss costs one request and settles nothing incorrectly.
  const anchor = await anchorIdentity(origin, opts);
  if (anchor.ok) {
    const doors = anchor.holding ? await authDoors(origin, opts) : null;
    return {
      kind: anchor.holding ? "anchor" : "anchor-standby",
      origin, cluster: anchor.cluster,
      providers: doors ? doors.providers : [],
      redirects: doors ? doors.redirects : false,
      registration: doors ? doors.registration : false,
      reachable: doors ? doors.reachable : false,
    };
  }

  // Not an anchor. Whatever it is has to answer as a kgsm-api before anything else is worth asking,
  // so somebody pointed at the wrong thing entirely is told that rather than told about auth.
  const probe = await probeMember(origin, opts);
  if (!probe.reachable) return { kind: "unreachable", origin, reason: probe.reason };

  const doors = await authDoors(origin, opts);
  if (doors.heldBy !== null) {
    return { kind: "held-elsewhere", origin, label: probe.label, holder: doors.heldBy || "" };
  }
  return {
    kind: "standalone",
    origin, label: probe.label, build: probe.build,
    providers: doors.providers, redirects: doors.redirects,
    registration: doors.registration, reachable: doors.reachable,
  };
}


// Register a member this browser has just been pointed at, so the rest of the app can address it.
// Idempotent by origin.
function adoptMember(probe) {
  if (!probe || !probe.reachable) return;
  const known = CONNECTIONS.some(c => normalizeHostUrl(c.url) === probe.origin);
  if (!known) addConnection(registryEntry(probe.origin, probe.label, null));
  rememberMember(probe.origin);
}

// ---- The session of somebody who holds nothing ------------------------------------
//
// An account awaiting approval authenticates and is granted nothing. That session is real and worth
// keeping — it is what lets the panel say "waiting on an administrator" rather than showing a bare
// denial to somebody who did everything right — but it must not become the app's session, because
// everything behind the gate would then render for somebody entitled to none of it.
//
// A provider arrival and a fresh registration land in exactly this state, so there is one screen for
// both and registering needs no flow of its own.

const PENDING_KEY = "krystal:pending:session";

function stashPendingSession(session) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      token: session.token,
      refresh: session.refresh,
      status: session.status || "unknown",
    }));
  } catch { /* private mode */ }
}

function readPendingSession() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.token ? p : null;
  } catch { return null; }
}

function clearPendingSession() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* private mode */ }
}

// What a member says about the caller right now. Bare-authorized precisely so a tierless caller can
// ask what they are waiting for, which makes it the one thing a pending browser can poll.
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
// Every one of these is also enforced by the anchor, which is the only place the answer is decided.
// They exist so somebody is told what is wrong while typing rather than after submitting. The
// anchor's own refusal names the rule it applied, so THAT is what a refusal renders — these never
// become a second copy of the rules that drifts from the anchor's.

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 12;

// Mirrors kgsm-auth's `Usernames.IsValid`: ASCII letters, digits, '.', '_' or '-', beginning with a
// letter or a digit.
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

// Four bands, because a five-point scale invites a number nothing measures. Length is what the
// anchor enforces; the extra bands describe a password comfortably past the floor rather than
// sitting on it.
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
  LAST_MEMBER_KEY, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN,
  adoptMember, clearPendingSession, fetchMe, forgetMember, identifyAddress, lastMemberOrigin,
  passwordOk, passwordStrength, probeMember, readPendingSession, rememberMember,
  stashPendingSession, usernameOk, usernameProblem,
};

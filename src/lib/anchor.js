// anchor.js — where the cluster signs people in, and the calls that do it.
//
// Identity belongs to the cluster, not to a node. One account, one tier, one session, minted by the
// member holding the `auth` capability and accepted by every other member because each verifies the
// anchor's signature offline against its published key. So the panel asks an anchor for a session
// and asks a node for nothing: no node issues a credential to this browser, and none extends one.
//
// Everything here is anonymous or carries a token the caller passes explicitly. None of it goes
// through `apiClient` — that seam's whole job is attaching a node's bearer to a call for that node,
// which is the opposite of what an anchor call is.

const ANCHOR_KEY = "krystal:anchor";   // localStorage: where this browser last signed in

// Normalize to an http(s) origin with no trailing slash. "" if unusable.
function originOf(input) {
  const s = (input || "").trim();
  if (!s) return "";
  try { return new URL(/^https?:\/\//i.test(s) ? s : "https://" + s).origin; } catch { return ""; }
}

// ---- the deployment's own anchor (optional) -------------------------------
//
// A build may name the anchor it belongs to. OPT-IN and blank by default: an SPA with no
// configuration points at no cluster at all, which is the whole reason it can be deployed anywhere
// and pointed at anything. Set it and this build opens on that cluster's sign-in instead of asking
// for an address — the difference between a panel somebody hosts for one cluster and a panel that
// serves any of them.
//
// It is a DEFAULT, never a lock. A door somebody has already chosen wins, and "Another address" on
// the sign-in card still reaches the address box, so a configured build can be pointed elsewhere
// without a rebuild. And it is not trusted to be true: the address is classified like any other, so
// a deployment configured with something that is not an anchor is told so rather than failing at a
// sign-in.
const buildEnv = (typeof import.meta !== "undefined" && import.meta.env) || {};
const CONFIGURED_ANCHOR = originOf((buildEnv.VITE_AUTH_ANCHOR || "").trim());
function configuredAnchor() { return CONFIGURED_ANCHOR; }

// THE DOOR — where this browser signs in, and the only thing about it worth keeping. Both entry
// paths land here: an anchor holding a cluster's accounts, or a standalone node holding its own.
// `kind` is what separates them, and it decides more than wording — an anchor administers accounts
// under a cluster-scoped path a node does not have, and renews sessions a node never minted.
//
// Not a credential. A stale one costs a failed renewal, never a wrong session, because a token is
// only ever accepted on the strength of its signature.
function rememberDoor(door) {
  try {
    if (door && door.origin) localStorage.setItem(ANCHOR_KEY, JSON.stringify({ origin: door.origin, kind: door.kind || "anchor" }));
    else localStorage.removeItem(ANCHOR_KEY);
  } catch { /* private mode */ }
}
function rememberedDoor() {
  try {
    const raw = localStorage.getItem(ANCHOR_KEY);
    if (!raw) return null;
    // A bare string is an anchor address — the only shape this key ever held before it had to carry
    // a standalone node too. Read rather than discarded, so a browser mid-session is not signed out
    // to learn a field name.
    if (raw[0] !== "{") return { origin: raw, kind: "anchor" };
    const d = JSON.parse(raw);
    return d && d.origin ? { origin: d.origin, kind: d.kind === "standalone" ? "standalone" : "anchor" } : null;
  } catch { return null; }
}

// ---- discovery ------------------------------------------------------------
//
// A browser holding nothing asks any member where the cluster signs people in. Unauthenticated by
// design: it is asking BECAUSE it has no session, and what it learns is that this cluster has an
// What an address says it is, asked before anybody has classified it. Unauthenticated, because a
// browser holding nothing is exactly who is asking, and it is the only question that can be answered
// before a person has chosen a door.
//
// A clustered node announces nothing about its cluster — not the anchor's address, not its own
// membership — so there is nothing to discover THROUGH a node and no member is asked anything here.
// An address is an anchor because it says so, or it is not.
//
// `holding` is the part that decides whether a person can be sent there. An anchor standing by is a
// promotion candidate rather than a second authority, and offering it as a door puts somebody in
// front of one that refuses them.
export async function anchorIdentity(address, { fetchImpl = fetch, signal } = {}) {
  const base = originOf(address);
  if (!base) return { ok: false };
  try {
    const res = await fetchImpl(base + "/auth/identity", { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return { ok: false };
    const body = await res.json();
    // Named, not inferred. Anything else answering on this path is not an anchor, and treating a
    // 200 as proof would classify a reverse proxy as the cluster's identity authority.
    if (!body || body.name !== "kgsm-auth-anchor") return { ok: false };
    return {
      ok: true,
      origin: base,
      cluster: body.cluster || "",
      holding: body.holding !== false,
    };
  } catch {
    return { ok: false };
  }
}

// Which doors the anchor opens, asked before anybody has signed in so a page draws the buttons that
// exist rather than the ones a build assumed. A failure draws none: an empty set is the honest
// answer to "we could not ask", and it is better than a button that goes nowhere.
//
// `redirects` says whether a provider callback hands the browser back here with the session in the
// fragment. It is read rather than assumed, because an anchor with no browser in front of it turns
// it off and the page would otherwise wait for a return leg that never comes.
//
// `registration` is the same question for the sign-up door, and is read for the same reason: an
// anchor with it switched off refuses every attempt, and a tab that cannot work is worse than no
// tab. It is OFF by default on the anchor, so an anchor that does not state it is one that is not
// offering it — assuming otherwise puts a sign-up card in front of the first person to deploy this
// panel against a cluster that never turned it on.
export async function authDoors(origin, { fetchImpl = fetch, signal } = {}) {
  const closed = { providers: [], redirects: false, registration: false, reachable: false, heldBy: null };
  const base = originOf(origin);
  if (!base) return closed;
  try {
    const res = await fetchImpl(base + "/auth/providers", { headers: { Accept: "application/json" }, signal });
    // A node whose cluster holds the accounts refuses every auth path and names the holder — a name,
    // never an address, because a clustered node announces nothing about its cluster. It is the
    // difference between "this node is down" and "this node is not the door", and a person acts on
    // those differently.
    if (res.status === 503) {
      const holder = res.headers && res.headers.get ? res.headers.get("X-Kgsm-Auth-Holder") : null;
      return { ...closed, reachable: true, heldBy: holder || "" };
    }
    if (!res.ok) return closed;
    const body = await res.json();
    return {
      providers: Array.isArray(body && body.providers) ? body.providers : [],
      redirects: !!(body && body.redirects),
      registration: !!(body && body.registration),
      reachable: true,
      heldBy: null,
    };
  } catch {
    return closed;
  }
}

// The interactive provider bounce. `prompt=consent` is what makes it interactive: the bare start is
// a silent attempt, which is right for a session being renewed behind somebody's back and wrong for
// a person who has just pressed Sign in and must be able to reach the provider's own screen.
export function providerStartUrl(anchorUrl, provider) {
  const base = originOf(anchorUrl);
  if (!base || !provider) return "";
  return base + "/auth/" + encodeURIComponent(provider) + "/start?prompt=consent";
}

// ---- the anchor's own auth surface ----------------------------------------

// How a refusal reads. The anchor answers a wrong username and a wrong password identically and
// this must not re-open that by guessing at one; the rest are real, separate facts somebody needs.
export function refusalText(body, res) {
  const code = body && body.error && body.error.code;
  if (code === "account_locked") {
    const wait = Number(res && res.headers && res.headers.get("Retry-After"));
    return wait > 0
      ? `Too many attempts. Try again in ${wait} second${wait === 1 ? "" : "s"}.`
      : "Too many attempts. Try again shortly.";
  }
  if (code === "account_disabled") return "That account has been switched off.";
  if (code === "invalid_credentials") return "That username and password don’t match an account.";
  if (code === "not_accepting_accounts")
    return "The cluster is holding as many accounts awaiting approval as it will. Ask an administrator.";
  if (code === "auth_unconfigured") return "This cluster isn’t set up to sign anybody in that way.";
  if (code === "username_taken") return "That username is already taken.";
  if (code === "registration_closed") return "This cluster isn’t taking new accounts.";
  if (code === "authority_unavailable") return "The cluster can’t reach its accounts right now.";
  if (code === "not_the_anchor") return "This member no longer holds the cluster’s accounts.";
  if (body && body.error && body.error.message) return body.error.message;
  return "That didn’t work — please try again.";
}

// The two doors spell two of these differently and the rest identically. An anchor mints for a
// cluster and names its endpoints for that; a node minted for itself long before there were
// clusters. Nothing else about signing in differs, which is why this is a table and not two clients.
const DOOR_PATHS = {
  anchor: { signIn: "/auth/sign-in", signOut: "/auth/session/sign-out" },
  standalone: { signIn: "/auth/login", signOut: "/auth/logout" },
};
// A door is `{origin, kind}`. A bare string is an anchor, which is what every caller meant before a
// node could be a door.
function doorOf(door) {
  if (!door) return { origin: "", paths: DOOR_PATHS.anchor };
  if (typeof door === "string") return { origin: door, paths: DOOR_PATHS.anchor };
  return { origin: door.origin || "", paths: DOOR_PATHS[door.kind === "standalone" ? "standalone" : "anchor"] };
}

async function post(anchorUrl, path, payload, { fetchImpl = fetch } = {}) {
  const base = originOf(anchorUrl);
  if (!base) return { ok: false, error: "There is no address to sign in at.", unreachable: true };
  let res;
  try {
    res = await fetchImpl(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    // A browser cannot tell a refused connection from an origin the anchor does not admit — the
    // response is dropped before any code here sees it — so the sentence names both rather than
    // asserting the one that happens to be more common.
    return {
      ok: false, unreachable: true,
      error: "Couldn’t reach the cluster’s sign-in, or it doesn’t admit this address.",
    };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: refusalText(body, res), code: body && body.error && body.error.code, status: res.status };
  return { ok: true, session: body };
}

// One session for the whole cluster. The response carries the tier resolved now rather than read off
// a record, and the account's status, so a person holding nothing can be told they are waiting
// rather than shown a bare denial.
export const signIn = (door, username, password, opts) =>
  post(doorOf(door).origin, doorOf(door).paths.signIn, { username, password }, opts);

// Make an account. It answers with the same session shape a sign-in does, so both doors are adopted
// by one path and registering needs no flow of its own — the session it returns holds `none` at
// `pending`, which is the state a provider arrival lands in too. That is deliberate on the anchor's
// side: somebody who has just made an account is told what happens next rather than shown a denial.
//
// A refusal here names the rule the anchor applied, so the card renders the anchor's own sentence
// instead of keeping a second copy of the rules that drifts from it.
export const register = (anchorUrl, username, password, displayName, opts) =>
  post(anchorUrl, "/auth/register", { username, password, displayName: displayName || null }, opts);

// Rotate. The anchor mints both halves and the presented refresh token is spent — a replay of one
// already rotated away is refused, so the response's `refresh` is the only one worth keeping.
export const refreshSession = (anchorUrl, refresh, opts) =>
  post(anchorUrl, "/auth/session/refresh", { refresh }, opts);

// End the session everywhere. The anchor revokes the row and tells the members, which is what stops
// the remaining access bearer being spent on them for the rest of its life.
export const signOut = (door, refresh, opts) =>
  post(doorOf(door).origin, doorOf(door).paths.signOut, { refresh }, opts);

// The cluster's members, as the anchor knows them — nodes and other anchors, each with `kind`.
// Authenticated, so it is asked with the session the anchor just minted rather than anonymously: who
// is in a cluster is not something an unauthenticated caller learns.
//
// This is where the panel's fleet comes from. A clustered node announces nothing about its cluster,
// so there is no second source to reconcile against and none to disagree with. Every address in the
// answer is fetchable from a browser — the anchor OMITS a member that advertises none rather than
// falling back to the address its peers use, which would turn "not reachable from here" into
// "reachable, and permanently down".
//
// The token is passed explicitly, like every other call in this module: none of this goes through
// apiClient, whose seam exists to address nodes.
export async function clusterMembers(anchorUrl, token, { fetchImpl = fetch, signal } = {}) {
  const base = originOf(anchorUrl);
  if (!base) return { ok: false, members: [] };
  try {
    const res = await fetchImpl(base + "/auth/cluster/members", {
      headers: token ? { Accept: "application/json", Authorization: "Bearer " + token } : { Accept: "application/json" },
      signal,
    });
    if (!res.ok) return { ok: false, status: res.status, members: [] };
    const body = await res.json();
    const rows = Array.isArray(body && body.members) ? body.members : [];
    return {
      ok: true,
      cluster: (body && body.cluster) || "",
      members: rows.map((m) => ({
        memberId: m.memberId || "",
        kind: m.kind || "node",
        url: originOf(m.url) || "",
        nickname: m.nickname || null,
        status: m.status || "unknown",
        membership: m.membership || "unknown",
      })).filter((m) => m.memberId && m.url),
    };
  } catch {
    return { ok: false, members: [] };
  }
}

// Whether the cluster's own authority names the fleet. When it does, the panel keeps NO list of
// nodes between loads: the anchor is asked on every load and its answer is the whole of it, so a
// node removed from the cluster is gone the next time somebody opens the panel and a stale address
// cannot outlive the roster that named it. A standalone deployment has one node, chosen by hand,
// and keeps it exactly as it always did.
//
// Read from storage rather than from the session layer so the modules that persist connections can
// ask without importing it — they are underneath it, and an edge the other way is a cycle.
function anchorNamesTheFleet() {
  const d = rememberedDoor();
  return !!(d && d.kind === "anchor");
}

export { ANCHOR_KEY, anchorNamesTheFleet, configuredAnchor, originOf, rememberDoor, rememberedDoor };

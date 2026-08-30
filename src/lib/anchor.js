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

// The anchor this browser last used. Held so a reload can draw the sign-in before any member has
// answered — the address is not a credential and a stale one costs a failed discovery, not a wrong
// session, because the tokens are only ever accepted on the strength of their signature.
function rememberAnchor(url) {
  try { if (url) localStorage.setItem(ANCHOR_KEY, url); else localStorage.removeItem(ANCHOR_KEY); } catch { /* private mode */ }
}
function rememberedAnchor() {
  try { return localStorage.getItem(ANCHOR_KEY) || ""; } catch { return ""; }
}

// ---- discovery ------------------------------------------------------------
//
// A browser holding nothing asks any member where the cluster signs people in. Unauthenticated by
// design: it is asking BECAUSE it has no session, and what it learns is that this cluster has an
// anchor and where to knock — which the sign-in page would have told it anyway.
//
// The four answers are kept apart because a person acts on them differently, and collapsing any of
// them into "sign-in is unavailable" turns a fixable configuration into a mystery:
//
//   held, url          → sign in there
//   held, orphaned     → the assignment names a member that has left. Nothing serves it, and every
//                        other surface reads healthy, so this is the only place it can be said
//   held, url: null    → the holder is known and states no address a browser can reach
//   held: false        → this member knows of no anchor. Either the cluster has none or it has not
//                        heard; those are indistinguishable from here and both mean the same thing
//                        to a person, which is to sign in against the member they are pointed at
export async function discoverAnchor(memberOrigin, { fetchImpl = fetch, signal } = {}) {
  const base = originOf(memberOrigin);
  if (!base) return { ok: false, reason: "unreachable" };
  try {
    const res = await fetchImpl(base + "/api/v1/cluster/auth", { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const body = await res.json();
    const url = originOf(body && body.url);
    return {
      ok: true,
      held: !!(body && body.held),
      memberId: (body && body.memberId) || "",
      url: url || null,
      orphaned: !!(body && body.orphaned),
    };
  } catch {
    return { ok: false, reason: "unreachable" };
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
export async function anchorDoors(anchorUrl, { fetchImpl = fetch, signal } = {}) {
  const closed = { providers: [], redirects: false, registration: false, reachable: false };
  const base = originOf(anchorUrl);
  if (!base) return closed;
  try {
    const res = await fetchImpl(base + "/auth/providers", { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return closed;
    const body = await res.json();
    return {
      providers: Array.isArray(body && body.providers) ? body.providers : [],
      redirects: !!(body && body.redirects),
      registration: !!(body && body.registration),
      reachable: true,
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
export const signIn = (anchorUrl, username, password, opts) =>
  post(anchorUrl, "/auth/sign-in", { username, password }, opts);

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
export const signOut = (anchorUrl, refresh, opts) =>
  post(anchorUrl, "/auth/session/sign-out", { refresh }, opts);

export { ANCHOR_KEY, originOf, rememberAnchor, rememberedAnchor };

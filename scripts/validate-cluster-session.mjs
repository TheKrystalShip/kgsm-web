// One session, for the whole cluster — the properties that make it one, in the real modules.
//
// None of this is layout, so jsdom is the right place for it, and none of it can be reached by the
// live smoke: that runs against an AUTH-DISABLED backend, which by definition exercises no part of
// a session. Every network call is stubbed and COUNTED, so "it did not ask a node for a credential"
// is a measured zero rather than an assertion about an absence.
//
// The session is the provider's, held through oidc-client-ts. It is seeded the way the library
// stores one after a round trip, because the round trip itself is a page navigation to the
// provider's own pages that jsdom cannot perform; the visual harness drives that part in a browser.
//
//   node scripts/validate-cluster-session.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://kgsm.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.document = dom.window.document;

const ANCHOR = "https://auth.kgsm.test";
const CLIENT = "kgsm.test";   // this page's origin's host — the client id it signs in as
const USER_KEY = `krystal:oidc:user:${ANCHOR}:${CLIENT}`;

// Where this panel signs in, as the gate records it after asking.
localStorage.setItem("krystal:provider", JSON.stringify({ issuer: ANCHOR, via: "https://kgsm.test" }));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => "h." + b64(claims) + ".s";
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;
const access = (n, exp = inAnHour()) => jwt({ sid: "sid_1", exp, n });

// The session as oidc-client-ts stores it after a sign-in.
function seed({ token, refresh, expiresAt = inAnHour() }) {
  localStorage.setItem(USER_KEY, JSON.stringify({
    id_token: jwt({ sub: "usr_1", sid: "psid_1" }), access_token: token, refresh_token: refresh,
    token_type: "Bearer", scope: "openid", profile: { sub: "usr_1", sid: "psid_1" }, expires_at: expiresAt,
  }));
}
const stored = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; } };

const calls = [];
let refuseRefresh = false;
let refuseMembers = false;
let anchorDown = false;
let minted = 1;

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  const body = opts && opts.body ? String(opts.body) : "";
  calls.push({ u, method, body });

  if (u.startsWith(ANCHOR)) {
    if (anchorDown) throw new TypeError("Failed to fetch");
    if (u.endsWith("/.well-known/openid-configuration")) {
      return json({
        issuer: ANCHOR, authorization_endpoint: ANCHOR + "/authorize", token_endpoint: ANCHOR + "/token",
        userinfo_endpoint: ANCHOR + "/userinfo", jwks_uri: ANCHOR + "/.well-known/jwks.json",
        end_session_endpoint: ANCHOR + "/sign-out", response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (u.endsWith("/token")) {
      if (refuseRefresh) return json({ error: "invalid_grant", error_description: "That session has ended." }, 400);
      minted += 1;
      return json({ access_token: access(minted), token_type: "Bearer", expires_in: 900,
        refresh_token: "refresh." + minted, scope: "openid" });
    }
    if (u.endsWith("/auth/cluster/members")) {
      // Who is in a cluster is not something an unauthenticated caller learns, so this refuses a
      // bearer it does not know exactly the way the provider does.
      const headers = (opts && opts.headers) || {};
      const bearer = headers.Authorization || headers.authorization || "";
      if (refuseMembers || bearer !== "Bearer " + current())
        return json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, 401);
      return json({
        cluster: "kgsm-cluster",
        members: [{ memberId: "hotrod", kind: "node", url: "https://kgsm.test",
                    status: "reachable", membership: "alive" }],
      });
    }
  }
  // A MEMBER, with auth switched on. Load-bearing: a node answering `/me` 200 would tell the session
  // layer this is an auth-DISABLED deployment, and an open session has nothing to renew.
  if (u.endsWith("/api/v1/me")) {
    return json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, 401);
  }
  return json({});
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const { sessionStore } = await import("../src/lib/sessionStore.js");
const current = () => sessionStore.tokenOf();

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const memberCredentialCalls = () => calls.filter(c => !c.u.startsWith(ANCHOR) && /\/(auth|token)/.test(new URL(c.u).pathname)).length;
const renewalsSince = (mark) => calls.slice(mark).filter(c => c.u === ANCHOR + "/token" && c.body.includes("grant_type=refresh_token"));

// 1. A stored session is restored before anything mounts, whole.
seed({ token: access(1), refresh: "refresh.1" });
await sessionStore.restore();
check(sessionStore.isLive() && sessionStore.accountOf() === "active",
  "a stored session is restored, standing active — the provider gives a session to nothing else", sessionStore.accountOf());

// 2. ONE token, and it is the same one for every member. There is no per-member token to differ.
check(sessionStore.tokenOf() === access(1), "one bearer is held");
check(sessionStore.statusOf() === "live", "and one status, with no member named to ask about");

// 3. Renewal is the refresh grant at the PROVIDER and nowhere else. A member that could re-mint would
//    be a second door to the same session on every machine.
let mark = calls.length;
sessionStore.expire();
const outcome = await sessionStore.rotate();
let spent = renewalsSince(mark);
check(outcome === "live", "a lapsed session renews", outcome);
check(spent.length === 1 && spent[0].body.includes("refresh_token=refresh.1"), "through the refresh grant at the provider", String(spent.length));
check(spent.length === 1 && spent[0].body.includes("client_id=" + CLIENT), "as the client this origin is", CLIENT);
check(memberCredentialCalls() === 0, "and no member was ever asked for one", String(memberCredentialCalls()));

// 4. The renewed session is the one the new token carries, and it says who, never what: what the
//    person may do is each member's `/me/access`.
const heldN = JSON.parse(Buffer.from(String(sessionStore.tokenOf()).split(".")[1], "base64url").toString()).n;
check(heldN === minted, "the bearer the renewal minted is the one held", String(heldN));
check(stored() && stored().refresh_token === "refresh.2", "and the rotated refresh token replaces the spent one");

// 5. A member refusing is a fact about THAT MEMBER and leaves the session alone.
sessionStore.markNode("node-b", "refusing", "unverified_here");
check(sessionStore.isLive(), "a member refusing does not end the session");
check(sessionStore.nodeAccepts("hotrod") && !sessionStore.nodeAccepts("node-b"), "it is recorded against that member and no other");
check(sessionStore.nodeRefusal("node-b").reason === "unverified_here", "carrying the refusal it gave");

// 6. A renewed session is re-offered to every member that was refusing it.
await sessionStore.rotate();
check(sessionStore.nodeAccepts("node-b"), "renewing clears every member's refusal");

// 7. A provider that cannot be reached is an OUTAGE, not a session that ended.
anchorDown = true;
sessionStore.expire();
await sessionStore.rotate();
check(sessionStore.statusOf() === "expired", "an unreachable provider lapses the session");
check(stored() && stored().refresh_token, "but the session is KEPT — there was nowhere to spend it, not a refusal");

// 8. A refusal IS the end, and the dead session goes so it is not retried.
anchorDown = false; refuseRefresh = true;
await sessionStore.rotate();
check(sessionStore.statusOf() === "expired", "a refused renewal ends the session");
await new Promise(r => setTimeout(r, 10));
check(stored() === null, "and the dead session is dropped");
refuseRefresh = false;

// 9. A reload restores a session whose bearer has already lapsed. The roster is the ONLY
//    authenticated call a clustered panel makes, so it renews first rather than spending a dead one.
const { fleetStore, refreshFleetFromAnchor } = await import("../src/lib/fleet.js");
seed({ token: access(9, Math.floor(Date.now() / 1000) - 60), refresh: "refresh.9", expiresAt: Math.floor(Date.now() / 1000) - 60 });
await sessionStore.restore();
check(sessionStore.statusOf() === "expired", "a restored session with a lapsed bearer is held, not live");

mark = calls.length;
const fleet = await refreshFleetFromAnchor();
spent = renewalsSince(mark);
check(spent.length === 1, "so it is renewed at the provider before the roster is asked", String(spent.length));
check(fleet.ok && fleetStore.getState().state === "ready", "and the cluster answers", fleetStore.getState().state);

// 10. A refusal the bearer's own expiry did not predict is renewed once and asked again. ONCE: a
//     second refusal is the provider describing the session, and asking a third time is a loop.
refuseMembers = true;
mark = calls.length;
await refreshFleetFromAnchor();
const asked = calls.slice(mark).filter(c => c.u.endsWith("/auth/cluster/members"));
spent = renewalsSince(mark);
check(asked.length === 2, "a refused roster is asked exactly twice", String(asked.length));
check(spent.length === 1, "with exactly one renewal between", String(spent.length));
check(fleetStore.getState().state === "ready", "and a roster already landed is not thrown away over it", fleetStore.getState().state);
refuseMembers = false;

// 11. Signing out is the provider's end-session endpoint, carrying the id token that names the
//     provider session — and nothing is left behind locally whether or not the page gets there. A
//     sign-out that is leaving never resolves: the page it would resolve on is gone.
const signingOut = await Promise.race([
  sessionStore.signOut().then((leaving) => (leaving ? "left" : "stayed")),
  new Promise(r => setTimeout(() => r("leaving"), 200)),
]);
check(signingOut === "leaving" || signingOut === "left", "signing out leaves for the provider", signingOut);
check(sessionStore.statusOf() === "none" && stored() === null, "and nothing is left behind locally");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

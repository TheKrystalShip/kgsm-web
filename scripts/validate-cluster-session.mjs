// One session, for the whole cluster — the properties that make it one, in the real modules.
//
// None of this is layout, so jsdom is the right place for it, and none of it can be reached by the
// live smoke: that runs against an AUTH-DISABLED backend, which by definition exercises no part of
// a session. Every network call is stubbed and COUNTED, so "it did not ask a node for a credential"
// is a measured zero rather than an assertion about an absence.
//
//   node scripts/validate-cluster-session.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://kgsm.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.document = dom.window.document;

const ANCHOR = "https://auth.kgsm.test";
// The door is chosen by a person and stored. Nothing discovers it, because a clustered node
// announces nothing about its cluster — which is why no stub below answers for one.
localStorage.setItem("krystal:anchor", JSON.stringify({ origin: ANCHOR, kind: "anchor" }));
localStorage.setItem("krystal:hosts:registry", JSON.stringify([
  { id: "hotrod", url: "https://kgsm.test", name: "hotrod" },
  { id: "hotbox", url: "https://hotbox.test", name: "hotbox" },
]));

const calls = [];
let refuseRefresh = false;
let anchorDown = false;

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  calls.push({ u, method });

  if (u.startsWith(ANCHOR)) {
    if (anchorDown) throw new TypeError("Failed to fetch");
    if (u.endsWith("/auth/providers")) {
      return json({ providers: ["discord"], redirects: true, registration: true });
    }
    if (u.endsWith("/auth/session/refresh")) {
      if (refuseRefresh) return json({ error: { code: "invalid_refresh_token", message: "gone" } }, 401);
      return json({ token: "access.2", refresh: "refresh.2", tier: "operator", expiresAt: "2026-01-01T00:00:00Z" });
    }
    if (u.endsWith("/auth/sign-in")) {
      return json({ token: "access.1", refresh: "refresh.1", tier: "admin", userId: "usr_1", status: "active" });
    }
    if (u.endsWith("/auth/session/sign-out")) return json({});
  }
  return json({});
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const { sessionStore } = await import("../src/lib/sessionStore.js");
const anchor = await import("../src/lib/anchor.js");

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const nodeCredentialCalls = () => calls.filter(c =>
  !c.u.startsWith(ANCHOR) && /\/auth\/(session\/refresh|sign-in|register|cluster-session)/.test(c.u)).length;

// 1. Signing in reaches the ANCHOR, and nothing else issues a credential.
const res = await anchor.signIn(ANCHOR, "heisen", "hunter22hunter22");
check(res.ok && res.session.token === "access.1", "the anchor mints the session");
sessionStore.adoptSession({
  token: res.session.token, refresh: res.session.refresh,
  tier: res.session.tier, account: res.session.status,
});
check(sessionStore.isLive() && sessionStore.tierOf() === "admin", "which is adopted whole", sessionStore.tierOf());

// 2. ONE token, and it is the same one for every member. There is no per-member token to differ.
check(sessionStore.tokenOf() === "access.1", "one bearer is held", sessionStore.tokenOf());
check(sessionStore.statusOf() === "live", "and one status, with no member named to ask about");

// 3. Renewal goes to the anchor and NOWHERE else. This is the rule the whole design rests on: a
//    member that could re-mint would be a second door to the same session on every machine.
const before = calls.length;
sessionStore.expire();
const outcome = await sessionStore.rotate();
const renewals = calls.slice(before).filter(c => c.u.endsWith("/auth/session/refresh"));
check(outcome === "live", "a lapsed session renews", outcome);
check(renewals.length === 1 && renewals[0].u.startsWith(ANCHOR), "at the anchor", renewals.map(c => c.u).join());
check(nodeCredentialCalls() === 0, "and no member was ever asked for one", String(nodeCredentialCalls()));

// 4. The renewed tier is adopted as given — the anchor resolved it now, so a demotion lands exactly
//    like a promotion rather than being treated as a downgrade to argue with.
check(sessionStore.tierOf() === "operator", "the tier the anchor answered with is taken as given",
  sessionStore.tierOf());

// 5. A member refusing is a fact about THAT MEMBER and leaves the session alone. This is the one
//    that does not follow from a per-node model: a member verifies the signature offline but can
//    only say what somebody may do once its replica carries their account.
sessionStore.markNode("hotbox", "refusing", "unknown_here");
check(sessionStore.isLive(), "a member refusing does not end the session");
check(sessionStore.nodeAccepts("hotrod") && !sessionStore.nodeAccepts("hotbox"),
  "it is recorded against that member and no other");
check(sessionStore.nodeRefusal("hotbox").reason === "unknown_here",
  "carrying WHICH refusal, since the two resolve differently");

// 6. A renewed session is re-offered to every member that was refusing it — none of those refusals
//    were about the session, so none of them survive a new one.
await sessionStore.rotate();
check(sessionStore.nodeAccepts("hotbox"), "renewing clears every member's refusal");

// 7. An anchor that cannot be reached is an OUTAGE, not a session that ended. Different states,
//    because one is waited out and the other is signed in again.
anchorDown = true;
sessionStore.expire();
await sessionStore.rotate();
check(sessionStore.statusOf() === "expired", "an unreachable anchor lapses the session");
check(localStorage.getItem("krystal:refresh") === "refresh.2",
  "but the credential is KEPT — there was nowhere to spend it, not a refusal",
  String(localStorage.getItem("krystal:refresh")));

// 8. A refusal IS the end, and the dead credential goes so it is not retried.
anchorDown = false; refuseRefresh = true;
await sessionStore.rotate();
check(sessionStore.statusOf() === "expired", "a refused renewal ends the session");
check(localStorage.getItem("krystal:refresh") === null, "and the dead credential is dropped");

// 9. Signing out tells the anchor, which is what stops the bearer still in this tab being spent on
//    the members for the rest of its life.
refuseRefresh = false;
sessionStore.adoptSession({ token: "access.3", refresh: "refresh.3", tier: "admin", account: "active" });
const beforeOut = calls.length;
sessionStore.signOut();
await new Promise(r => setTimeout(r, 10));
const outs = calls.slice(beforeOut).filter(c => c.u.endsWith("/auth/session/sign-out"));
check(outs.length === 1 && outs[0].u.startsWith(ANCHOR), "signing out reaches the anchor");
check(sessionStore.statusOf() === "none" && localStorage.getItem("krystal:refresh") === null,
  "and nothing is left behind locally");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

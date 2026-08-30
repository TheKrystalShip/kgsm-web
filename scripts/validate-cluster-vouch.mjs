// Vouching mints a session; renewing keeps the one there is. The two must not be confused.
//
// A vouch is how somebody reaches a node this browser holds nothing for. Every session a node
// issues — vouched or not — comes with a refresh token, so a node whose access token has merely
// lapsed is renewable, and minting a second session for it adds a row nothing will ever sign out
// and an audit entry for an event that did not happen.
//
// The case this pins is a RACE, not a state: several calls carrying one lapsed token answer 401
// together. The first flips the record to `expired` and starts a rotate; every other one then finds
// a status that is no longer `live` beside a sibling that is, and mints. Once per token lifetime,
// for as long as the panel is open.
//
// Pure module test: the real sessionStore over a jsdom localStorage, with fetch stubbed so that a
// vouch which should not happen is a counted call rather than a missing assertion.
//
//   node scripts/validate-cluster-vouch.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://kgsm.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.document = dom.window.document;

const REGISTRY_KEY = "krystal:hosts:registry";
localStorage.setItem(REGISTRY_KEY, JSON.stringify([
  { id: "hotrod", url: "https://kgsm.test", name: "hotrod", via: "manual" },
  { id: "hotbox", url: "https://hotbox.test", name: "hotbox", via: "roster" },
]));

// Every network call is counted and answered here, so "it did not vouch" is measured rather than
// inferred from nothing having happened.
const calls = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  calls.push({ url: u, method: (opts && opts.method) || "GET" });
  if (u.includes("/auth/cluster-session/request")) {
    return new Response(JSON.stringify({
      accessToken: "minted.access", refreshToken: "minted.refresh", sid: "sid_new",
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.endsWith("/me")) {
    return new Response(JSON.stringify({ user: { id: "local:x", username: "x" }, tier: "admin", status: "active" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
};

const { sessionStore } = await import("../src/lib/sessionStore.js");

let fail = 0;
const assert = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const vouchCalls = () => calls.filter(c => c.url.includes("/auth/cluster-session/request")).length;

// A live sibling, which is what makes a vouch possible at all.
sessionStore.adoptSession("hotbox", { token: "hotbox.access", refresh: "hotbox.refresh", tier: "admin" });
assert(sessionStore.statusOf("hotbox") === "live", "the sibling holds a live session");

// 1. A node whose session is merely LAPSED is renewable, and renewing is not vouching.
sessionStore.adoptSession("hotrod", { token: "hotrod.access", refresh: "hotrod.refresh", tier: "admin" });
sessionStore.expire("hotrod");                       // what a 401 does before the replay rotates
assert(sessionStore.statusOf("hotrod") === "expired", "and the target's own session has lapsed");

const before = vouchCalls();
const vouched = await sessionStore.vouch("hotrod");
assert(vouched === false, "a lapsed session is not vouched over", "returned " + vouched);
assert(vouchCalls() === before, "and no session was minted", "vouch calls: " + (vouchCalls() - before));

// 2. The refresh token survives, so the rotate that owns this node still has what it needs.
assert(localStorage.getItem("krystal:hostrefresh:hotrod") === "hotrod.refresh",
  "the refresh token the rotate will spend is untouched");

// 3. A node this browser holds NOTHING for is exactly what a vouch is for.
//    This is also the state a failed rotate leaves behind — it forgets the dead credential — so
//    a session that genuinely cannot be renewed still has a way back in.
sessionStore.forgetHost("hotrod");
assert(sessionStore.statusOf("hotrod") === "none", "a node with no session reads as none");
const before2 = vouchCalls();
const minted = await sessionStore.vouch("hotrod");
assert(minted === true, "is vouched onto", "returned " + minted);
assert(vouchCalls() === before2 + 1, "with exactly one session minted", "vouch calls: " + (vouchCalls() - before2));
assert(sessionStore.statusOf("hotrod") === "live", "and the node is live afterwards");

// 4. Having been vouched onto, it is renewable like any other — so the next lapse rotates rather
//    than minting again. This is the loop the guard closes: without it, every token lifetime
//    produced a fresh session for as long as the panel stayed open.
sessionStore.expire("hotrod");
const before3 = vouchCalls();
const again = await sessionStore.vouch("hotrod");
assert(again === false && vouchCalls() === before3,
  "a vouched session renews on its next lapse instead of minting another");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

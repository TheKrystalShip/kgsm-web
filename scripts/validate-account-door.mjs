// Where an account call goes — the one question apiClient answers in one place, measured.
//
// A cluster whose accounts are held by an anchor administers them AT the anchor: a write that lands
// in a member's read-only replica is overwritten by the next thing the anchor publishes, so it
// looks like it worked and then quietly has not. A cluster without an anchor holds its own, and
// every call goes where it always did. Both must hold, and the second is the one nothing else
// covers — the live smoke runs against an AUTH-DISABLED backend, which reports no anchor and
// exercises no account surface at all.
//
// Every fetch is recorded with its ORIGIN, so "no account write reached a member" is a measured
// zero rather than an assertion about an absence.
//
// The two clusters run as separate PROCESSES, because "no anchor" is not a state the module graph
// can be talked back into — a standalone install boots without one, and that is the thing under
// test.
//
//   node scripts/validate-account-door.mjs

import { spawnSync } from "node:child_process";

import { JSDOM } from "jsdom";

// Run once per door when invoked with neither named.
if (!process.env.KGSM_DOOR) {
  let bad = 0;
  for (const door of ["anchor", "node"]) {
    console.log(`\n--- a cluster whose accounts the ${door === "anchor" ? "anchor" : "node"} holds ---`);
    const r = spawnSync(process.execPath, [process.argv[1]], {
      stdio: "inherit", env: { ...process.env, KGSM_DOOR: door },
    });
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://kgsm.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.document = dom.window.document;

const NODE = "https://kgsm.test";
const ANCHOR = "https://auth.kgsm.test";

localStorage.setItem("krystal:hosts:registry", JSON.stringify([
  { id: "hotrod", url: NODE, name: "hotrod" },
]));

// The door is a stored fact chosen by a person, never discovered through a node: a clustered node
// announces nothing about its cluster, so there is nothing to ask one. This is the whole of what
// decides where an account call goes.
const held = process.env.KGSM_DOOR !== "node";
localStorage.setItem("krystal:anchor", JSON.stringify(
  held ? { origin: ANCHOR, kind: "anchor" } : { origin: NODE, kind: "standalone" }));

const calls = [];
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  calls.push({ u, method, credentials: (opts && opts.credentials) || null, body: opts && opts.body });

  if (/\/auth\/(cluster\/)?users$/.test(u)) return json({ data: [{ id: "usr_1", username: "heisen" }] });
  if (u.endsWith("/auth/identities")) {
    return json({
      userId: "usr_1", username: "heisen", hasPassword: true,
      identities: [held
        ? { credentialId: "cred_9", provider: "discord", handle: "heisen#0" }
        : { id: "cred_9", provider: "discord", handle: "heisen#0" }],
      providers: [{ provider: "discord", configured: true, linked: true }],
      reauth: { fresh: true, windowMinutes: 10 },
    });
  }
  if (u.includes("/auth/sessions")) return json({ data: [{ sid: "sid_1", userId: "local:usr_1", current: true }] });
  if (u.endsWith("/start")) return json({ url: "https://discord.test/oauth" });
  return json({});
};

const { sessionStore } = await import("../src/lib/sessionStore.js");
const { api } = await import("../src/lib/apiClient.js");

sessionStore.adoptSession({ token: "access.1", refresh: "refresh.1", tier: "admin", account: "active" });

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const since = (n) => calls.slice(n);
// Only the ACCOUNT traffic. The session layer legitimately talks to the member — /me, discovery —
// and counting that here would measure the wrong thing.
const at = (origin, list) => list.filter((c) => c.u.startsWith(origin) && /\/auth\//.test(c.u));
// A clustered node is never asked anything about its cluster's identity — the route that answered
// that is gone, and nothing here may depend on it.
const askedNodeAboutAuth = () => calls.some((c) => c.u.includes("/api/v1/cluster/auth"));

let mark = calls.length;

if (held) {
// ---- A cluster whose accounts an anchor holds ----------------------------
const list = await api.users("hotrod").list();
check(list.length === 1, "the account list reads");
check(at(ANCHOR, since(mark)).length === 1, "and it was read at the anchor",
  String(at(ANCHOR, since(mark)).map((c) => c.u)));
check(at(NODE, since(mark)).length === 0, "with nothing asked of the member", String(at(NODE, since(mark)).length));
check(since(mark).some((c) => c.u === ANCHOR + "/auth/cluster/users"),
  "at the cluster-scoped path, not the node's");

mark = calls.length;
await api.users("hotrod").update("usr_1", { tier: "operator" });
await api.users("hotrod").remove("usr_1");
await api.users("hotrod").setPassword("usr_1", "hunter2");
check(at(NODE, since(mark)).length === 0, "no account WRITE reaches a member either",
  String(at(NODE, since(mark)).map((c) => c.method + " " + c.u)));
check(since(mark).filter((c) => c.method === "DELETE").length === 1, "a delete is sent as DELETE");

// The two doors spell the same two fields differently. Sending the node's spelling to the anchor
// would be refused as a missing current password, which reads to a person as a wrong one.
mark = calls.length;
await api.users("hotrod").changePassword("old", "new");
const pw = since(mark).find((c) => c.u.endsWith("/auth/password"));
check(pw && pw.u.startsWith(ANCHOR), "a password change goes to the anchor");
check(pw && JSON.parse(pw.body).current === "old" && JSON.parse(pw.body).password === "new",
  "in the anchor's spelling", pw && pw.body);

// A credential is named `credentialId` at the anchor and `id` on a node. The screen reads one field.
mark = calls.length;
const ids = await api.identities("hotrod").list();
check(ids.identities[0].id === "cred_9", "an anchor credential is normalised to the id the screen reads",
  JSON.stringify(ids.identities[0]));

// The link ticket is a cookie, and a cross-origin fetch keeps one only when asked.
mark = calls.length;
await api.identities("hotrod").startLink("discord");
const start = since(mark).find((c) => c.u.endsWith("/start"));
check(start && start.credentials === "include", "the link start asks the browser to keep the ticket",
  String(start && start.credentials));
mark = calls.length;
await api.identities("hotrod").list();
const read = since(mark).find((c) => c.u.endsWith("/auth/identities"));
check(read && read.credentials === null,
  "and nothing else is credentialed — one missing CORS header would take every account read with it");

// A session's rows sit with whatever minted it. In an anchored cluster the members mint none, so
// asking one returns an honest empty list that reads as "no other devices".
mark = calls.length;
const sess = await api.sessions("hotrod").list();
check(sess.sessions.length === 1, "the session list reads");
check(at(NODE, since(mark)).length === 0, "and no member was asked for it",
  String(at(NODE, since(mark)).map((c) => c.u)));

mark = calls.length;
await api.sessions("hotrod").revokeUser("usr_1");
const all = since(mark).find((c) => c.u.includes("revoke-all"));
check(all && all.u === ANCHOR + "/auth/cluster/users/usr_1/sessions/revoke-all",
  "logging somebody out everywhere is scoped under the cluster's accounts", all && all.u);

// Ending ONE of somebody's sessions is scoped under the account too, so the anchor's check is
// "is this session that person's" rather than "does this session exist".
mark = calls.length;
await api.sessions("hotrod").revokeSid("usr_1", "sid_1");
const one = since(mark).find((c) => c.u.includes("/revoke"));
check(one && one.u === ANCHOR + "/auth/cluster/users/usr_1/sessions/sid_1/revoke",
  "and ending one of them names whose it is", one && one.u);

// A screen about the CLUSTER's accounts holds no node, and needs none: the anchor is addressed by
// its own origin and the host id is never read. This is what lets the anchor's page exist at all.
mark = calls.length;
const noNode = await api.sessions(null).list("usr_1");
check(noNode && Array.isArray(noNode.sessions), "sessions read with no node named at all");
check(since(mark).every((c) => c.u.startsWith(ANCHOR)), "asked of the anchor, which is what addresses them",
  String(since(mark).map((c) => c.u)));

// Sign-out is the one auth call that never resolves a door: it is the member's own.
mark = calls.length;
await api.logout("hotrod");
check(at(ANCHOR, since(mark)).length === 0, "sign-out stays with the member",
  String(at(ANCHOR, since(mark)).map((c) => c.u)));

} else {
// ---- A cluster that holds its own accounts -------------------------------
// The common case, and the one a regression here would break silently: a standalone install has no
// anchor to fall back to.
mark = calls.length;
await api.users("hotrod").list();
const solo = since(mark);
check(at(ANCHOR, solo).length === 0, "with no anchor, nothing is asked of one", String(at(ANCHOR, solo).map((c) => c.u)));
check(solo.some((c) => c.u === NODE + "/auth/users"), "and the accounts are read on the node itself",
  String(solo.map((c) => c.u)));

mark = calls.length;
await api.users("hotrod").changePassword("old", "new");
const pw2 = since(mark).find((c) => c.u.endsWith("/auth/password"));
check(pw2 && pw2.u.startsWith(NODE), "a password change stays on the node");
check(pw2 && JSON.parse(pw2.body).currentPassword === "old" && JSON.parse(pw2.body).newPassword === "new",
  "in the node's spelling", pw2 && pw2.body);

mark = calls.length;
await api.sessions("hotrod").list();
await api.sessions("hotrod").revokeUser("usr_1");
const solo2 = since(mark);
check(at(ANCHOR, solo2).length === 0, "sessions are the node's too when it mints them");
check(solo2.some((c) => c.u === NODE + "/auth/users/usr_1/sessions/revoke-all"),
  "and revoke-all keeps the node's own accounts path", String(solo2.map((c) => c.u)));

mark = calls.length;
await api.sessions("hotrod").revokeSid("usr_1", "sid_1");
const one2 = since(mark).find((c) => c.u.includes("/revoke"));
check(one2 && one2.u === NODE + "/auth/sessions/sid_1/revoke",
  "and a node keeps its own unscoped single revoke", one2 && one2.u);

// The same call with no node named. Here the door IS a node, and the id is what addresses one, so
// its absence is refused rather than answered from whichever connection happens to be first.
let refused = null;
try { await api.sessions(null).list("usr_1"); } catch (e) { refused = e; }
check(refused instanceof Error && /concrete host id/.test(refused.message),
  "a node's sessions cannot be read without naming the node", refused ? refused.message : "(no error)");

mark = calls.length;
await api.identities("hotrod").startLink("discord");
const start2 = since(mark).find((c) => c.u.endsWith("/start"));
check(start2 && start2.u.startsWith(NODE) && !start2.credentials,
  "and the link flow is same-origin, needing nothing said about credentials");
}

check(!askedNodeAboutAuth(), "and no node was asked where this browser signs in");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

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

// The door is discovered, never assumed — this is the only thing that decides it, and it is what a
// member's /cluster/auth would be saying.
const held = process.env.KGSM_DOOR !== "node";

const calls = [];
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  calls.push({ u, method, credentials: (opts && opts.credentials) || null, body: opts && opts.body });

  if (u.endsWith("/api/v1/cluster/auth")) {
    return json(held
      ? { held: true, memberId: "hotrod-auth", url: ANCHOR, orphaned: false }
      : { held: false, memberId: null, url: null, orphaned: false });
  }
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

// Revoking takes authority away rather than granting it, and the rows belong to whoever holds them.
mark = calls.length;
await api.sessions("hotrod").list();
await api.logout("hotrod");
check(at(ANCHOR, since(mark)).length === 0, "sessions and sign-out stay with the member",
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
await api.identities("hotrod").startLink("discord");
const start2 = since(mark).find((c) => c.u.endsWith("/start"));
check(start2 && start2.u.startsWith(NODE) && !start2.credentials,
  "and the link flow is same-origin, needing nothing said about credentials");
}

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

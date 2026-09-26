// Where an account call goes — the one question apiClient answers in one place, measured.
//
// A cluster's accounts are administered at its sign-in provider: a write that landed in a member's
// read-only replica would be overwritten by the next thing the provider published, so it would look
// like it worked and then quietly not have. A panel that knows of no provider — a host run with auth
// switched off — has nowhere to send one, and refuses the call rather than guessing a member. The
// live smoke runs against an AUTH-DISABLED backend, which reports no provider and exercises no
// account surface at all, so this is the only place the first half is covered.
//
// Every fetch is recorded with its ORIGIN, so "no account write reached a member" is a measured
// zero rather than an assertion about an absence.
//
// The two states run as separate PROCESSES, because "no provider" is not a state the module graph
// can be talked back into.
//
//   node scripts/validate-account-door.mjs

import { spawnSync } from "node:child_process";

import { JSDOM } from "jsdom";

if (!process.env.KGSM_PROVIDER) {
  let bad = 0;
  for (const state of ["known", "none"]) {
    console.log(`\n--- ${state === "known" ? "a panel that knows its cluster's provider" : "a panel that knows none"} ---`);
    const r = spawnSync(process.execPath, [process.argv[1]], {
      stdio: "inherit", env: { ...process.env, KGSM_PROVIDER: state },
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
const known = process.env.KGSM_PROVIDER === "known";

localStorage.setItem("krystal:hosts:registry", JSON.stringify([{ id: "hotrod", url: NODE, name: "hotrod" }]));
if (known) {
  localStorage.setItem("krystal:provider", JSON.stringify({ issuer: ANCHOR, via: NODE }));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  localStorage.setItem(`krystal:oidc:user:${ANCHOR}:kgsm.test`, JSON.stringify({
    id_token: "h." + b64({ sub: "usr_1" }) + ".s", access_token: "h." + b64({ exp }) + ".s",
    refresh_token: "refresh.1", token_type: "Bearer", scope: "openid", profile: { sub: "usr_1" }, expires_at: exp,
  }));
}

const calls = [];
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  calls.push({ u, method, credentials: (opts && opts.credentials) || null, body: opts && opts.body });

  if (/\/auth\/cluster\/users$/.test(u)) return json({ data: [{ id: "usr_1", username: "heisen" }] });
  if (/\/sessions$/.test(u)) return json({ data: [{ sid: "sid_1", userId: "usr_1", current: false }] });
  if (u.endsWith("/api/v1/me")) return json({ error: { code: "unauthenticated" } }, 401);
  return json({});
};

const { sessionStore } = await import("../src/lib/sessionStore.js");
const { api } = await import("../src/lib/apiClient.js");
await sessionStore.restore();

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const since = (n) => calls.slice(n);
// Only the ACCOUNT traffic. The session layer legitimately talks to the member, and counting that
// here would measure the wrong thing.
const at = (origin, list) => list.filter((c) => c.u.startsWith(origin) && /\/auth\//.test(c.u));

let mark = calls.length;

if (known) {
  const list = await api.users().list();
  check(list.length === 1, "the account list reads");
  check(since(mark).some((c) => c.u === ANCHOR + "/auth/cluster/users"), "at the provider's accounts path",
    String(since(mark).map((c) => c.u)));
  check(at(NODE, since(mark)).length === 0, "with nothing asked of the member", String(at(NODE, since(mark)).length));

  mark = calls.length;
  await api.users("hotrod").update("usr_1", { status: "disabled" });
  await api.users("hotrod").remove("usr_1");
  await api.users("hotrod").setPassword("usr_1", "hunter2");
  check(at(NODE, since(mark)).length === 0, "no account WRITE reaches a member, whatever node a screen names",
    String(at(NODE, since(mark)).map((c) => c.method + " " + c.u)));
  check(since(mark).filter((c) => c.method === "DELETE").length === 1, "a delete is sent as DELETE");
  check(since(mark).every((c) => c.credentials === null),
    "and nothing is credentialed — the provider admits client origins without them");

  mark = calls.length;
  const sess = await api.sessions().list("usr_1");
  check(sess.sessions.length === 1, "somebody's sessions read");
  check(since(mark).some((c) => c.u === ANCHOR + "/auth/cluster/users/usr_1/sessions"),
    "scoped under their account at the provider", String(since(mark).map((c) => c.u)));

  mark = calls.length;
  await api.sessions().revokeUser("usr_1");
  const all = since(mark).find((c) => c.u.includes("revoke-all"));
  check(all && all.u === ANCHOR + "/auth/cluster/users/usr_1/sessions/revoke-all",
    "signing somebody out everywhere is scoped under their account", all && all.u);

  mark = calls.length;
  await api.sessions().revokeSid("usr_1", "sid_1");
  const one = since(mark).find((c) => c.u.includes("/revoke"));
  check(one && one.u === ANCHOR + "/auth/cluster/users/usr_1/sessions/sid_1/revoke",
    "and ending one of them names whose it is", one && one.u);
} else {
  let refused = null;
  try { await api.users("hotrod").list(); } catch (e) { refused = e; }
  check(refused && refused.status === 503, "with no provider known, an account call is refused",
    refused ? String(refused.status) : "(no error)");
  check(at(NODE, since(mark)).length === 0 && at(ANCHOR, since(mark)).length === 0,
    "and nobody is asked", String(since(mark).map((c) => c.u)));
}

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

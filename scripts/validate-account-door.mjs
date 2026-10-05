// Where an account call goes — the one question apiClient answers in one place, measured — and where
// administering one is opened.
//
// A cluster's accounts are read at its sign-in provider and administered on the provider's own pages:
// a member holds only a read-only replica. A panel that knows of no provider — a host run with auth
// switched off — has nowhere to send a call, and refuses it rather than guessing a member. The live
// smoke runs against an AUTH-DISABLED backend, which reports no provider and exercises no account
// surface at all, so this is the only place the first half is covered.
//
// Every fetch is recorded with its ORIGIN, so "nothing was asked of the member" is a measured zero
// rather than an assertion about an absence.
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

  check(since(mark).every((c) => c.credentials === null),
    "and nothing is credentialed — the provider admits client origins without them");

  // Administering is the provider's own pages, opened at the page and scope a surface means.
  const scope = "instance:hotrod/factorio#n1";
  const page = sessionStore.adminPage("assignments", { scope, label: "Factorio" });
  check(page === ANCHOR + "/admin/#/assignments?scope=instance%3Ahotrod%2Ffactorio%23n1&label=Factorio",
    "a server's access opens the provider's assignments at that install's scope", page);
  check(new URLSearchParams(page.split("?")[1]).get("scope") === scope, "and the scope reads back whole");
} else {
  check(sessionStore.adminPage("accounts") === "", "with no provider known, there is no admin page to open");
  let refused = null;
  try { await api.users("hotrod").list(); } catch (e) { refused = e; }
  check(refused && refused.status === 503, "with no provider known, an account call is refused",
    refused ? String(refused.status) : "(no error)");
  check(at(NODE, since(mark)).length === 0 && at(ANCHOR, since(mark)).length === 0,
    "and nobody is asked", String(since(mark).map((c) => c.u)));
}

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

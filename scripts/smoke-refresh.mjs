// Session auto-renewal smoke. The bug this guards: the LIVE refresh path used to
// re-confirm /me WITHOUT rotating the token, so ~15 min after login the access
// token died at the backend and the user was bounced to re-auth (despite holding
// a valid refresh token). The fix: refresh() POSTs /auth/session/refresh with the
// REFRESH token as the bearer → a fresh access token; the refresh token lives in
// localStorage so a returning visitor (browser closed for days/weeks) silently
// rotates back in. This covers: (1) login persists the refresh token to
// localStorage, (2) refresh() actually rotates the access token, (3) the
// returning-visitor cold path (token only in localStorage) rotates silently,
// (4) concurrent callers share ONE rotation, (5) a dead refresh token → expired
// + the dead credential is dropped.
import { createServer } from "vite";
import { JSDOM } from "jsdom";

process.on("unhandledRejection", () => {});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost:5173/", pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "navigator", "location", "history"]) { try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {} }

// Three LIVE hosts (real ids, as the registry persists them after login). No
// session in sessionStorage (a returning visitor — the access session is gone on
// browser close), and — at load — NO refresh tokens yet (set per-phase below, so
// the harmless cold-boot fan-out can't consume them first).
w.localStorage.setItem("krystal:hosts:registry", JSON.stringify([
  { id: "hgood",   url: "http://good.test",   name: "Good" },
  { id: "hreturn", url: "http://return.test", name: "Return" },
  { id: "hdead",   url: "http://dead.test",   name: "Dead" },
]));
w.localStorage.setItem("krystal:auth", JSON.stringify({ name: "n", provider: "discord", stay: true, id: "discord:7" }));

const REFRESH_LS = (id) => "krystal:hostrefresh:" + id;

let fail = 0;
const assert = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) fail++; };

// Stub fetch. The refresh endpoint mints a fresh access token ONLY for the right
// per-host refresh token (mirrors the backend rejecting a bad/expired refresh);
// everything else needs a rotated access token (an auth-enabled host).
const P = (b, s = 200) => Promise.resolve({ ok: s >= 200 && s < 300, status: s, json: async () => b });
const seen = [];
function stubFetch(url, opts) {
  const u = String(url);
  const auth = (opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || null;
  const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  seen.push({ u, bearer, method: (opts && opts.method) || "GET" });
  if (u.endsWith("/api/v1")) return P({ name: "kgsm-api", version: "v1" });               // public handshake
  if (u.includes("/auth/session/refresh")) {
    // The endpoint is ROOT-routed on the backend — NOT under /api/v1. If the
    // client builds the wrong base (/api/v1/auth/session/refresh) the rotation
    // must FAIL, or the bug hides. (This guards a real regression we hit once.)
    if (u.includes("/api/v1/auth/session/refresh")) return P({ error: { code: "wrong_route", message: "refresh is root-routed, not /api/v1" } }, 401);
    // tier rides the response (from the refresh token's claims) so a cold-boot
    // rotation doesn't need a /me round-trip to know the role.
    if (u.includes("//good.test")   && bearer === "GOODTOK") return P({ token: "NEWACCESS",  tier: "admin" });
    if (u.includes("//return.test") && bearer === "RETTOK")  return P({ token: "NEWACCESS2", tier: "operator" });
    return P({ error: { code: "unauthorized", message: "bad refresh" } }, 401);            // dead.test / wrong token
  }
  const okAccess = bearer === "NEWACCESS" || bearer === "NEWACCESS2";
  if (!okAccess) return P({ error: { code: "unauthorized" } }, 401);
  if (u.includes("/me")) return P({ user: { id: "discord:7", username: "n", display: "N" }, tier: "admin" });
  return P([], 200);
}
globalThis.fetch = w.fetch = stubFetch;
globalThis.WebSocket = w.WebSocket = class { constructor() {} addEventListener() {} send() {} close() {} get readyState() { return 0; } };

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
await vite.ssrLoadModule("/src/lib/config.js");
await vite.ssrLoadModule("/src/lib/apiClient.js");
const { sessionStore } = await vite.ssrLoadModule("/src/lib/sessionStore.js");

const postsTo = (host, tok) => seen.filter(r => r.method === "POST" && r.u.includes("//" + host) && r.u.includes("/auth/session/refresh") && r.bearer === tok);

// --- (1) login persists the refresh token to localStorage -----------------
sessionStore.adoptSession("hgood", { token: "ACCESS0", refresh: "GOODTOK", tier: "admin" });
assert(w.localStorage.getItem(REFRESH_LS("hgood")) === "GOODTOK", "login: the refresh token is persisted to localStorage (survives a browser close)");
assert(sessionStore.tokenOf("hgood") === "ACCESS0" && sessionStore.tierOf("hgood") === "admin", "login: the access token + tier are live in the session");

// --- (2) refresh() ROTATES the access token (the actual bug) ---------------
sessionStore.expire("hgood");                                   // the access token lapses
assert(sessionStore.statusOf("hgood") === "expired", "expiry: a lapsed access token reads as expired");
const r1 = await sessionStore.refresh("hgood");
assert(r1 === "live", "refresh: a valid refresh token renews the session → live (no re-auth)");
assert(sessionStore.tokenOf("hgood") === "NEWACCESS", "refresh: the access token was ROTATED (NEWACCESS), not just re-confirmed");
assert(sessionStore.tierOf("hgood") === "admin", "refresh: the role (tier) survives a rotation — no privilege loss on auto-renew");
assert(postsTo("good.test", "GOODTOK").length >= 1, "refresh: POST /auth/session/refresh carried the REFRESH token as the bearer");

// --- (3) returning visitor: token ONLY in localStorage, no in-memory session
w.localStorage.setItem(REFRESH_LS("hreturn"), "RETTOK");        // as a browser-restart would leave it
assert(sessionStore.statusOf("hreturn") === "none", "return: no in-memory session for a cold-booted host");
const r2 = await sessionStore.ensure("hreturn");               // the api gate calls ensure() on first use
assert(r2 === "live", "return: ensure() silently rotates the localStorage refresh token → live (no Discord bounce)");
assert(sessionStore.tokenOf("hreturn") === "NEWACCESS2", "return: a fresh access token was minted from the stored refresh token");
// The discriminating check: a returning visitor has NO in-memory tier (browser was
// closed) — the role MUST come from the refresh response, or an admin loses every
// gated control on return (the whole point of "come back days later and have access").
assert(sessionStore.tierOf("hreturn") === "operator", "return: the role (tier) is resolved on the cold path → gated controls survive a return");

// --- (4) concurrent callers share ONE rotation (boot fan-out hits 4×) ------
const a = sessionStore.refresh("hgood");
const b = sessionStore.refresh("hgood");
assert(a === b, "dedupe: concurrent refresh() calls share a single in-flight rotation");
await Promise.all([a, b]);

// --- (5) a dead refresh token → expired + the dead credential is dropped ---
w.localStorage.setItem(REFRESH_LS("hdead"), "DEADTOK");
const r3 = await sessionStore.ensure("hdead");
assert(r3 === "expired", "dead: a refresh token past its cap (backend 401) → expired (the UI offers re-auth)");
assert(w.localStorage.getItem(REFRESH_LS("hdead")) === null, "dead: the dead refresh token is dropped, not retried forever");

// --- sign-out drops every persisted credential ----------------------------
sessionStore.signOut();
assert(w.localStorage.getItem(REFRESH_LS("hgood")) === null && w.localStorage.getItem(REFRESH_LS("hreturn")) === null, "signOut: all long-lived refresh tokens are cleared");
assert(JSON.parse(w.localStorage.getItem("krystal:hosts:registry") || "[]").length === 3, "signOut: the host registry is KEPT (land on login, not the add-host screen)");

try { await vite.close(); } catch (e) { /* benign teardown race */ }
console.log(fail ? `\n✗ ${fail} refresh check(s) failed` : `\n✓ session auto-renewal verified (rotation + returning-visitor + dedupe + dead-token)`);
process.exit(fail ? 1 : 0);

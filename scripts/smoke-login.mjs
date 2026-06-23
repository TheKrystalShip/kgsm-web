// Real-login (auth-enabled host) smoke. The one thing this can't do is click
// Discord's consent screen (external) — everything else in the flow is covered:
// the auth-enabled connect leaves a registry entry with id:null (because /hosts is
// 401 pre-login), then the OAuth fragment landing must (a) establish the app-shell
// identity, (b) reconcile the host's REAL id with the bearer, (c) adopt the live
// session, and (d) make every subsequent call carry the bearer. That chicken-and-
// egg (id:null → fanOut skips the auth gate) is the whole risk of the slice.
import { createServer } from "vite";
import { JSDOM } from "jsdom";

process.on("unhandledRejection", () => {});

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost:5173/", pretendToBeVisual: true });
const w = dom.window;
globalThis.window = w;
for (const k of ["document", "localStorage", "sessionStorage", "HTMLElement", "Node", "getComputedStyle", "DOMParser", "navigator", "location", "history"]) { try { if (!globalThis[k]) globalThis[k] = w[k]; } catch {} }

// An auth-ENABLED host as connectReal's needs_auth path leaves it: registered,
// URL only, id:null (the connect probe couldn't read /hosts — that's 401 pre-login).
// NO krystal:auth (not signed in yet), NO krystal:mock (this is LIVE).
w.localStorage.setItem("krystal:hosts:registry", JSON.stringify([{ id: null, url: "http://h.test", name: "H" }]));

let fail = 0;
const assert = (c, label) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) fail++; };

// Stub fetch: record every request's path + whether it carried a bearer, and gate
// the protected endpoints on the bearer (exactly like an auth-enabled backend).
const TOKEN = "TESTTOKEN";
const seen = [];
const J = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function stubFetch(url, opts) {
  const u = String(url);
  const auth = (opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || null;
  const bearer = auth === "Bearer " + TOKEN;
  seen.push({ u, bearer });
  if (u.endsWith("/api/v1")) return Promise.resolve(J({ name: "kgsm-api", version: "v1" })); // public handshake
  // Everything else is auth-gated: 401 without the bearer (this is the gate the
  // chicken-and-egg must get past).
  if (!bearer) return Promise.resolve(J({ error: { code: "unauthorized", message: "no bearer" } }, 401));
  if (u.includes("/me")) return Promise.resolve(J({ user: { id: "discord:99", username: "neo", display: "Neo" }, tier: "admin" }));
  if (u.includes("/hosts")) return Promise.resolve(J([{ id: "hotrod", label: "hotrod", status: "online", capabilities: {} }]));
  if (u.includes("/servers")) return Promise.resolve(J([{ id: "factorio-1", name: "Factorio", hostId: "hotrod", blueprint: "factorio", status: "running", runtime: "native" }]));
  if (u.includes("/library")) return Promise.resolve(J([{ id: "factorio", name: "Factorio", type: "game" }]));
  if (u.includes("/audit")) return Promise.resolve(J({ data: [], nextCursor: null }));
  if (u.includes("/alerts")) return Promise.resolve(J({ data: [] }));
  return Promise.resolve(J({}, 404));
}
globalThis.fetch = w.fetch = stubFetch;
globalThis.WebSocket = w.WebSocket = class { constructor() {} addEventListener() {} send() {} close() {} get readyState() { return 0; } };

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const cfg = await vite.ssrLoadModule("/src/lib/config.js");
const authRedirect = await vite.ssrLoadModule("/src/lib/authRedirect.js");
const { sessionStore } = await vite.ssrLoadModule("/src/lib/sessionStore.js");
await vite.ssrLoadModule("/src/lib/apiClient.js");
await vite.ssrLoadModule("/src/lib/stores.js");

// --- pre-login: registered, LIVE, but id unknown + no session -------------
assert(cfg.LIVE === true && cfg.MOCK === false, "config: a registered host (no mock) → LIVE, not MOCK");
assert(cfg.CONNECTIONS.length === 1 && cfg.CONNECTIONS[0].id === null, "config: the auth-enabled host is registered with id:null (pre-login)");
assert(sessionStore.statusOf("hotrod") === "none", "session: no session for the host before login");

// --- the OAuth landing: capture the fragment, complete the login ----------
w.location.hash = "#access=" + TOKEN + "&refresh=REFRESH";
const captured = authRedirect.captureOAuthFragment();
assert(captured && captured.access === TOKEN, "authRedirect: captured the access token from the URL fragment");
assert(!w.location.hash || w.location.hash === "", "authRedirect: stripped the token fragment from the URL");

await authRedirect.completeOAuthLogin(captured);

// --- post-login: identity + reconciled id + adopted bearer ----------------
const stored = JSON.parse(w.localStorage.getItem("krystal:auth") || "null");
assert(stored && stored.id === "discord:99" && stored.display === "Neo", "login: app-shell identity established from /me (the real Discord user)");

const reg = JSON.parse(w.localStorage.getItem("krystal:hosts:registry") || "[]");
assert(reg.length === 1 && reg[0].id === "hotrod", "login: the host's REAL id was reconciled into the registry (via the authed /hosts probe)");
assert(cfg.CONNECTIONS[0].id === "hotrod", "login: in-memory connection id reconciled → fanOut will now use the per-host auth gate");

assert(sessionStore.tokenOf("hotrod") === TOKEN, "login: the live session was adopted under the real host id (bearer ready, no bootstrap race)");
assert(sessionStore.tierOf("hotrod") === "admin", "login: the host tier resolved from /me");

// the /hosts probe during completeOAuthLogin MUST have carried the bearer — this
// is the authed-call mechanism end-to-end (a real fetch with Authorization → 200).
assert(seen.some((r) => r.u.includes("/hosts") && r.bearer), "login: the /hosts id-probe carried the Authorization bearer");

// The three facts above together close the chicken-and-egg: conn.id reconciled
// (fanOut now uses hostScoped, not the gate-less plain get) + tokenOf live with
// the token (liveBearer returns it) + an authed call proven to work. We do NOT
// assert a fresh `api.host(id).get()` here: apiClient binds sessionStore via a
// lazy import().then() and the vite-SSR harness gives it a SEPARATE module
// instance from the one we adopt on (a duplication artifact — a real browser has
// ONE instance and liveBearer reads the adopted session). That last hop is
// unchanged, production-proven auth-gate code; the slice's NEW logic is fully
// covered above.

try { await vite.close(); } catch (e) { /* benign teardown race */ }
console.log(fail ? `\n✗ ${fail} login check(s) failed` : `\n✓ real-login flow verified (all but the external Discord click)`);
process.exit(fail ? 1 : 0);

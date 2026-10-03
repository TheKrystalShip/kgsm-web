import { createClient, discoverProvider, renew } from "../lib/oidc.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";

// session.js — the standalone assistant's session: a client of the cluster's sign-in provider.
//
// The assistant that served this page names its provider at its own origin, and this surface signs in
// there as that origin, lands back at `/` with its code, and renews through the refresh grant. It is
// the same session every other surface of the cluster holds, which is why opening the assistant after
// the panel returns signed in with nothing typed: the provider recognises the browser.
//
// It speaks the credential shape `lib/assistantSession.js` relays — `statusOf`, `tokenOf`, `isLive`,
// `rotate`, `authorize` and `subscribe` — so the chat below it cannot tell which surface it is on. A
// session proves who; what that person may do is the assistant's `/me/access`.
//
// Status:
//   none         nothing asked yet
//   live         a bearer is held
//   expired      the session could not be renewed; `error` says whether it ended or went unanswered
//   unavailable  the assistant names no provider, so there is nowhere to sign in

const store = createStore({ status: "none", token: null, error: null });
const set = (patch) => store.setState((s) => ({ ...s, ...patch }));

let client = null;
let held = false;
let inflight = null;

function adopt(user) {
  held = !!user.refresh_token;
  set({ status: "live", token: user.access_token, error: null });
}

// Where the provider is, asked of the assistant that served this page.
async function configure() {
  const found = await discoverProvider(window.location.origin);
  if (!found.ok) { set({ status: "unavailable", error: found.reason }); return false; }
  client = createClient({ issuer: found.issuer, redirectPath: "/", postLogoutPath: "/", prefix: "krystal:assistant:oidc:" });
  return true;
}

function rotate() {
  if (inflight) return inflight;
  if (!client || !held) { set({ status: "expired", token: null, error: "login_required" }); return Promise.resolve("expired"); }
  const p = renew(client).then((res) => {
    if (res.ok) { adopt(res.user); return "live"; }
    if (res.ended) { held = false; set({ status: "expired", token: null, error: "login_required" }); return "expired"; }
    set({ status: "expired", error: "unreachable" });
    return "expired";
  });
  inflight = p;
  const done = () => { if (inflight === p) inflight = null; };
  p.then(done, done);
  return p;
}

function authorize() {
  if (store.getState().status === "live") return Promise.resolve("live");
  return rotate();
}

// To the provider, carrying the route this page was on. The page is leaving once this resolves.
async function signIn() {
  if (!client) return false;
  await client.signinRedirect({ state: { back: window.location.hash || "" } });
  return true;
}

// The provider ends its own session and every session minted under it, on every member, and sends
// the browser back here.
async function signOut() {
  const user = client ? await client.getUser().catch(() => null) : null;
  held = false;
  set({ status: "expired", token: null, error: "signed_out" });
  if (!client || !user || !user.id_token) return false;
  try { await client.signoutRedirect({ id_token_hint: user.id_token }); return true; }
  catch { await client.removeUser().catch(() => {}); return false; }
}

// Settle the session before anything mounts. A landing exchanges its code; a stored session is
// restored, and renewed if it has lapsed; a browser holding nothing leaves for the provider at once,
// because nothing is on screen to lose.
async function start() {
  if (!(await configure())) return;

  const query = new URLSearchParams(window.location.search);
  if (query.has("code") || query.has("error")) {
    let back = "";
    try {
      const user = await client.signinRedirectCallback();
      adopt(user);
      back = (user.state && user.state.back) || "";
    } catch (err) {
      set({ status: "expired", token: null, error: (err && err.error) || "sign_in_failed" });
    }
    try { window.history.replaceState(null, "", "/" + (back.startsWith("#") ? back : "")); } catch { /* the route reads what is there */ }
    return;
  }

  const user = await client.getUser().catch(() => null);
  if (user && !user.expired) { adopt(user); return; }
  held = !!(user && user.refresh_token);
  if (held && (await rotate()) === "live") return;
  if (store.getState().error === "unreachable") return;
  try { await signIn(); } catch { set({ status: "expired", error: "unreachable" }); }
}

const statusOf = () => store.getState().status;
const tokenOf = () => (statusOf() === "live" ? store.getState().token : null);
const isLive = () => statusOf() === "live";

const soloSession = Object.assign(store, { authorize, isLive, rotate, signIn, signOut, start, statusOf, tokenOf });

export { soloSession };

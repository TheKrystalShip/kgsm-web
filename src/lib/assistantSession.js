import { createStore } from "./store.js";

// assistantSession.js — which credential an assistant is spoken to with, and where it is.
//
// An assistant signs nobody in. A leaf verifies the cluster's session against the host file the node
// on its machine writes, and an anchor through the member holding the cluster's accounts, so in either
// standing the session a browser presents to it is the one it already holds for the cluster. There is
// no session with an assistant: there is the surface's own, handed in, and an address to send it to.
//
// Both halves are installed by the surface, because each differs in kind between the two surfaces
// rather than in detail. The Control Panel discovers where an assistant is, across a cluster it may
// add nodes to at runtime, and holds the cluster session in its own store; the standalone assistant
// was served by the one it talks to and holds a session of its own. Resolving either here would mean
// importing the panel's stores into a surface that has none.
//
// Nothing installed ⇒ no route and no credential, which is the honest answer for a surface that has
// not said.

let resolveTarget = () => null;
function setTargetResolver(fn) { resolveTarget = typeof fn === "function" ? fn : () => null; }

// The credential: `statusOf`, `tokenOf`, `tierOf`, `isLive`, `rotate` (resolving to a status) and
// `authorize`, with `subscribe` so a surface re-renders when it changes. The panel's sessionStore and
// the standalone assistant's own session both speak it.
let credential = null;
let unsubscribe = null;

// The status, mirrored so a component can subscribe to this store rather than to whichever
// credential the surface happened to install.
const store = createStore({ status: "none" });
function sync() {
  const status = credential ? credential.statusOf() : "none";
  if (store.getState().status !== status) store.setState({ status });
}
function setCredential(c) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  credential = c || null;
  if (credential && typeof credential.subscribe === "function") unsubscribe = credential.subscribe(sync);
  sync();
}

// The assistant's public origin for an id. Null is an honest "no route" — never guessed from the
// panel's own origin, which would send a turn to whatever happened to serve the bundle.
function originOf(id) {
  if (!id) return null;
  const t = resolveTarget(id);
  const url = t && (typeof t === "string" ? t : t.origin);
  return typeof url === "string" && url.trim() ? url.trim().replace(/\/+$/, "") : null;
}
const hasRoute = (id) => !!originOf(id);

const routed = (id) => !!(credential && hasRoute(id));
const statusOf = (id) => (routed(id) ? credential.statusOf() : "none");
const tokenOf = (id) => (routed(id) ? credential.tokenOf() : null);
const tierOf = (id) => (routed(id) ? credential.tierOf() : null);
const isLive = (id) => statusOf(id) === "live";

// Renew, and hand back whatever the renewal produced, so a caller retrying a refused call retries
// with the token that renewal actually yielded.
async function rotate(id) {
  if (!routed(id)) return null;
  await credential.rotate();
  return credential.tokenOf();
}

// Ensure a live session, without asking anybody for anything. Resolves to whether one is held.
async function ensureSession(id) {
  if (!routed(id)) return false;
  await credential.authorize();
  return credential.isLive();
}

const assistantSession = Object.assign(store, {
  setCredential, setTargetResolver,
  ensureSession, hasRoute, isLive, originOf, rotate, statusOf, tierOf, tokenOf,
});

export { assistantSession };

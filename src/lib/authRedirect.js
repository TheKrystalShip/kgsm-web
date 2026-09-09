// authRedirect.js — the SPA side of the OAuth fragment handoff.
//
// The anchor's /auth/{provider}/callback 302s the browser back here with the session in the URL
// FRAGMENT (#access=…&refresh=… on success, #error=… on failure) — never the query, so the tokens
// never reach an access log or a Referer header. It is captured at boot BEFORE the hash router reads
// location.hash: parse, stash, strip the fragment, and establish the session so the app mounts
// signed in with no flash. A normal load (a #/route, or no hash) is a no-op.
//
// There is no question of WHICH member minted these. The anchor did, and every member accepts them
// by verifying its signature — so the return leg adopts the session first and only then asks a
// member anything, rather than resolving a node in order to know what the tokens are worth.

import { authorized } from "./authorizedFetch.js";
import { homeConn, reconcileConnectionId } from "./config.js";
// The fragment parser is its own module (both surfaces boot with it, and the standalone assistant
// must not import the node connection model). Re-exported so the panel keeps one import site.
import { captureOAuthFragment, ERROR_KEY, PENDING_KEY } from "./oauthFragment.js";
export { captureOAuthFragment };

const AUTH_LS_KEY = "krystal:auth";

// Hand the stashed tokens to the session layer. One-shot.
export function takePendingTokens() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

// One-shot read of a captured sign-in error (the sign-in page surfaces it).
export function takeOAuthError() {
  try { const e = sessionStorage.getItem(ERROR_KEY); if (e) sessionStorage.removeItem(ERROR_KEY); return e; }
  catch { return null; }
}

// Does this member run an assistant the browser should be signed into, and can it be done without
// asking for anything? Read from the `/hosts` row just fetched rather than from hostsStore, which is
// still empty this early.
//
// Every condition is a reason NOT to bounce, and each is real: no assistant, or one the member
// reports no public address for, means nowhere to go; a leaf that is not answering means the round
// trip would fail; a session already held means nothing to buy; and a tab that has already tried
// never tries twice, whatever the reason it did not take.
async function assistantToChain(hostRow, hostId) {
  if (!hostRow || !hostId) return null;
  const cap = hostRow.capabilities && hostRow.capabilities.assistant;
  if (!cap || cap.provisioned === false) return null;
  if (cap.status !== "operational" && cap.status !== "degraded") return null;
  const url = cap.info && typeof cap.info.url === "string" ? cap.info.url.trim() : "";
  if (!url) return null;
  try {
    const { assistantSession } = await import("./assistantSession.js");
    const status = assistantSession.statusOf(hostId);
    if (status !== "none") return null;                 // live, bootstrapping or denied — not ours to fix
    if (assistantSession.attempted(hostId)) return null;
  } catch { return null; }
  return { hostId, origin: url.replace(/\/+$/, "") };
}

// On a fresh OAuth landing, establish the session BEFORE the app mounts, so it boots signed in with
// no sign-in flash and no reload.
export async function completeOAuthLogin(captured) {
  if (!captured || !captured.access) return;
  if (captured.issuer === "assistant") return;   // a leaf's token; a member can only refuse it
  return establishClusterSession(captured);
}

// Turn a freshly-minted token pair into the live cluster session, and hydrate.
//
// A password sign-in ends in exactly the same place as a provider's return leg — the tokens arrive,
// and everything after that is about the tokens rather than the door they came through. A second
// copy of this would be a second place for a sign-in to half-succeed.
//
// The order matters. The session is adopted FIRST, because it is valid on the strength of its
// signature and nothing a member says can make it more so. What follows is enrichment: who this is,
// which member the panel is talking to, and the data behind the first paint — and a member being
// slow or unreachable leaves somebody signed in with an empty panel, never half signed in.
export async function establishClusterSession(captured) {
  const { clusterCredential, sessionStore } = await import("./sessionStore.js");
  sessionStore.adoptSession({
    token: captured.access,
    refresh: captured.refresh || null,
    tier: captured.tier || "none",
    account: captured.status || "unknown",
  });
  takePendingTokens();                                  // consume the one-shot stash; adopted directly

  // In a cluster the fleet is the anchor's to name, and it is asked the moment there is a session to
  // ask with — a person who has just signed in should not wait a discovery interval to see their
  // servers. It runs before the reads below because those address a node, and until this returns
  // there may be no node to address.
  try { const { refreshFleetFromAnchor } = await import("./fleet.js"); await refreshFleetFromAnchor(); }
  catch { /* the discovery timer asks again */ }

  const conn = homeConn();
  if (!conn) return;
  const apiV1 = conn.url + "/api/v1";
  // Authorized by the session just adopted rather than by the token that arrived in the fragment.
  // They are the same string this instant and stop being one the moment anything renews, and a
  // hydrate is not worth a second rule about which of the two to spend.
  try {
    const res = await authorized(clusterCredential).json(apiV1 + "/me", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("me " + res.status);
    const me = res.body;
    const u = (me && me.user) || {};
    // The provider is read off the id the backend returned (`provider:subject`), never assumed: a
    // password sign-in and a provider one both land here, and stamping "discord" on a local account
    // would put the wrong mark beside their name everywhere it is shown.
    const provider = String(u.id || "").includes(":") ? String(u.id).split(":")[0] : "local";
    localStorage.setItem(AUTH_LS_KEY, JSON.stringify({
      name: u.display || u.username || "KGSM user",
      display: u.display || u.username || null,
      provider, id: u.id || null, stay: true,
    }));
    // The tier the anchor minted is what the session carries; this member's own answer confirms it
    // from its replica and is what a first paint gates on.
    sessionStore.applyMePatch({ tier: (me && me.tier) || captured.tier || "none", status: (me && me.status) || "unknown" });
  } catch { /* signed in with the identity unresolved; the next call fills it in */ }

  // Resolve this member's real backend id so routing is exact from the next call, register it so a
  // reload re-derives the connection with that id, and hydrate the surfaces the first paint needs.
  let hostRow = null, hostId = null, hostName = null;
  try {
    const hr = await authorized(clusterCredential).json(apiV1 + "/hosts", {
      headers: { Accept: "application/json" },
    });
    if (hr.ok) {
      const arr = hr.body;
      const h = Array.isArray(arr) ? arr[0] : (arr && arr.data && arr.data[0]);
      hostRow = h || null;
      hostId = (h && h.id) || null;
      hostName = (h && (h.label || h.name)) || null;
    }
  } catch { /* the roster arrives on the next read */ }

  if (hostId) {
    reconcileConnectionId(conn.url, hostId);
    try { sessionStore.register({ id: hostId, url: conn.url, name: hostName }); } catch { /* private mode */ }
  }

  try {
    const stores = await import("./stores.js");
    ["serversStore", "hostsStore", "libraryStore", "auditStore"].forEach((n) => {
      try { if (stores[n] && stores[n].refresh) stores[n].refresh().catch(() => {}); } catch { /* one store must not stop the rest */ }
    });
  } catch { /* the shell refreshes on mount */ }

  const chainAssistant = await assistantToChain(hostRow, hostId);
  if (chainAssistant) return { chainAssistant };
}

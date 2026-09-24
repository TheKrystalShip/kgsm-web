// clusterSignIn.js — what the panel does once it holds a session.
//
// The session is valid on the strength of its signature and nothing a member says makes it more so,
// so it is held first and everything here is enrichment: who is in the cluster, who this person is,
// which member the panel is talking to, and the data behind the first paint. A member being slow or
// unreachable leaves somebody signed in with an empty panel, never half signed in.

import { authorized } from "./authorizedFetch.js";
import { homeConn, reconcileConnectionId } from "./config.js";
import { writeStoredUser } from "./authStorage.js";
import { clusterCredential, sessionStore } from "./sessionStore.js";

async function establishClusterSession() {
  // The fleet is the provider's to name, and it is asked the moment there is a session to ask with —
  // a person who has just signed in should not wait a discovery interval to see their servers. It
  // runs before the reads below because those address a node, and until this returns there may be
  // no node to address.
  try { const { refreshFleetFromAnchor } = await import("./fleet.js"); await refreshFleetFromAnchor(); }
  catch { /* the discovery timer asks again */ }

  const conn = homeConn();
  if (!conn) return;
  const apiV1 = conn.url + "/api/v1";
  try {
    const res = await authorized(clusterCredential).json(apiV1 + "/me", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("me " + res.status);
    const me = res.body;
    const u = (me && me.user) || {};
    // The provider is read off the id the member returned (`provider:subject`), never assumed: a
    // password sign-in and a provider one both land here, and stamping one on the other would put
    // the wrong mark beside somebody's name everywhere it is shown.
    const provider = String(u.id || "").includes(":") ? String(u.id).split(":")[0] : "local";
    writeStoredUser({
      name: u.display || u.username || "KGSM user",
      display: u.display || u.username || null,
      provider, id: u.id || null, stay: true,
    });
    // The tier the provider minted is what the session carries; this member's own answer confirms it
    // from its replica and is what a first paint gates on.
    sessionStore.applyMePatch({ tier: (me && me.tier) || sessionStore.tierOf() || "none", status: (me && me.status) || "unknown" });
  } catch { /* signed in with the identity unresolved; the next call fills it in */ }

  // Resolve this member's real backend id so routing is exact from the next call, and hydrate the
  // surfaces the first paint needs.
  try {
    const hr = await authorized(clusterCredential).json(apiV1 + "/hosts", { headers: { Accept: "application/json" } });
    if (hr.ok) {
      const arr = hr.body;
      const h = Array.isArray(arr) ? arr[0] : (arr && arr.data && arr.data[0]);
      if (h && h.id) {
        reconcileConnectionId(conn.url, h.id);
        try { sessionStore.register({ id: h.id, url: conn.url, name: h.label || h.name || null }); } catch { /* private mode */ }
      }
    }
  } catch { /* the roster arrives on the next read */ }

  try {
    const stores = await import("./stores.js");
    ["serversStore", "hostsStore", "libraryStore", "auditStore"].forEach((n) => {
      try { if (stores[n] && stores[n].refresh) stores[n].refresh().catch(() => {}); } catch { /* one store must not stop the rest */ }
    });
  } catch { /* the shell refreshes on mount */ }
}

export { establishClusterSession };

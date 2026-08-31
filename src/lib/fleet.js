import { clusterMembers } from "./anchor.js";
import { reconcileRosterToRegistry } from "./connect.js";
import { sessionStore } from "./sessionStore.js";

// fleet.js — which nodes this panel drives, and where that answer comes from.
//
// In a cluster it comes from the ANCHOR and from nowhere else. A clustered node announces nothing
// about its cluster — not the anchor's address, not its own membership — so there is no second
// source to reconcile against and none to disagree with. The anchor is asked with the session it
// just minted, because who is in a cluster is not something an unauthenticated caller learns.
//
// A standalone deployment has no anchor and no cluster: the node somebody signed in at is the whole
// of it, registered when they chose it, and this never runs.
//
// Every address the anchor returns is fetchable from a browser — it omits a member that advertises
// none rather than falling back to the address its peers use. The addressability guard in
// reconcileRosterToRegistry stays a backstop rather than the thing standing between a person and a
// node that reads as permanently down.
async function refreshFleetFromAnchor() {
  const url = sessionStore.anchorOrigin();
  if (!url) return { ok: false, reason: "no_anchor", added: 0, removed: 0 };
  if (!sessionStore.isLive()) return { ok: false, reason: "no_session", added: 0, removed: 0 };

  const roster = await clusterMembers(url, sessionStore.tokenOf());
  // An anchor that could not be asked is not an empty cluster. Reconciling against nothing would
  // drop every node the panel is driving and leave somebody looking at a fleet that appears to have
  // gone, which is worse than a roster that is briefly stale.
  if (!roster.ok) return { ok: false, reason: "unreachable", added: 0, removed: 0 };

  // Only NODES are driven. An anchor serves no servers and no metrics, so a connection to one would
  // be called by every fan-out and named in every banner forever; other anchors are the cluster's
  // business and appear on the Cluster page rather than in the connection set.
  const nodes = roster.members
    .filter((m) => m.kind === "node")
    .map((m) => ({
      nodeId: m.memberId,
      kind: "node",
      label: m.nickname || m.memberId,
      clientUrl: m.url,
      enabled: true,
      membership: m.membership,
      status: m.status,
    }));

  const result = reconcileRosterToRegistry(nodes, {});
  return { ok: true, cluster: roster.cluster, count: nodes.length, ...result };
}

export { refreshFleetFromAnchor };

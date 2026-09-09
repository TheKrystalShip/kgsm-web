import { adaptLocation } from "./adapters.js";
import { clusterMembers } from "./anchor.js";
import { reconcileRosterToRegistry } from "./connect.js";
import { sessionStore } from "./sessionStore.js";
import { createStore } from "./store.js";

// Whether the cluster has told us who is in it yet. The shell needs this to tell "you have no
// hosts" apart from "nobody has been asked" — a fresh load concluding the first when it means the
// second is a confident wrong answer, and it puts an add-a-host screen in front of somebody whose
// cluster is fine.
//
//   idle         no anchor: a standalone deployment, and nothing here ever runs
//   asking       a session exists and the anchor has not answered yet
//   ready        the anchor answered; `count` is how many nodes it named
//   unreachable  the anchor could not be asked. NOT an empty cluster
//
// `members` is the anchor's answer kept rather than consumed: it is the authority for what the
// cluster contains, and every member is in it except the anchor itself.
const fleetStore = createStore({ state: "idle", count: 0, members: [] });

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
  if (!url) { fleetStore.setState({ state: "idle" }); return { ok: false, reason: "no_anchor", added: 0, removed: 0 }; }

  if (fleetStore.getState().state === "idle") fleetStore.setState({ state: "asking" });

  // The access token lives in sessionStorage, which is per browsing context: a reload keeps it, a
  // new tab and every launch of the installed app do not. So the panel opens either holding a
  // refresh token and no session, or holding one a reload restored — and this call is what spends
  // the first and is the only thing that can find out about the second.
  //
  // It has to be this one. A clustered panel keeps no node list between loads, so until the anchor
  // answers there is no node to call and nothing else in the app makes a request. Waiting for
  // somebody else's call to authorize would be waiting for a call nobody makes.
  //
  // EXPIRY-AWARE, like the two calls that cannot be replayed, and for the mirror-image reason: the
  // reactive path elsewhere heals a lapsed token because something else is refused first, and here
  // nothing else is ever called. A restored session whose bearer has lapsed reads as live, so the
  // reactive rule alone would spend it, be refused, and leave no node to ever be refused again.
  await sessionStore.authorizeFresh();
  if (!sessionStore.isLive()) {
    // Not an empty cluster and not a stale roster: this browser could not ask. The session layer has
    // already recorded why, and a session it could not renew surfaces as the door.
    if (fleetStore.getState().state !== "ready") fleetStore.setState({ state: "unreachable" });
    return { ok: false, reason: "no_session", added: 0, removed: 0 };
  }
  let roster = await clusterMembers(url, sessionStore.tokenOf());

  // A refused roster is renewed once and asked again. The expiry check above covers a bearer that
  // says it has lapsed; this covers the refusals it cannot predict — a session revoked elsewhere, a
  // key the anchor has rotated — and it is the backstop that keeps this call from being the one
  // authenticated call in the panel that a 401 is terminal for. Replay is free: it is a GET, and
  // rotate() collapses concurrent callers onto one spend of the refresh token.
  //
  // Once only. A second refusal after a renewal is the anchor describing the session rather than the
  // bearer, and retrying it again is a loop that ends where the first one did.
  if (!roster.ok && roster.status === 401 && await sessionStore.reauthorize() === "live")
    roster = await clusterMembers(url, sessionStore.tokenOf());

  // An anchor that could not be asked is not an empty cluster. Reconciling against nothing would
  // drop every node the panel is driving and leave somebody looking at a fleet that appears to have
  // gone, which is worse than a roster that is briefly stale.
  if (!roster.ok) {
    // Only the FIRST answer can leave the shell waiting. Once a roster has landed, a later failure
    // must not throw the panel back to a connecting screen over a cluster it is already driving.
    if (fleetStore.getState().state !== "ready") fleetStore.setState({ state: "unreachable" });
    return { ok: false, reason: "unreachable", added: 0, removed: 0 };
  }

  // Normalized to the shape the Cluster page's roster speaks, so what the anchor says about a member
  // can stand in for what a member says about it without a translation at the reading end.
  const members = roster.members.map((m) => ({
    nodeId: m.memberId,
    kind: m.kind,
    label: m.nickname || m.memberId,
    clientUrl: m.url,
    enabled: true,
    membership: m.membership,
    status: m.status,
    location: adaptLocation(m.location),
  }));

  // Only NODES are driven. An anchor serves no servers and no metrics, so a connection to one would
  // be called by every fan-out and named in every banner forever; other anchors are the cluster's
  // business and appear on the Cluster page rather than in the connection set.
  const nodes = members.filter((m) => m.kind === "node");

  const result = reconcileRosterToRegistry(nodes, {});
  fleetStore.setState({ state: "ready", count: nodes.length, members });
  return { ok: true, cluster: roster.cluster, count: nodes.length, ...result };
}

export { fleetStore, refreshFleetFromAnchor };

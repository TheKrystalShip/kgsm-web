// stores/cluster.js — the converged cluster-roster store for the Cluster page.
//
// Two backend surfaces feed the same shape: the admin roster
// (GET /members, full management rows) and the viewer-safe converged
// roster (GET /members/roster). refresh() tries admin first and
// falls back to the viewer roster on a 403 — the store never fabricates a
// value either code path doesn't provide (honest null/"unknown").

import { adaptLocation } from "../adapters.js";
import { api } from "../apiClient.js";
import { CONNECTIONS } from "../config.js";
import { reconcileRosterToRegistry } from "../connect.js";
import { fleetStore, refreshFleetFromAnchor } from "../fleet.js";
import { sessionStore } from "../sessionStore.js";
import { createStore } from "../store.js";
import { hostsStore } from "./hosts.js";

const clusterStore = createStore({
  nodes: [],
  // Which member holds each of the cluster's capabilities. A capability belongs to the
  // cluster rather than to any member, so it is not a field on a roster row — a member
  // is a node or an anchor, and being an anchor does not say WHICH capability it holds.
  capabilities: [],
  status: "idle",
  error: null,
  everLoaded: false,
  admin: false,
  // What one member said, before the anchor's answer was laid over it. Kept so the overlay can be
  // redone when the anchor answers second, which it usually does.
  rosterRows: [],
  // The member these rows were read FROM. A membership write is addressed with `peerId`, which is
  // an id in that member's own peer table and means nothing anywhere else — so the write goes back
  // to whoever answered. A fact about the read, not a choice about the cluster.
  rosterFrom: null,
});

// Admin MemberView row → normalized node. A cluster member is a node or an
// anchor; `kind` carries which, so a surface can tell them apart without
// guessing from whether servers came back.
function fromPeerRow(row) {
  return {
    nodeId: row.memberId,
    kind: row.kind || "node",
    label: row.nickname || row.memberId,
    clientUrl: row.url,
    membership: row.membership || "unknown",
    status: row.status || "unknown",
    latencyMs: row.latencyMs ?? null,
    lastSeen: row.lastSeen || null,
    enabled: row.enabled !== false,
    apiVersion: row.apiVersion || null,
    // Where the member says it is. A member this browser holds no session with has no identity
    // block to read, so the roster is the only carrier a map has for it — an anchor above all.
    location: adaptLocation(row.location),
    peerId: row.id,
    isAdmin: true,
  };
}

// Viewer ClusterMemberView row → normalized node.
function fromClusterNodeRow(row) {
  return {
    nodeId: row.memberId,
    kind: row.kind || "node",
    label: row.label || row.memberId,
    clientUrl: row.clientUrl,
    membership: row.membership || "unknown",
    status: row.status || "unknown",
    latencyMs: row.latencyMs ?? null,
    lastSeen: null,
    enabled: true,
    apiVersion: null,
    location: adaptLocation(row.location),
    peerId: null,
    isAdmin: false,
  };
}

function isForbidden(err) {
  return !!err && (err.code === 403 || err.status === 403);
}

// Read one node's view of the roster: the admin peer list, falling back to the
// viewer-safe converged roster on a 403. Resolves { nodes, admin }.
function fetchRoster(hostId) {
  return api.members(hostId).list()
    .then(rows => ({ nodes: rows.map(fromPeerRow), admin: true }))
    .catch(err => {
      if (!isForbidden(err)) throw err;
      return api.members(hostId).roster().then(rows => ({ nodes: rows.map(fromClusterNodeRow), admin: false }));
    });
}

// One roster read, applied. Every path that obtains a roster lands here, so the node
// set the app drives is updated by the same act that updates what the Cluster page
// shows — an admin removing a peer sees it leave the fan-out on the click, rather
// than at whatever point the discovery timer next happens to fire.
// The assignments are read wherever the roster is, and never gate it: a cluster whose
// capability list could not be read is still a cluster whose members are known, and
// failing the roster over it would lose more than it reports. A failed read keeps what is
// already held — "I could not ask" is not "nobody holds it", and blanking would make the
// page claim the cluster has no auth anchor.
//
// Called from applyRoster rather than from refresh(), because discovery reaches the roster
// without going through refresh: a browser that boots, discovers the cluster and never
// opens the management panel would otherwise hold members and no assignments, and the page
// that most needs to name the holder is the one that would never have it.
function loadCapabilities(hostId) {
  return api.members(hostId).capabilities()
    .then(rows => {
      if (Array.isArray(rows)) clusterStore.setState(st => ({ ...st, capabilities: rows }));
    })
    .catch(() => {});
}

// The roster with the ANCHOR's answer laid over it.
//
// Neither source names every member on its own, and the gap is the same in both: a member is never in
// its own roster, so a node's roster omits that node and the anchor's omits the anchor. Together they
// name everybody exactly once — the anchor covers every node, and a node covers the anchor — which is
// why one card could show a member's membership and the card beside it could not.
//
// Where both hold a row, the ANCHOR wins on what the cluster is: whether a member is still in it, and
// whether it is being reached. The member's own row keeps what only it measures — the round trip it
// last observed — and the peer handle a removal is addressed with, which is a key in that member's
// table and exists nowhere else.
function withAnchorRoster(rows) {
  const fromAnchor = new Map((fleetStore.getState().members || []).map(m => [m.nodeId, m]));
  if (!fromAnchor.size) return rows;

  const merged = rows.map(row => {
    const said = fromAnchor.get(row.nodeId);
    if (!said) return row;
    fromAnchor.delete(row.nodeId);
    return { ...row, membership: said.membership, status: said.status };
  });

  // Whatever the anchor names and this roster does not — the member it was read from, above all.
  // Absent fields are absent, not defaulted: nobody has measured a round trip to it from here, and no
  // member holds a peer row for it, so both are null and the surfaces read them as unknown.
  for (const said of fromAnchor.values()) {
    merged.push({
      nodeId: said.nodeId,
      kind: said.kind,
      label: said.label,
      clientUrl: said.clientUrl,
      membership: said.membership,
      status: said.status,
      latencyMs: null,
      lastSeen: null,
      enabled: true,
      apiVersion: null,
      location: said.location || null,
      peerId: null,
      isAdmin: false,
    });
  }
  return merged;
}

function applyRoster(hostId, { nodes, admin }) {
  clusterStore.setState(s => ({
    ...s, rosterRows: nodes, nodes: withAnchorRoster(nodes),
    status: "ready", error: null, everLoaded: true, admin, rosterFrom: hostId,
  }));
  // Fired alongside, not awaited: the roster is the answer this returns and a slower second
  // read must not hold it up. The store updates when it lands.
  loadCapabilities(hostId);
  // In a cluster the connection set is the ANCHOR's answer (lib/fleet.js), so a member's own roster
  // is read here for what it alone knows — health, latency, which member holds which capability —
  // and never to decide who is driven. Two sources for one list disagree the first time they
  // diverge. Without an anchor there is no second source and this is the only one.
  if (sessionStore.anchorOrigin()) return { added: 0, removed: 0 };
  return reconcileRosterToRegistry(nodes, { localHostId: hostId });
}

// The member holding `capability`, or null when nobody does or nothing has been read
// yet. Absent and held-by-nobody are different answers and both come back as null here
// on purpose: a surface that needs to tell them apart reads the assignment itself.
clusterStore.holderOf = (capability) => {
  const found = clusterStore.getState().capabilities.find(c => c.capability === capability);
  return found && found.held ? found.memberId : null;
};

clusterStore.refresh = (hostId) => {
  clusterStore.setState(s => ({ ...s, status: "loading", error: null }));
  return fetchRoster(hostId).then(roster => {
    applyRoster(hostId, roster);
    return roster.nodes;
  }).catch(err => {
    clusterStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
  });
};

// The anchor usually answers after the member does — discovery fires both and they land in whichever
// order the network decides. So the overlay is redone when its answer arrives, rather than the page
// holding a roster with a hole in it until the next discovery round a minute later.
fleetStore.subscribe(() => {
  const st = clusterStore.getState();
  if (!st.everLoaded) return;
  const nodes = withAnchorRoster(st.rosterRows);
  if (JSON.stringify(nodes) !== JSON.stringify(st.nodes)) clusterStore.setState(s => ({ ...s, nodes }));
});

// ---- Cluster discovery --------------------------------------------------
// The node set the SPA drives is the CLUSTER's, not the list of addresses this
// browser happens to have been pointed at. Ask any node we can reach for the
// converged roster and register the peers it names; the connection set grows in
// place, so every surface fans out over them from the next read on.
//
// Runs for every tier — a viewer resolves the same roster through the
// viewer-safe path inside fetchRoster. Nodes are tried in order and the FIRST
// that answers wins: the roster is converged, so any reachable node's view is
// the cluster's view. All nodes failing is not an error state here — an
// unreachable cluster is already surfaced by the connection banner, and a
// roster we could not read must not clear or contradict one we already have.
//
// The connection set FOLLOWS the roster (see reconcileRosterToRegistry): an alive
// + reachable peer carrying both a nodeId and a client URL is registered, and a
// node the roster no longer names is dropped. A peer we cannot verify stays a
// visible ghost on the Cluster page rather than becoming a dead connection; a
// member that is merely unwell keeps its connection, because being unreachable is
// not the same as having left.
// Only a connection whose BACKEND id is reconciled can be asked (api.peers
// requires a concrete id) — the seed starts id-less and GET /hosts fills it in.
const addressable = () => CONNECTIONS.filter(c => c.id);

clusterStore.discover = () => {
  const conns = addressable();
  const attempt = (i) => {
    if (i >= conns.length) return Promise.resolve(0);
    return Promise.resolve()
      .then(() => fetchRoster(conns[i].id))
      .then(roster => applyRoster(conns[i].id, roster).added)
      .catch(() => attempt(i + 1));
  };
  return attempt(0);
};

// Re-run discovery on a slow cadence so a node federated elsewhere joins this
// browser's fan-out on its own, without anyone opening the Cluster page.
const DISCOVER_MS = 60000;
let _discoverTimer = null;
function startDiscovery() {
  // An anchored panel has somewhere to ask even with nothing connected yet — the anchor is the
  // source of the fleet and needs no node to reach it. Without one there is nothing to discover
  // until a node is connected.
  if (_discoverTimer || (!CONNECTIONS.length && !sessionStore.anchorOrigin())) return;
  const run = () => {
    refreshFleetFromAnchor().catch(() => {});
    clusterStore.discover().catch(() => {});
  };
  // Nothing is addressable until the first GET /hosts reconciles an id, so wait
  // for that rather than spending the boot attempt on an empty set.
  if (addressable().length || sessionStore.anchorOrigin()) run();
  else {
    const stop = hostsStore.subscribe(() => {
      if (!addressable().length) return;
      stop();
      run();
    });
  }
  _discoverTimer = setInterval(run, DISCOVER_MS);
}

function stopDiscovery() {
  if (!_discoverTimer) return;
  clearInterval(_discoverTimer);
  _discoverTimer = null;
}

export { clusterStore, startDiscovery, stopDiscovery };

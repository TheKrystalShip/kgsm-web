// stores/cluster.js — the converged cluster-roster store for the Cluster page.
//
// Two backend surfaces feed the same shape: the admin peer roster
// (GET /peers, full peer-management rows) and the viewer-safe converged
// roster (GET /peers/roster, node-only rows). refresh() tries admin first and
// falls back to the viewer roster on a 403 — the store never fabricates a
// value either code path doesn't provide (honest null/"unknown").

import { api } from "../apiClient.js";
import { createStore } from "../store.js";

const clusterStore = createStore({
  nodes: [],
  status: "idle",
  error: null,
  everLoaded: false,
  admin: false,
});

// Admin PeerView row → normalized node.
function fromPeerRow(row) {
  return {
    nodeId: row.nodeId,
    label: row.nickname || row.nodeId,
    clientUrl: row.url,
    membership: row.membership || "unknown",
    status: row.status || "unknown",
    latencyMs: row.latencyMs ?? null,
    lastSeen: row.lastSeen || null,
    enabled: row.enabled !== false,
    apiVersion: row.apiVersion || null,
    peerId: row.id,
    isAdmin: true,
  };
}

// Viewer ClusterNodeView row → normalized node.
function fromClusterNodeRow(row) {
  return {
    nodeId: row.nodeId,
    label: row.label || row.nodeId,
    clientUrl: row.clientUrl,
    membership: row.membership || "unknown",
    status: row.status || "unknown",
    latencyMs: row.latencyMs ?? null,
    lastSeen: null,
    enabled: true,
    apiVersion: null,
    peerId: null,
    isAdmin: false,
  };
}

function isForbidden(err) {
  return !!err && (err.code === 403 || err.status === 403);
}

clusterStore.refresh = (hostId) => {
  clusterStore.setState(s => ({ ...s, status: "loading", error: null }));
  return api.peers(hostId).list().then(rows => {
    const nodes = rows.map(fromPeerRow);
    clusterStore.setState(s => ({ ...s, nodes, status: "ready", error: null, everLoaded: true, admin: true }));
    return nodes;
  }).catch(err => {
    if (!isForbidden(err)) {
      clusterStore.setState(s => ({ ...s, status: "error", error: err }));
      throw err;
    }
    return api.peers(hostId).roster().then(rows => {
      const nodes = rows.map(fromClusterNodeRow);
      clusterStore.setState(s => ({ ...s, nodes, status: "ready", error: null, everLoaded: true, admin: false }));
      return nodes;
    }).catch(err2 => {
      clusterStore.setState(s => ({ ...s, status: "error", error: err2 }));
      throw err2;
    });
  });
};

export { clusterStore };

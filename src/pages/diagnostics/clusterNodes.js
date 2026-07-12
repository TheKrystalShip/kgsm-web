// clusterNodes.js — merges the connected-node roster (hostsStore.list — the
// primitive with capacity meters + the per-node deep-dive) with federation
// data (clusterStore.nodes — gossip membership/status/latency) into the ONE
// node shape both the constellation and the node list render from.
//
// The match is best-effort, by design: a connected host and a federation peer
// describe the same machine from two different sources (the client's host
// registry vs. the backend's peer gossip) with no shared foreign key, so a
// case-insensitive substring match across hostname/name against
// nodeId/label/clientUrl is the honest thing to do — a host with no confident
// match still renders (federation data is enrichment, never a gate); it's just
// shown without a membership/status badge, never guessed.

function norm(s) {
  return (s || "").toString().trim().toLowerCase();
}

// matchFederationNode(host, clusterNodes) — first federation node whose
// nodeId/label/clientUrl contains (or is contained by) the host's hostname or
// display name. Returns null on no confident match.
function matchFederationNode(host, clusterNodes) {
  const hHostname = norm(host && host.hostname);
  const hName = norm(host && host.name);
  if (!hHostname && !hName) return null;
  for (const n of clusterNodes) {
    const candidates = [norm(n.nodeId), norm(n.label), norm(n.clientUrl)];
    for (const c of candidates) {
      if (!c) continue;
      if (hHostname && (c.includes(hHostname) || hHostname.includes(c))) return n;
      if (hName && (c.includes(hName) || hName.includes(c))) return n;
    }
  }
  return null;
}

// buildClusterNodes(hosts, clusterNodes, pingByHost, localId) — one entry per
// connected host: { key, host, fed, ping, latencyMs, isLocal, ghost:false },
// PLUS one "ghost" entry per federation node that matched no connected host:
// { key: "fed:"+nodeId, host:null, fed, ping:null, latencyMs, isLocal:false,
// ghost:true } — a peer the backend gossips about that this browser has no
// live host session for. A federation node is counted at most once: the same
// node that enriches a connected host is never also emitted as a ghost
// (tracked by nodeId as each host is matched). `latencyMs` is the ONE honest
// latency reading either side of the merge exposes to the constellation:
// connected → the client-measured ping (never the federation's own number,
// which measures a different link); ghost → the federation-reported latency
// (the only number that exists for a peer with no host session). Sorted
// local-first, then connected hosts by name, then ghosts by name — ghosts
// read as secondary, ordered last.
function buildClusterNodes(hosts, clusterNodes, pingByHost, localId) {
  const fedList = clusterNodes || [];
  const matchedIds = new Set();
  const nodes = (hosts || []).map(host => {
    const fed = matchFederationNode(host, fedList);
    if (fed) matchedIds.add(fed.nodeId);
    const ping = (pingByHost && pingByHost[host.id]) || null;
    return {
      key: host.id,
      host,
      fed: fed || null,
      ping,
      latencyMs: ping && ping.ms != null ? ping.ms : null,
      isLocal: host.id === localId,
      ghost: false,
    };
  });
  nodes.sort((a, b) => (b.isLocal - a.isLocal) || a.host.name.localeCompare(b.host.name));

  const ghosts = fedList
    .filter(n => !matchedIds.has(n.nodeId))
    .map(n => ({
      key: "fed:" + n.nodeId,
      host: null,
      fed: n,
      ping: null,
      latencyMs: n.latencyMs != null ? n.latencyMs : null,
      isLocal: false,
      ghost: true,
    }))
    .sort((a, b) => (a.fed.label || a.fed.nodeId).localeCompare(b.fed.label || b.fed.nodeId));

  return [...nodes, ...ghosts];
}

export { buildClusterNodes, matchFederationNode };

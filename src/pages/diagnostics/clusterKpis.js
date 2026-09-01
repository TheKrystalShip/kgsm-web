// clusterKpis.js — the six figures the Cluster page opens with, derived in one place.
//
// Each is a pure function over the entries `clusterNodes.js` already built, so a tile renders one
// of these and holds no rule of its own. They live apart from the band that draws them for the same
// reason `dashboard/fleetKpis.js` does: a figure computed inside a tile body is a rule with one
// call site and no way to check it.
//
// The questions are the cluster's, not a machine's. A node's own CPU is on its row and on its page;
// what neither of those can answer is whether the CLUSTER is whole — every member accounted for,
// every capability served, nothing unreachable, every member on the same build.
//
// THE RULE THROUGHOUT: a figure nothing measured is null, and the tile says so. A zero standing in
// for "nobody could tell me" reads as a clean bill of health, which is the one reading that must
// never be given by accident.

import { hostHealth } from "../../components/HostCardBody.jsx";
import { membershipMeta } from "./clusterBadges.jsx";

// A member is answering when the roster says it is reachable, or — with no roster row at all — when
// this browser holds a live session with it. Those are two different observations of the same fact
// and either one is enough; neither is inferred from the other's absence.
function answering(entry) {
  if (entry.fed) {
    if (entry.fed.enabled === false) return false;
    if (entry.fed.membership === "left" || entry.fed.membership === "dead") return false;
    if (entry.fed.status === "unreachable") return false;
    if (entry.fed.status === "reachable") return true;
  }
  return !!(entry.host && entry.host.online);
}

// Members — how many of the cluster's members are answering, and who is not.
//
// The member that cannot be counted is the one nothing has said anything about: no roster row and
// no session. It is left out of `answering` and named in `silent`, because folding it into the
// down count would report a fault the cluster has not reported.
function members(entries) {
  const list = entries || [];
  if (!list.length) return { total: 0, up: 0, down: [], silent: [] };
  const down = [], silent = [];
  let up = 0;
  for (const e of list) {
    const name = (e.fed && e.fed.label) || (e.host && e.host.name) || e.key;
    if (answering(e)) { up++; continue; }
    if (!e.fed && !e.host) { silent.push(name); continue; }
    down.push({ name, why: e.fed ? membershipMeta(e.fed.membership).label : "not connected" });
  }
  return { total: list.length, up, down, silent };
}

// Capabilities — how many the cluster serves out of how many it has assigned, and which are
// orphaned. An assignment held by nobody is the state that reports as healthy from the inside:
// every member stands by against a holder that will never answer, and nothing errors.
//
// `null` when the assignments have not been read. A cluster with no assignments at all is a
// different answer from a cluster nobody asked, and both would otherwise be zero.
function capabilities(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const assigned = rows.filter(c => c.held || c.orphaned || c.memberId);
  const orphaned = rows.filter(c => c.orphaned).map(c => c.capability);
  const served = rows.filter(c => c.held && !c.orphaned).length;
  return { served, assigned: assigned.length, orphaned };
}

// Slowest link — the furthest member this browser has actually measured a round trip to, which is
// the only latency figure a cluster has: every reading is from here, so "slowest" means slowest
// from where the panel is standing and nowhere else.
//
// Unmeasured members are not slow, they are unmeasured, and they are counted separately so a
// cluster whose worst link is unknown does not report the best of what it happened to reach.
function slowestLink(entries) {
  let worst = null, unmeasured = 0;
  for (const e of entries || []) {
    if (e.latencyMs == null) { unmeasured++; continue; }
    if (!worst || e.latencyMs > worst.ms) {
      worst = { ms: e.latencyMs, name: (e.fed && e.fed.label) || (e.host && e.host.name) || e.key };
    }
  }
  return worst ? { ...worst, unmeasured } : null;
}

// Busiest node — the one meter, on any node, closest to running out of room.
//
// The ranking is `hostHealth`'s and deliberately not a fresh one: it compares each meter against
// its OWN amber line, so memory at 84% outranks CPU at 71% rather than losing to it. Anchors are
// absent because an anchor reports no capacity, and a node whose metrics feed is down contributes
// nothing rather than a zero.
function busiest(entries) {
  let top = null;
  for (const e of entries || []) {
    if (!e.host) continue;
    const health = hostHealth(e.host);
    if (!health.hasTelemetry || !health.worst) continue;
    const m = health.worst;
    const over = m.warnAt ? m.pct / m.warnAt : m.pct / 100;
    if (!top || over > top.over) {
      top = { over, pct: m.pct, label: m.label, value: m.value, tone: m.tone, name: e.host.name };
    }
  }
  return top;
}

// Game servers — what is running across the cluster, and on how many nodes.
//
// Counted from the servers the panel holds rather than from a per-node figure, because a node this
// browser cannot reach reports no roster at all: `blind` names how many of them there are so the
// count reads as a floor rather than as the whole fleet.
function gameServers(entries, servers) {
  const list = servers || [];
  const nodes = (entries || []).filter(e => !(e.fed && e.fed.kind === "anchor"));
  const blind = nodes.filter(e => !e.host || !e.host.online).length;
  const running = list.filter(s => s.status === "online").length;
  const onNodes = new Set(list.filter(s => s.status === "online").map(s => s.hostId)).size;
  return { running, total: list.length, onNodes, blind };
}

// Build — the version every member reports, or how many different ones there are.
//
// A cluster speaks one protocol and a member on a different build is the reason a call that worked
// yesterday stops. Read from whatever each member exposes: a connected node states its own build,
// and a member reached only through the admin roster states the API version it answered with. A
// member that states neither is counted as unknown rather than assumed to agree.
function build(entries) {
  const seen = new Map();
  let unknown = 0;
  for (const e of entries || []) {
    const v = (e.host && e.host.panel_version && e.host.panel_version !== "—" ? e.host.panel_version : null)
      || (e.fed && e.fed.apiVersion) || null;
    if (!v) { unknown++; continue; }
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  if (!seen.size) return null;
  const versions = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  return { versions: versions.map(([v, n]) => ({ version: v, count: n })), distinct: seen.size, unknown };
}

export { answering, build, busiest, capabilities, gameServers, members, slowestLink };

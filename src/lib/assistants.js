// assistants.js — which assistants this browser can talk to, and where each one lives.
//
// The assistant runs in one of two standings and nothing in between, so a panel that only knows one
// of them is blind to half the deployments there are:
//
//   LEAF    — a service on a node, discovered from that node's `assistant` capability and reached at
//             the public address the node reports for it. It holds its own accounts and mints its own
//             sessions, so this browser signs in to it separately.
//   ANCHOR  — a member of the cluster in its own right, holding the cluster's `assistant` capability
//             and reached at its own member address. Another member holds `auth`, so its sign-in
//             doors are closed and it verifies the CLUSTER's session instead: the browser presents
//             the credential it already has and there is no second sign-in at all.
//
// Both can exist at once — a cluster's assistant and a node running one of its own — which is why
// this returns a LIST and the surface offers a choice rather than resolving one silently.
//
// Pure: every fact arrives as an argument. The stores that hold them are read by the surface, which
// keeps this testable and keeps the module out of the store graph's cycles.

import { CAPS, assistantHostsAll, hostCapability } from "./capabilities.js";

const ASSISTANT_CAPABILITY = "assistant";

// The member holding the cluster's assistant capability, or null.
//
// Read through the ASSIGNMENT rather than off whichever member happens to state an address. A
// capability belongs to the cluster, and going through the assignment means only its holder is
// believed — so pointing this browser somewhere else takes a visible reassignment rather than any
// member simply claiming the role.
//
// An orphaned assignment names a member the cluster no longer has. It is held by nobody and served
// by nobody, so it names no assistant here.
function assistantHolder(capabilities) {
  for (const row of capabilities || []) {
    if (!row || row.capability !== ASSISTANT_CAPABILITY) continue;
    if (row.held === false || row.orphaned) return null;
    return row.memberId || null;
  }
  return null;
}

// A member's standing, in the state vocabulary a capability already speaks, so one surface renders
// both kinds through one switch.
//
// A member that has left, or that is not being reached, is down and says which — there is nothing to
// send a turn to. A member nobody has probed yet is unknown rather than assumed well.
function memberState(member) {
  if (!member) return { state: "unknown", message: null };
  if (member.membership === "left")
    return { state: "down", message: "This assistant has left the cluster." };
  if (member.status === "unreachable")
    return { state: "down", message: "The cluster cannot reach this assistant." };
  if (member.status === "reachable") return { state: "operational", message: null };
  return { state: "unknown", message: null };
}

// assistantTargets({ hosts, members, capabilities }) — every assistant this browser could address.
//
// `hosts` are the connected nodes, `members` the cluster's roster (nodes AND anchors), `capabilities`
// the cluster's capability assignments. A standalone deployment passes the last two empty and gets
// exactly the leaf list it always had.
//
// The anchor comes first because it is the cluster's own assistant: it acts on every node, where a
// leaf knows only the machine it runs on. That ordering is also the default — the surface takes the
// first entry when nothing else has been chosen.
function assistantTargets({ hosts, members, capabilities }) {
  const targets = [];

  const holder = assistantHolder(capabilities);
  if (holder) {
    const member = (members || []).find(m => m && m.nodeId === holder) || null;
    const origin = (member && member.clientUrl) || null;
    const standing = memberState(member);
    // A holder the roster has no row for is a member this browser has not been told about. It is not
    // an assistant that is down — there is no address to be down at — so it is named nowhere.
    if (member && origin) {
      targets.push({
        id: holder,
        name: "Cluster assistant",
        // How a sentence refers to it. A leaf belongs to the machine it runs on and is named that
        // way; the cluster's own belongs to no machine, so the possessive that reads naturally for
        // one is wrong for the other, and every sentence about an assistant uses this instead.
        title: "the cluster assistant",
        kind: "anchor",
        origin,
        state: standing.state,
        message: standing.message,
      });
    }
  }

  // Through the capability layer's own filter, which is what decides a node OFFERS an assistant:
  // provisioned, and not a node currently refusing this session. A node whose assistant then went
  // down stays in the list, disabled, so the surface can say so rather than silently losing it.
  for (const host of assistantHostsAll(hosts)) {
    const cap = hostCapability(host, CAPS.ASSISTANT);
    targets.push({
      id: host.id,
      name: host.name || host.id,
      title: (host.name || host.id) + "\u2019s assistant",
      kind: "leaf",
      origin: (cap.info && cap.info.url) || null,
      state: cap.state,
      message: cap.message || null,
    });
  }

  return targets;
}

// The ones that can answer right now. `assistantTargets` keeps a target that is down, because a
// surface has to be able to say WHY the assistant it was using went quiet; this is the set worth
// sending a turn to.
const usableTargets = (targets) =>
  (targets || []).filter(t => t.state === "operational" || t.state === "degraded");

// Which target the dock addresses, in order: the one this account chose, then the cluster's own
// assistant, then the only candidate there is.
//
// The stored choice is checked against the list rather than trusted: an assistant that has left the
// cluster, or a node that is no longer connected, must not hold the dock pointed at nothing.
//
// With several leaves, no anchor and nothing chosen, the answer is deliberately NULL. That is not a
// failure — it is the picker, and binding to whichever node sorted first would be a choice nobody
// made.
function resolveTarget(targets, chosenId) {
  const list = targets || [];
  if (chosenId) {
    const chosen = list.find(t => t.id === chosenId);
    if (chosen) return chosen;
  }
  const anchor = list.find(t => t.kind === "anchor");
  if (anchor) return anchor;
  const usable = usableTargets(list);
  if (usable.length === 1) return usable[0];
  if (!usable.length && list.length === 1) return list[0];
  return null;
}

export { assistantHolder, assistantTargets, resolveTarget, usableTargets };

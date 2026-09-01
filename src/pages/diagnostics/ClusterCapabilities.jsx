// ClusterCapabilities — the Capabilities card: which member serves each of the cluster's
// capabilities, and what each member is able to serve.
//
// It is the only surface on the Cluster page that spans both kinds of member, because a capability
// belongs to the CLUSTER rather than to any machine: a node and an anchor are equally able to hold
// one, and the Nodes and Anchors cards can each only ever tell half of that. Rows are capabilities,
// columns are members, and the control that moves a capability sits on the row it moves.
//
// FOUR CELL STATES, AND ONLY ONE OF THEM IS A CLAIM ABOUT ABILITY.
//   holder   — the assignment names this member. Cluster state, versioned and converged.
//   offers   — this member's OWN capability block reports the service, so it could hold it.
//   nobody   — the assignment names a member the cluster no longer has (orphaned).
//   unknown  — nothing has said either way, drawn as a quiet dash.
//
// The last one carries the weight. Ability is only knowable where a member publishes a capability
// block, which is a node this browser holds a session with; an anchor publishes none, and a node
// nobody can reach publishes none either. Guessing "no" there would draw a grid of confident
// refusals nothing measured, so those cells say nothing at all.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { CAP_ORDER, hostCapability } from "../../lib/capabilities.js";
import { compareNodeNames } from "../../lib/nodeLabel.js";
import { can } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore } from "../../lib/stores.js";
import { pingStore } from "../../lib/stores/ui.js";
import { CapabilityAssignDialog } from "./clusterActions.jsx";
import { buildClusterNodes } from "./clusterNodes.js";

const NOOP = () => {};
const nameOf = (e) => (e.fed && e.fed.label) || (e.host && e.host.name) || e.key;
const memberIdOf = (e) => (e.fed && e.fed.nodeId) || (e.host && e.host.id) || null;
const kindOf = (e) => (e.fed && e.fed.kind) || "node";

// What a member has to say about its own ability to serve `capability`.
//
// Only a connected node answers this, and only for the capabilities the per-host service model
// actually covers. That last clause is the load-bearing one: `hostCapability` reports "absent" for
// any id it does not know, so asking it about a capability outside its vocabulary would turn "the
// host model has never heard of auth" into "this node cannot serve auth" — a refusal nothing
// measured, drawn across a whole column. Outside that vocabulary the answer is unknown.
function abilityOf(entry, capability) {
  if (!entry.host) return "unknown";
  if (!CAP_ORDER.includes(capability)) return "unknown";
  const rec = hostCapability(entry.host, capability);
  if (!rec) return "unknown";
  if (rec.state === "absent") return "no";
  if (rec.state === "unknown") return "unknown";
  return "offers";
}

function Cell({ state, title }) {
  if (state === "holder") return <div className="cap-cell cap-cell--holder" title={title}>holder</div>;
  if (state === "nobody") return <div className="cap-cell cap-cell--nobody" title={title}>nobody</div>;
  if (state === "offers") return <div className="cap-cell cap-cell--offers" title={title}>offers</div>;
  if (state === "no") return <div className="cap-cell cap-cell--no" title={title}>·</div>;
  return <div className="cap-cell cap-cell--unknown" title={title}>—</div>;
}

function ClusterCapabilities({ hovered, onHover, onSelect }) {
  const hosts = useStore(hostsStore, s => s.list);
  const roster = useStore(clusterStore, s => s.nodes);
  const capabilities = useStore(clusterStore, s => s.capabilities);
  const clusterAdmin = useStore(clusterStore, s => s.admin);
  const rosterFrom = useStore(clusterStore, s => s.rosterFrom);
  const pingByHost = useStore(pingStore, s => s.byHost);
  const [assigning, setAssigning] = React.useState(null);

  const hover = onHover || NOOP;
  const select = onSelect || NOOP;

  // Anchors first, then nodes, each by name — the same order the two cards above read in, so a
  // column and a row are found in the same place on both.
  const members = React.useMemo(() => {
    const built = buildClusterNodes(hosts, roster, pingByHost).filter(e => memberIdOf(e));
    return built.sort((a, b) => {
      const ka = kindOf(a) === "anchor" ? 0 : 1, kb = kindOf(b) === "anchor" ? 0 : 1;
      return ka - kb || compareNodeNames(nameOf(a), nameOf(b));
    });
  }, [hosts, roster, pingByHost]);

  const rows = React.useMemo(() => {
    const seen = new Map();
    for (const c of capabilities || []) {
      if (!c || !c.capability) continue;
      seen.set(c.capability, c);
    }
    return [...seen.values()].sort((a, b) => a.capability.localeCompare(b.capability));
  }, [capabilities]);

  const canReassign = can("host.manage") && !!clusterAdmin && !!rosterFrom;

  if (!rows.length) {
    return (
      <BriefCard icon="grid-3x3" title="Capabilities" count={0} countTone="neutral">
        <div className="chat-brief__empty">
          <Icon name="grid-3x3" size={15} />
          <span>This cluster assigns no capabilities.</span>
        </div>
      </BriefCard>
    );
  }

  const served = rows.filter(c => c.held && !c.orphaned).length;
  const orphaned = rows.filter(c => c.orphaned).length;

  return (
    <BriefCard icon="grid-3x3" title="Capabilities"
      count={served + " of " + rows.length}
      countTone={orphaned ? undefined : "neutral"}
      countTitle="Capabilities with a member serving them">
      <div className="cap-matrix-scroll">
        <table className="cap-matrix">
          <thead>
            <tr>
              <th className="cap-matrix__rowhead"></th>
              {members.map(m => (
                <th key={m.key}
                  className={"cap-matrix__col" + (hovered === m.key ? " is-hovered" : "")}
                  onMouseEnter={() => hover(m.key)}
                  onMouseLeave={() => hover(null)}
                >
                  <button className="cap-matrix__colbtn" onClick={() => select(m.key)}>
                    <span className="cap-matrix__colname">{nameOf(m)}</span>
                    <span className="cap-matrix__colkind">{kindOf(m)}</span>
                  </button>
                </th>
              ))}
              {/* Takes the slack so the member columns stay beside the capability they belong to
                  rather than being pushed to the far edge of a wide card by two of them. */}
              <th className="cap-matrix__slack"></th>
              {canReassign && <th className="cap-matrix__act"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.capability}>
                <th className="cap-matrix__rowhead" scope="row">
                  <span className="cap-matrix__cap">{row.capability}</span>
                  <span className="cap-matrix__state">
                    {row.orphaned
                      ? "assigned to " + row.memberId + ", which has left"
                      : row.held ? "served" : "held by nobody"}
                  </span>
                </th>
                {members.map(m => {
                  const id = memberIdOf(m);
                  const isHolder = row.memberId === id;
                  const state = isHolder ? (row.orphaned ? "nobody" : "holder") : abilityOf(m, row.capability);
                  return (
                    <td key={m.key}
                      className={"cap-matrix__cell" + (hovered === m.key ? " is-hovered" : "")}
                      onMouseEnter={() => hover(m.key)}
                      onMouseLeave={() => hover(null)}
                    >
                      <Cell state={state} title={nameOf(m) + " · " + row.capability} />
                    </td>
                  );
                })}
                <td className="cap-matrix__slack"></td>
                {canReassign && (
                  <td className="cap-matrix__act">
                    <button className="icon-btn"
                      title={"Move " + row.capability + " to another member"}
                      aria-label={"Move " + row.capability + " to another member"}
                      onClick={() => setAssigning(row)}>
                      <Icon name="corner-up-right" size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cap-legend">
        <span className="cap-legend__item"><i className="cap-legend__sw cap-legend__sw--holder"></i>serving it now</span>
        <span className="cap-legend__item"><i className="cap-legend__sw cap-legend__sw--offers"></i>offers the service</span>
        <span className="cap-legend__item"><i className="cap-legend__sw cap-legend__sw--nobody"></i>nobody is serving it</span>
        <span className="cap-legend__item"><i className="cap-legend__sw cap-legend__sw--unknown"></i>not reported</span>
      </div>
      {assigning && (
        <CapabilityAssignDialog
          hostId={rosterFrom}
          capability={assigning.capability}
          currentMemberId={assigning.memberId}
          members={roster}
          onClose={() => setAssigning(null)}
        />
      )}
    </BriefCard>
  );
}

export { ClusterCapabilities };
export default ClusterCapabilities;

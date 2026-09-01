// ClusterKpis — the band of six the Cluster page opens with.
//
// The figures are `clusterKpis.js`; this file is the rendering and nothing else. It reuses the
// panel's `<KPI>` card and the diagnostics band's own grid, so a cluster tile and a node tile are
// the same object at the same size — the Cluster page gains a glance layer without inventing a
// second one.
//
// Every tile states what it measured or that it could not. A figure that came back null renders
// "—" with the muted tone rather than a zero, because a zero here reads as a healthy cluster.

import React from "react";
import { KPI } from "../../components/KPI.jsx";
import { useStore } from "../../lib/store.js";
import { serversStore } from "../../lib/stores.js";
import { build, busiest, capabilities, gameServers, members, slowestLink } from "./clusterKpis.js";

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// A build reads `0.171.0+96416f0ed64d`, and the half after the plus is a commit nobody compares by
// eye — it is also the half that overruns a tile a sixth of a row wide. The version is what the
// figure is about; the full string is on the member's own row.
const shortBuild = (v) => String(v || "").split("+")[0];

function ClusterKpis({ entries, capabilityRows }) {
  const servers = useStore(serversStore, s => s.list);

  const mem = React.useMemo(() => members(entries), [entries]);
  const caps = React.useMemo(() => capabilities(capabilityRows), [capabilityRows]);
  const slow = React.useMemo(() => slowestLink(entries), [entries]);
  const busy = React.useMemo(() => busiest(entries), [entries]);
  const games = React.useMemo(() => gameServers(entries, servers), [entries, servers]);
  const ver = React.useMemo(() => build(entries), [entries]);

  // Members. The sub names the member that is not answering rather than counting them, because on a
  // cluster this size the name is the whole answer and a count sends somebody looking for it.
  const memDown = mem.down.length;
  const memSub = memDown
    ? mem.down.map(d => d.name + " · " + d.why).join(", ")
    : mem.silent.length
      ? plural(mem.silent.length, "member has", "members have") + " said nothing"
      : mem.total ? "all answering" : "no members yet";

  return (
    <div className="diag-tiles cluster-kpis">
      <KPI icon="server" label="Members"
        tone={memDown ? "danger" : mem.silent.length ? "warn" : mem.total ? "ok" : "muted"}
        value={mem.total ? mem.up : "—"}
        unit={mem.total ? "of " + mem.total : undefined}
        sub={memSub} />

      <KPI icon="grid-3x3" label="Capabilities"
        tone={!caps ? "muted" : caps.orphaned.length ? "warn" : caps.assigned ? "ok" : "muted"}
        value={caps ? caps.served : "—"}
        unit={caps ? "of " + caps.assigned : undefined}
        sub={!caps ? "not read yet"
          : caps.orphaned.length ? caps.orphaned.join(", ") + " held by nobody"
          : caps.assigned ? "every assignment served" : "none assigned"} />

      <KPI icon="waypoints" label="Slowest link"
        tone={slow ? "muted" : "off"}
        value={slow ? (slow.ms < 1 ? "<1" : Math.round(slow.ms)) : "—"}
        unit={slow ? "ms" : undefined}
        sub={!slow ? "nothing measured yet"
          : slow.name + (slow.unmeasured ? " · " + plural(slow.unmeasured, "member", "members") + " unmeasured" : "")} />

      <KPI icon="gauge" label="Busiest node"
        tone={busy ? busy.tone : "off"}
        value={busy ? Math.round(busy.pct) + "%" : "—"}
        sub={busy ? busy.name + " · " + busy.label.toLowerCase() + " " + busy.value : "no node is reporting capacity"} />

      <KPI icon="boxes" label="Game servers"
        tone={games.total ? "muted" : "off"}
        value={games.total ? games.running : "—"}
        unit={games.total ? "of " + games.total : undefined}
        sub={!games.total ? "none installed"
          : "on " + plural(games.onNodes, "node", "nodes")
            + (games.blind ? " · " + plural(games.blind, "node", "nodes") + " unreadable" : "")} />

      <KPI icon="git-branch" label="Build"
        tone={!ver ? "muted" : ver.distinct > 1 ? "warn" : "ok"}
        value={ver ? (ver.distinct === 1 ? shortBuild(ver.versions[0].version) : ver.distinct) : "—"}
        unit={ver && ver.distinct > 1 ? "versions" : undefined}
        sub={!ver ? "no member reported one"
          : ver.distinct === 1
            ? plural(ver.versions[0].count, "member agrees", "members agree")
              + (ver.unknown ? " · " + ver.unknown + " unknown" : "")
            : ver.versions.map(v => shortBuild(v.version) + " ×" + v.count).join(", ")} />
    </div>
  );
}

export { ClusterKpis };

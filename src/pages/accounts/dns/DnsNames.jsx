// DnsNames — every name the cluster has claimed, in the three tables a name's KIND decides: the
// nodes, the anchors, and the game servers (each with its aliases). A fourth table, Public
// addresses, is not names at all — it groups every member by the address its host resolves to, so a
// shared router's port space is visible before it becomes a collision.
//
// Each table is its own component and fetches through `useDnsStatus` itself, exactly like the KPIs
// and the attention lane — that is what lets `../../dashboard/catalog.js` pin any one of them on its
// own. The filter chips live only here, in the tab that shows all four at once; a pinned table has
// no chips beside it and simply shows everything it holds.
//
// "Same node" port hints are computed here, client-side, from each game name's own `ports`: the
// anchor's own `collisions` field answers a different question — two DIFFERENT members sharing one
// public address — because a node's own port conflicts are the engine's to catch, not the DNS
// anchor's.

import React from "react";

import { CardTable } from "../../../components/CardTable.jsx";
import { Icon } from "../../../components/Icon.jsx";
import { PinButton } from "../../../components/widgets/PinButton.jsx";
import { removeAlias } from "../../../lib/dnsClient.js";
import { dnsStore } from "../../../lib/stores/dns.js";
import { AddAliasModal } from "./AddAliasModal.jsx";
import { fmtShortDate, NameCell, shortName, useDnsStatus } from "./dnsKit.jsx";
import { DnsRowActions } from "./dnsRowActions.jsx";

const NAME_STATE_META = {
  published: { tone: "ok", label: "published" },
  pending: { tone: "provisional", label: "pending" },
  blocked: { tone: "danger", label: "blocked" },
};

function NameStateBadge({ state }) {
  const meta = NAME_STATE_META[state] || { tone: "muted", label: state || "unknown" };
  return <span className={"cluster-badge cluster-badge--" + meta.tone}><span className="cluster-badge__dot"></span>{meta.label}</span>;
}

function fmtPortRange(p) {
  return (p.start === p.end ? String(p.start) : p.start + "–" + p.end) + "/" + p.protocol;
}

function certificateFor(certificates, name) {
  const orders = (certificates && certificates.orders) || [];
  const order = orders.find((o) => o.name === name);
  return order && order.state === "issued" && order.notAfter ? "until " + fmtShortDate(order.notAfter) : "—";
}

function overlaps(a, b) {
  return a.protocol.toLowerCase() === b.protocol.toLowerCase() && a.start <= b.end && b.start <= a.end;
}

// Every collision hint for one game name: the ones this browser derives from siblings on the same
// member, plus the anchor's own cross-member list.
function collisionHints(row, gameRows) {
  const hints = [];
  for (const other of gameRows) {
    if (other.name === row.name || other.member !== row.member || !other.ports) continue;
    for (const p of row.ports || []) {
      for (const q of other.ports) {
        if (overlaps(p, q)) hints.push({ port: p, otherName: other.name, where: "same node" });
      }
    }
  }
  for (const c of row.collisions || []) {
    hints.push({ port: { start: c.start, end: c.end, protocol: c.protocol }, otherName: c.name, where: c.member });
  }
  return hints;
}

function CollisionsCell({ hints, zone }) {
  if (!hints.length) return <span className="dim">none</span>;
  return (
    <span className="dns-collisions">
      {hints.map((h, i) => (
        <span key={i} className="cluster-chip cluster-chip--muted">
          {fmtPortRange(h.port)} · {shortName(h.otherName, zone)}, {h.where}
        </span>
      ))}
    </span>
  );
}

// DnsNodesTable — every node's own name, sticky to that machine however many anchors it also runs.
function DnsNodesTable({ onlyBlocked = false }) {
  const { data } = useDnsStatus();
  const zone = data && data.standing && data.standing.zone;
  const names = (data && data.names) || [];
  let rows = names.filter((n) => n.kind === "member");
  if (onlyBlocked) rows = rows.filter((r) => r.state === "blocked");

  return (
    <CardTable icon="server-cog" title="Nodes" count={rows.length}
      pin={<PinButton type="dns.nodes" params={{}} label="Nodes" />}
      columns={[
        {
          key: "name", label: "Name", width: "minmax(0,1.4fr)",
          render: (r) => <NameCell name={shortName(r.name, zone)} sub={r.member + " → " + (r.content || "unresolved")} />,
        },
        { key: "points", label: "Points at", width: "minmax(0,1.6fr)", render: (r) => <span className="mono dim">{r.content ? r.type + " " + r.content : "—"}</span> },
        { key: "member", label: "Member", width: "minmax(0,0.9fr)" },
        { key: "state", label: "State", width: "130px", render: (r) => <NameStateBadge state={r.state} /> },
        { key: "cert", label: "Certificate", width: "110px", render: (r) => certificateFor(data && data.certificates, r.name) },
      ]}
      rows={rows}
      getKey={(r) => r.name}
      empty="No node names"
      className="dns-table dns-table--nodes"
    />
  );
}

// DnsAnchorsTable — every anchor's own name. No row actions at all: an anchor is reached through the
// cluster's Anchors card and moves capability through Settings, never from here.
function DnsAnchorsTable({ onlyBlocked = false }) {
  const { data } = useDnsStatus();
  const zone = data && data.standing && data.standing.zone;
  const names = (data && data.names) || [];
  let rows = names.filter((n) => n.kind === "capability");
  if (onlyBlocked) rows = rows.filter((r) => r.state === "blocked");

  return (
    <CardTable icon="anchor" title="Anchors" count={rows.length}
      pin={<PinButton type="dns.anchors" params={{}} label="Anchors" />}
      columns={[
        {
          key: "name", label: "Name", width: "minmax(0,1.4fr)",
          render: (r) => <NameCell name={shortName(r.name, zone)} sub={r.member} />,
        },
        { key: "points", label: "Points at", width: "minmax(0,1.6fr)", render: (r) => <span className="mono dim">{r.content ? r.type + " " + r.content : "—"}</span> },
        { key: "member", label: "Held by", width: "minmax(0,0.9fr)" },
        { key: "state", label: "State", width: "130px", render: (r) => <NameStateBadge state={r.state} /> },
        { key: "cert", label: "Certificate", width: "110px", render: (r) => certificateFor(data && data.certificates, r.name) },
      ]}
      rows={rows}
      getKey={(r) => r.name}
      empty="No anchor names"
      className="dns-table dns-table--anchors"
    />
  );
}

// DnsServersTable — every published game name and its aliases, with the "Add alias" action and the
// one write a server row can offer: an alias giving it up.
function DnsServersTable({ onlyBlocked = false }) {
  const { data } = useDnsStatus();
  const [adding, setAdding] = React.useState(false);
  const [pending, setPending] = React.useState(null);
  const [err, setErr] = React.useState(null);

  const zone = data && data.standing && data.standing.zone;
  const names = (data && data.names) || [];
  const gameRows = names.filter((n) => n.kind === "game");
  let rows = names.filter((n) => n.kind === "game" || n.kind === "alias");
  if (onlyBlocked) rows = rows.filter((r) => r.state === "blocked");

  const removeAliasAction = (row) => ({
    icon: "trash-2", label: "Remove alias", tone: "danger", pending: pending === row.name,
    onRun: () => {
      setErr(null);
      setPending(row.name);
      removeAlias(row.name)
        .catch((e) => setErr((e && e.userMessage) || "That didn’t work."))
        .finally(() => { setPending(null); dnsStore.refresh().catch(() => {}); });
    },
  });

  return (
    <>
      {err && <div className="settings-users__note"><span>{err}</span></div>}
      <CardTable icon="server" title="Servers" count={rows.length}
        pin={<PinButton type="dns.servers" params={{}} label="Servers" />}
        action={(
          <button className="dash-section__more" onClick={() => setAdding(true)}>
            <Icon name="plus" size={11} strokeWidth={2.4} /> Add alias
          </button>
        )}
        columns={[
          {
            key: "name", label: "Name", width: "minmax(0,1.3fr)",
            render: (r) => {
              const hint = r.kind === "game" ? collisionHints(r, gameRows)[0] : null;
              const sub = r.kind === "alias"
                ? shortName(r.aliasOf || r.key, zone) + " · " + r.member
                : [r.member, (r.ports || []).map(fmtPortRange).join(" "), hint && (shortName(hint.otherName, zone) + ", " + hint.where)]
                  .filter(Boolean).join(" · ");
              return (
                <NameCell name={shortName(r.name, zone)} sub={sub}
                  badge={r.kind === "alias" && <span className="cluster-chip cluster-chip--muted" style={{ marginLeft: 6 }}>alias</span>} />
              );
            },
          },
          { key: "server", label: "Server", width: "minmax(0,1fr)", render: (r) => shortName(r.aliasOf, zone) || r.key || "—" },
          { key: "member", label: "Node", width: "minmax(0,0.6fr)" },
          {
            key: "ports", label: "Ports", width: "minmax(0,1.4fr)",
            render: (r) => <span className="mono dim">{(r.ports || []).map(fmtPortRange).join(" · ") || "—"}</span>,
          },
          {
            key: "collisions", label: "Collisions", width: "minmax(0,1.6fr)",
            render: (r) => <CollisionsCell hints={r.kind === "game" ? collisionHints(r, gameRows) : []} zone={zone} />,
          },
          { key: "state", label: "State", width: "130px", render: (r) => <NameStateBadge state={r.state} /> },
          {
            key: "actions", label: "", align: "right", width: "56px",
            render: (r) => <DnsRowActions action={r.kind === "alias" ? removeAliasAction(r) : null} />,
          },
        ]}
        rows={rows}
        getKey={(r) => r.name}
        empty="No server names"
        className="dns-table dns-table--servers"
      />
      {adding && (
        <AddAliasModal
          gameRows={gameRows}
          existingNames={names.map((n) => n.name)}
          zone={data && data.standing && data.standing.zone}
          playBase={data && data.standing && data.standing.bases && data.standing.bases.play}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); dnsStore.refresh().catch(() => {}); }}
        />
      )}
    </>
  );
}

// DnsAddressesTable — one row per public address this cluster's members are reached at, with who is
// behind it and how many servers that puts there — read straight off each member's own `addresses`
// rather than computed again here.
function DnsAddressesTable() {
  const { data } = useDnsStatus();
  const members = (data && data.members) || [];
  const names = (data && data.names) || [];

  const byAddress = new Map();
  for (const m of members) {
    for (const addr of m.addresses || []) {
      if (!byAddress.has(addr)) byAddress.set(addr, { address: addr, host: m.host || null, members: [] });
      byAddress.get(addr).members.push(m.member);
    }
  }
  const rows = [...byAddress.values()].map((row) => ({
    ...row,
    servers: names.filter((n) => n.kind === "game" && row.members.includes(n.member)).length,
  }));

  return (
    <CardTable icon="wifi" title="Public addresses" count={rows.length}
      pin={<PinButton type="dns.addresses" params={{}} label="Public addresses" />}
      columns={[
        {
          key: "address", label: "Address", width: "150px",
          render: (r) => (
            <NameCell name={r.address}
              sub={r.members[0] + (r.members.length > 1 ? " +" + (r.members.length - 1) + " more" : "")} />
          ),
        },
        { key: "host", label: "Host", width: "minmax(0,1.2fr)", render: (r) => <span className="mono dim">{r.host || "—"}</span> },
        {
          key: "members", label: "Members behind it", width: "minmax(0,2.4fr)",
          render: (r) => (r.members.length
            ? <><b>{r.members[0]}</b>{r.members.length > 1 && <span className="dim"> · {r.members.slice(1).join(" · ")}</span>}</>
            : "—"),
        },
        { key: "servers", label: "Servers", align: "right", width: "90px" },
      ]}
      rows={rows}
      getKey={(r) => r.address}
      empty="No public addresses reported"
      className="dns-table dns-table--addresses"
    />
  );
}

function DnsNames() {
  const { data } = useDnsStatus();
  const [filter, setFilter] = React.useState("all");

  const names = (data && data.names) || [];
  const nodeCount = names.filter((n) => n.kind === "member").length;
  const anchorCount = names.filter((n) => n.kind === "capability").length;
  const serverCount = names.filter((n) => n.kind === "game" || n.kind === "alias").length;
  const blockedCount = names.filter((n) => n.state === "blocked").length;

  // A kind chip narrows to its own table; "Blocked" cuts across all three instead of narrowing to
  // one kind, since a block can happen to any of them.
  const showNodes = filter === "all" || filter === "nodes" || filter === "blocked";
  const showAnchors = filter === "all" || filter === "anchors" || filter === "blocked";
  const showServers = filter === "all" || filter === "servers" || filter === "blocked";
  const onlyBlocked = filter === "blocked";

  return (
    <>
      <div className="players-toolbar" style={{ flexWrap: "wrap" }}>
        <button className={"filter-chip" + (filter === "all" ? " filter-chip--on" : "")} onClick={() => setFilter("all")}>
          All · {names.length}
        </button>
        <button className={"filter-chip" + (filter === "nodes" ? " filter-chip--on" : "")} onClick={() => setFilter("nodes")}>
          Nodes · {nodeCount}
        </button>
        <button className={"filter-chip" + (filter === "anchors" ? " filter-chip--on" : "")} onClick={() => setFilter("anchors")}>
          Anchors · {anchorCount}
        </button>
        <button className={"filter-chip" + (filter === "servers" ? " filter-chip--on" : "")} onClick={() => setFilter("servers")}>
          Servers · {serverCount}
        </button>
        <button className={"filter-chip" + (filter === "blocked" ? " filter-chip--on" : "")} onClick={() => setFilter("blocked")}>
          Blocked · {blockedCount}
        </button>
      </div>

      {showNodes && <DnsNodesTable onlyBlocked={onlyBlocked} />}
      {showAnchors && <DnsAnchorsTable onlyBlocked={onlyBlocked} />}
      {showServers && <DnsServersTable onlyBlocked={onlyBlocked} />}
      <DnsAddressesTable />
    </>
  );
}

export { DnsAddressesTable, DnsAnchorsTable, DnsNames, DnsNodesTable, DnsServersTable };

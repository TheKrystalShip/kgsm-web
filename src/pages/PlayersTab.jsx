import React from "react";
import { CardTable } from "../components/CardTable.jsx";
import { Icon } from "../components/Icon.jsx";

// PlayersTab — online + banned + allowlist for a single server, with kick/ban.
//
// Layout note: each row is a structured block whose pieces reflow between
// desktop (7-col grid) and mobile (vertical card with a full-width action
// button row at the bottom). Action buttons carry inline labels that are
// hidden on desktop via CSS and shown on mobile so touch users don't have
// to guess what each icon does.
//
// NOT WIRED YET: there is no roster source (live player-presence tracking is
// still in progress), so the tab renders a work-in-progress state. The full
// roster + moderation UI below is kept ready — flip ROSTER_WIRED to true and
// hydrate `all` from the roster endpoint when it lands.
const ROSTER_WIRED = false;

function pingClass(p) {
  if (p == null) return "";
  if (p < 40) return "player-ping--good";
  if (p < 80) return "player-ping--mid";
  return "player-ping--bad";
}

function fmtPlaytime(min) {
  if (min === 0) return "—";
  if (min < 60) return min + "m";
  const h = Math.floor(min / 60); const m = min % 60;
  return h + "h " + (m ? m + "m" : "");
}

function StatusPillSm({ p }) {
  if (p.status === "online")    return <span className="player-status-pill" data-tone="success">online</span>;
  if (p.status === "offline")   return <span className="player-status-pill" data-tone="muted">offline</span>;
  if (p.status === "banned")    return <span className="player-status-pill" data-tone="danger">banned{p.banned_at ? " · " + p.banned_at : ""}</span>;
  if (p.status === "allowlist") return <span className="player-status-pill" data-tone="brand">allowlist</span>;
  return null;
}

function ActionBtn({ icon, label, tone, onClick }) {
  return (
    <button className={"player-act" + (tone ? " player-act--" + tone : "")} onClick={onClick} title={label}>
      <Icon name={icon} size={14} strokeWidth={1.9} />
      <span className="player-act__label">{label}</span>
    </button>
  );
}

function PlayerActions({ p }) {
  if (p.status === "online") {
    return (
      <span className="player-actions">
        <ActionBtn icon="message-square" label="Message" />
        <ActionBtn icon="user-x"         label="Kick" />
        <ActionBtn icon="shield-off"     label="Ban" tone="danger" />
      </span>
    );
  }
  if (p.status === "banned") {
    return (
      <span className="player-actions">
        <ActionBtn icon="rotate-ccw" label="Unban" />
      </span>
    );
  }
  if (p.status === "allowlist") {
    return (
      <span className="player-actions">
        <ActionBtn icon="x" label="Remove" tone="danger" />
      </span>
    );
  }
  if (p.status === "offline") {
    return (
      <span className="player-actions">
        <ActionBtn icon="external-link" label="View profile" />
      </span>
    );
  }
  return null;
}

function PlayersTab({ server, readOnly }) {
  if (!ROSTER_WIRED) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="users" size={26} strokeWidth={1.6} />
        <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>Work in progress — not available yet</div>
        <div style={{ marginTop: 4, fontSize: 12.5 }}>Live player presence tracking is in progress — no roster source on this host yet.</div>
      </div>
    );
  }
  const all = [];   // TODO: hydrate from the roster endpoint when ROSTER_WIRED
  const [filter, setFilter] = React.useState("all");
  const counts = {
    all: all.length,
    online: all.filter(p => p.status === "online").length,
    banned: all.filter(p => p.status === "banned").length,
    allowlist: all.filter(p => p.status === "allowlist").length,
  };
  const filtered = filter === "all" ? all : all.filter(p => p.status === filter);

  // Column spec for the shared CardTable (the same component the host
  // diagnostics "Processes" panel uses). Each render() returns the cell node;
  // sort() makes a column orderable from its header. Reuses the existing player
  // cell styles (avatar, ping colour, status pill, hover-reveal actions).
  const PING_SINK = Number.MAX_SAFE_INTEGER; // offline players (null ping) sort last
  const playerColumns = [
    { key: "ping", label: "Ping", align: "center", width: "52px", defaultDir: "asc",
      sort: p => (p.ping == null ? PING_SINK : p.ping),
      render: p => (
        <span className={"player-ping " + pingClass(p.ping)}>{p.ping != null ? p.ping + "ms" : "—"}</span>
      ) },
    { key: "name", label: "Player", width: "minmax(0, 1.8fr)", sort: p => p.name,
      render: p => (
        <span className="players-cell-player">
          <span className="player-avatar">{p.name[0].toUpperCase()}</span>
          <span className="player-name">
            <span className="player-name__primary">{p.name}</span>
            <span className="player-name__role">{p.role}</span>
          </span>
        </span>
      ) },
    { key: "playtime", label: "Playtime", width: "minmax(72px, 1fr)", sort: p => p.playtime_min,
      render: p => <span className="player-meta-cell">{fmtPlaytime(p.playtime_min)}</span> },
    { key: "status", label: "Status", width: "minmax(100px, 1fr)", sort: p => p.status,
      render: p => <StatusPillSm p={p} /> },
    { key: "joined", label: "Joined", width: "minmax(84px, 1fr)",
      render: p => <span className="player-meta-cell">{p.joined}</span> },
    // Moderation actions (kick / ban / unban / allowlist) are operator-only —
    // a read-only viewer sees the roster without the action column.
    ...(readOnly ? [] : [{ key: "actions", label: "", width: "140px", align: "right",
      render: p => <PlayerActions p={p} /> }]),
  ];

  if (all.length === 0) {
    return (
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-lg)", padding: 60, textAlign: "center", color: "var(--fg-3)" }}>
        <Icon name="users" size={28} />
        <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No players yet</div>
        <div style={{ marginTop: 4, fontSize: 13 }}>Once your server is online and someone joins, they'll show up here.</div>
      </div>
    );
  }

  return (
    <>
      <div className="players-toolbar">
        <div className="range-tabs">
          <button className={filter === "all" ? "on" : ""}       onClick={() => setFilter("all")}>All · {counts.all}</button>
          <button className={filter === "online" ? "on" : ""}    onClick={() => setFilter("online")}>Online · {counts.online}</button>
          <button className={filter === "banned" ? "on" : ""}    onClick={() => setFilter("banned")}>Banned · {counts.banned}</button>
          <button className={filter === "allowlist" ? "on" : ""} onClick={() => setFilter("allowlist")}>Allowlist · {counts.allowlist}</button>
        </div>
        <span style={{ flex: 1 }}></span>
        <span className="summary"><b>{counts.online}</b> of {server.players.max} slots in use</span>
      </div>

      <CardTable
        columns={playerColumns}
        rows={filtered}
        getKey={(p, i) => p.name + i}
        empty="No players match this filter."
      />
    </>
  );
}

export { PlayersTab };

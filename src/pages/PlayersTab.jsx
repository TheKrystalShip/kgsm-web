import React from "react";
import { CardTable } from "../components/CardTable.jsx";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { api } from "../lib/apiClient.js";

// PlayersTab — the permanent player roster for one server, wired to
// player-presence-contract.md §5:
//
//   REST  GET /servers/{id}/players → { detection, players[] }
//   WS    topic "players" → { type:"players.join"|"players.leave"|"players.ban", data:{ serverId, player } }
//         or { type:"players.reset", data:{ serverId } }
//
// The history IS the roster — no separate "currently online" view. Every player
// who has ever connected appears here with a status indicator. Honest "unknown"
// when the API can't determine status (missed events during downtime).
//
// REST hydrates the full roster, then the WS topic follows live transitions —
// tail-then-follow, same ordering guarantee as ConsolePanel's useLiveConsole.
//
// Status vocabulary: "online" | "offline" | "banned" | "unknown"

// Prefer the player's name; fall back to their address, then the player identity.
function playerLabel(p) {
  return (p && (p.playerName || p.playerAddr || p.playerIdentity)) || "Unknown player";
}

// A secondary identifier line: whichever of addr/id are present and not already
// shown as the label.
function playerSecondary(p) {
  if (!p) return "";
  const label = playerLabel(p);
  const bits = [];
  if (p.playerAddr && p.playerAddr !== label) bits.push(p.playerAddr);
  if (p.playerId && p.playerId !== label && p.playerId !== p.playerAddr) bits.push(p.playerId);
  return bits.join(" · ");
}

// Relative + absolute time formatting.
function fmtTime(iso) {
  if (!iso) return { rel: "—", abs: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { rel: "—", abs: "" };
  const diffS = Math.max(0, (Date.now() - d.getTime()) / 1000);
  const rel = diffS < 60 ? Math.floor(diffS) + "s ago"
    : diffS < 3600 ? Math.floor(diffS / 60) + "m ago"
    : diffS < 86400 ? Math.floor(diffS / 3600) + "h ago"
    : Math.floor(diffS / 86400) + "d ago";
  return { rel, abs: d.toLocaleString() };
}

// Status indicator — colored dot with tooltip.
function StatusDot({ status }) {
  const colors = {
    online: "var(--krystal-teal)",
    unknown: "var(--fg-3)",
    offline: "var(--fg-4)",
    banned: "var(--krystal-red)",
  };
  const labels = {
    online: "Online",
    unknown: "Unknown",
    offline: "Offline",
    banned: "Banned",
  };
  const color = colors[status] || colors.unknown;
  const label = labels[status] || "Unknown";
  return (
    <span className="player-status" title={label}>
      <span className="player-status__dot" style={{ background: color }} />
      <span className="player-status__label">{label}</span>
    </span>
  );
}

// Pure join/leave/reset/ban reducer over a Map keyed by playerIdentity.
// Join/ban: upsert (never delete). Leave: update status to offline (never delete).
// Reset: mark all players for that server as offline.
function applyPlayerFrame(roster, type, player, serverId) {
  if (type === "players.reset") {
    // Mark all players for this server as offline.
    const next = new Map(roster);
    for (const [key, p] of next) {
      if (p._serverId === serverId) {
        next.set(key, { ...p, status: "offline" });
      }
    }
    return next;
  }
  if (!player || !player.playerIdentity) return roster;
  const next = new Map(roster);
  if (type === "players.join" || type === "players.leave" || type === "players.ban") {
    // Upsert with the status from the frame.
    next.set(player.playerIdentity, { ...player, _serverId: serverId });
  }
  return next;
}

// Live roster hook: REST hydrate then WS follow. Returns one of:
//   { status: "loading" }
//   { status: "error", error }
//   { status: "ready", detection, players: [Player] }
function usePlayerRoster(server) {
  const [state, setState] = React.useState({ status: "loading" });
  React.useEffect(() => {
    if (!server) return;
    setState({ status: "loading" });
    let alive = true, hydrated = false, broken = false, detection = "unknown";
    let roster = new Map();     // playerIdentity -> player row
    const buffered = [];
    const client = (server.hostId && api.host) ? api.host(server.hostId) : api;

    const flush = () => { if (alive) setState({ status: "ready", detection, players: [...roster.values()] }); };

    // Subscribe FIRST so frames during the REST round-trip are buffered.
    const dispose = api.stream.subscribe(["players"], (m) => {
      if (!alive || broken || !m || !m.data || m.data.serverId !== server.id) return;
      if (m.type !== "players.join" && m.type !== "players.leave" && m.type !== "players.reset" && m.type !== "players.ban") return;
      if (hydrated) { roster = applyPlayerFrame(roster, m.type, m.data.player, m.data.serverId); flush(); }
      else buffered.push([m.type, m.data.player, m.data.serverId]);
    });

    client.get("/servers/" + server.id + "/players").then(
      (res) => {
        detection = (res && res.detection) || "unknown";
        ((res && res.players) || []).forEach((p) => {
          if (p && p.playerIdentity) roster.set(p.playerIdentity, { ...p, _serverId: server.id });
        });
        buffered.forEach(([type, player, serverId]) => { roster = applyPlayerFrame(roster, type, player, serverId); });
        hydrated = true;
        flush();
      },
      (err) => { broken = true; hydrated = true; if (alive) setState({ status: "error", error: err }); }
    );
    return () => { alive = false; dispose(); };
  }, [server && server.id, server && server.hostId]);
  return state;
}

function PlayersEmpty({ icon, title, sub }) {
  return (
    <div className="chat-brief__empty chat-brief__empty--neutral">
      <Icon name={icon} size={20} />
      <span className="chat-brief__empty-title">{title}</span>
      <span className="chat-brief__empty-sub">{sub}</span>
    </div>
  );
}

function PlayersTab({ server, readOnly }) {
  const state = usePlayerRoster(server);

  if (state.status === "loading") {
    return (
      <BriefCard icon="users" title="Players">
        <PlayersEmpty icon="loader-2" title="Loading roster…" sub="Fetching the player roster." />
      </BriefCard>
    );
  }

  if (state.status === "error") {
    return (
      <BriefCard icon="users" title="Players">
        <PlayersEmpty icon="alert-triangle" title="Couldn't load the roster"
          sub={(state.error && (state.error.userMessage || state.error.message)) || "An error occurred."} />
      </BriefCard>
    );
  }

  if (state.detection === "unknown") {
    return (
      <BriefCard icon="users" title="Players">
        <PlayersEmpty icon="circle-help" title="Presence not available for this game"
          sub="This game has no join/leave detection configured yet, so who's played can't be tracked here." />
      </BriefCard>
    );
  }

  const { players } = state;
  if (players.length === 0) {
    return (
      <BriefCard icon="users" title="Players">
        <PlayersEmpty icon="users" title="No players yet"
          sub="Once someone connects, they'll show up here permanently." />
      </BriefCard>
    );
  }

  const columns = [
    { key: "player", label: "Player", width: "minmax(0, 2fr)", defaultDir: "asc",
      sort: (p) => playerLabel(p).toLowerCase(),
      render: (p) => (
        <span className="players-cell-player">
          <span className="player-avatar">{playerLabel(p)[0].toUpperCase()}</span>
          <span className="player-name">
            <span className="player-name__primary">{playerLabel(p)}</span>
            {playerSecondary(p) && <span className="player-name__role">{playerSecondary(p)}</span>}
          </span>
        </span>
      ) },
    { key: "status", label: "Status", width: "minmax(80px, 1fr)",
      sort: (p) => { const order = { online: 0, unknown: 1, offline: 2, banned: 3 }; return order[p.status] ?? 4; },
      render: (p) => <StatusDot status={p.status} /> },
    { key: "firstSeen", label: "First seen", width: "minmax(96px, 1fr)", align: "right", defaultDir: "desc",
      sort: (p) => p.firstSeen || "",
      render: (p) => {
        const { rel, abs } = fmtTime(p.firstSeen);
        return <span className="player-meta-cell" title={abs}>{rel}</span>;
      } },
    { key: "lastSeen", label: "Last seen", width: "minmax(96px, 1fr)", align: "right", defaultDir: "desc",
      sort: (p) => p.lastSeen || "",
      render: (p) => {
        const { rel, abs } = fmtTime(p.lastSeen);
        return <span className="player-meta-cell" title={abs}>{rel}</span>;
      } },
  ];

  return (
    <CardTable icon="users" title="Players" count={players.length}
      columns={columns} rows={players} getKey={(p) => p.playerIdentity}
      defaultSort={{ key: "status", dir: "asc" }} empty="No players match." />
  );
}

export { PlayersTab, playerLabel, playerSecondary, applyPlayerFrame };

import React from "react";
import { CardTable } from "../components/CardTable.jsx";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { api } from "../lib/apiClient.js";

// PlayersTab — the live presence roster for one server, wired to the FROZEN
// contract in player-presence-contract.md §5:
//
//   REST  GET /servers/{id}/players → { detection: "configured"|"unknown", players:[…] }
//   WS    topic "players" → { type:"players.join"|"players.leave", data:{ serverId, player } }
//         or { type:"players.reset", data:{ serverId } } — the api clears its own
//         roster on instance stop/start/restart (a killed process emits no "left"
//         lines); this frame tells an already-open tab to drop its stale rows too
//         (no REST refetch needed — the roster is empty right after reset, and
//         rejoins flow back in as ordinary players.join frames).
//
// REST hydrates the roster, then the WS topic follows live join/leave/reset —
// tail-then-follow, same ordering guarantee as ConsolePanel's useLiveConsole:
// subscribe FIRST and buffer any frame that lands during the REST round-trip, so
// it can't be lost or double-applied once the tail resolves.
//
// HONESTY (the whole point of this tab): `detection: "unknown"` means the instance
// has no join/leave log pattern configured for its game — presence is UNKNOWABLE
// there, so the tab says so explicitly and never renders "0 players online" (a
// configured-but-genuinely-empty roster is a different, real fact). A row's
// `name` / `id` / `addr` are each independently nullable — a native log line
// doesn't always carry all three — so the label falls back name → addr →
// sessionKey and never renders blank or invented text.
//
// v1 has no moderation actions (kick/ban is deferred — contract §6), so this is a
// read-only roster; `readOnly` has nothing to gate yet but is accepted for API
// stability with both App.jsx call sites (mobile overview vs. the operator band).

// Prefer the player's name; fall back to their address, then the session key —
// in that order, so the row NEVER renders blank even when a native log line only
// carried one identifier.
function playerLabel(p) {
  return (p && (p.name || p.addr || p.sessionKey)) || "Unknown player";
}

// A secondary identifier line: whichever of addr/id are present and not already
// shown as the label (addr first — an IP is the most immediately useful "who is
// this" when the name is missing; id second, e.g. a persistent platform id).
function playerSecondary(p) {
  if (!p) return "";
  const label = playerLabel(p);
  const bits = [];
  if (p.addr && p.addr !== label) bits.push(p.addr);
  if (p.id && p.id !== label && p.id !== p.addr) bits.push(p.id);
  return bits.join(" · ");
}

// Relative + absolute "connected since". No shared time-formatting util exists in
// this codebase (AuditLogPage/DiagnosticsPage each keep their own page-local
// helper) — this mirrors that convention rather than introducing a new one.
function fmtSince(iso) {
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

// Pure join/leave/reset reducer over a Map keyed by sessionKey — exported so the
// join/upsert/dedup/evict/clear semantics can be asserted deterministically
// (smoke), without depending on a live roster endpoint. A repeated join for the
// same sessionKey just replaces the row (dedups a doubled watchdog join line); a
// leave for a sessionKey not currently on the roster is a no-op, never a throw.
// A reset (the api clearing its roster on stop/start/restart) always returns an
// EMPTY roster, regardless of `player` — there's no per-player payload for it.
function applyPlayerFrame(roster, type, player) {
  if (type === "players.reset") return new Map();
  if (!player || !player.sessionKey) return roster;
  const next = new Map(roster);
  if (type === "players.join") next.set(player.sessionKey, player);
  else if (type === "players.leave") next.delete(player.sessionKey);
  return next;
}

// Live roster hook: REST hydrate then WS follow. Returns one of:
//   { status: "loading" }
//   { status: "error", error }
//   { status: "ready", detection, players: [Player] }
// A REST failure has no honest baseline to reconcile live deltas against (unlike a
// console tail, a missing roster snapshot can't be safely patched by join/leave
// alone), so once broken, later WS frames for this server are ignored until the
// tab remounts — never silently promoted into a partial, fabricated-looking roster.
function usePlayerRoster(server) {
  const [state, setState] = React.useState({ status: "loading" });
  React.useEffect(() => {
    if (!server) return;
    setState({ status: "loading" });
    let alive = true, hydrated = false, broken = false, detection = "unknown";
    let roster = new Map();     // sessionKey -> player row
    const buffered = [];        // WS frames landing before the REST tail resolves
    const client = (server.hostId && api.host) ? api.host(server.hostId) : api;

    const flush = () => { if (alive) setState({ status: "ready", detection, players: [...roster.values()] }); };

    // Subscribe FIRST so a join/leave/reset emitted during the REST round-trip is
    // buffered, not lost; re-idles the backend's players pump on unmount.
    const dispose = api.stream.subscribe(["players"], (m) => {
      if (!alive || broken || !m || !m.data || m.data.serverId !== server.id) return;
      if (m.type !== "players.join" && m.type !== "players.leave" && m.type !== "players.reset") return;
      if (hydrated) { roster = applyPlayerFrame(roster, m.type, m.data.player); flush(); }
      else buffered.push([m.type, m.data.player]);
    });

    client.get("/servers/" + server.id + "/players").then(
      (res) => {
        detection = (res && res.detection) || "unknown";
        ((res && res.players) || []).forEach((p) => { if (p && p.sessionKey) roster.set(p.sessionKey, p); });
        buffered.forEach(([type, player]) => { roster = applyPlayerFrame(roster, type, player); });
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
        <PlayersEmpty icon="loader-2" title="Loading roster…" sub="Fetching who's currently connected." />
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
          sub="This game has no join/leave detection configured yet, so who's online can't be measured here." />
      </BriefCard>
    );
  }

  const { players } = state;
  if (players.length === 0) {
    return (
      <BriefCard icon="users" title="Players">
        <PlayersEmpty icon="users" title="No players online"
          sub="Once someone joins, they'll show up here." />
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
    { key: "since", label: "Connected", width: "minmax(96px, 1fr)", align: "right", defaultDir: "asc",
      sort: (p) => p.since || "",
      render: (p) => {
        const { rel, abs } = fmtSince(p.since);
        return <span className="player-meta-cell" title={abs}>{rel}</span>;
      } },
  ];

  return (
    <CardTable icon="users" title="Players" count={players.length}
      columns={columns} rows={players} getKey={(p) => p.sessionKey}
      defaultSort={{ key: "since", dir: "asc" }} empty="No players match." />
  );
}

export { PlayersTab, playerLabel, playerSecondary, applyPlayerFrame };

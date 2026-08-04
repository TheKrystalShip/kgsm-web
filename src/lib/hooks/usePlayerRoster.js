import React from "react";
import { api } from "../apiClient.js";

export function applyPlayerFrame(roster, type, player, serverId) {
  if (type === "players.reset") {
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
    next.set(player.playerIdentity, { ...player, _serverId: serverId });
  }
  return next;
}

export function usePlayerRoster(server) {
  const [state, setState] = React.useState({ status: "loading" });
  React.useEffect(() => {
    if (!server) return;
    if (!server.hostId) return;
    setState({ status: "loading" });
    let alive = true, hydrated = false, broken = false, detection = "unknown";
    // What the game can be asked to do, as the backend reports it. Defaults to
    // "nothing" so a backend that has not shipped the field yet renders no
    // moderation controls, rather than buttons that would 409 on click.
    let moderation = { kick: false, ban: false, unban: false, targetKind: null };
    let roster = new Map();
    const buffered = [];

    const flush = () => {
      if (alive) setState({ status: "ready", detection, moderation, players: [...roster.values()] });
    };

    const dispose = api.stream.subscribe(["players"], (m) => {
      if (!alive || broken || !m || !m.data || m.data.serverId !== server.id) return;
      if (m.type !== "players.join" && m.type !== "players.leave" && m.type !== "players.reset" && m.type !== "players.ban") return;
      if (hydrated) { roster = applyPlayerFrame(roster, m.type, m.data.player, m.data.serverId); flush(); }
      else buffered.push([m.type, m.data.player, m.data.serverId]);
    });

    api.host(server.hostId).get("/servers/" + server.id + "/players").then(
      (res) => {
        detection = (res && res.detection) || "unknown";
        if (res && res.moderation) moderation = res.moderation;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server && server.id, server && server.hostId]);
  return state;
}

import React from "react";
import { serverMetricsFreshness } from "./HostCardBody.jsx";
import { Icon } from "./Icon.jsx";
import { ServerActionButton } from "./ServerActions.jsx";
import { ServerConnect } from "./ServerConnect.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { serverOperable } from "../lib/persona.js";
import { favoritesStore, hostsStore, serversStore, useIsFavorite } from "../lib/stores.js";
import { artBg } from "../lib/art.js";

// ServerCard — the reusable game-server tile (art header, live metrics,
// quick start/restart/stop). Shared by the Dashboard (online
// servers only) and the dedicated Servers page (all servers, filterable), so
// a card looks and behaves identically wherever it appears.

const INSTALL_PHASE_LABEL = {
  preparing:   "Preparing…",
  downloading: "Downloading…",
  deploying:   "Deploying…",
};

function ServerPhantomTile({ server }) {
  const art = artBg(server.hero, server.cover);
  const isFailed = server.status === "install-failed";
  const phaseText = isFailed ? "Failed"
    : (INSTALL_PHASE_LABEL[server.job?.phase]
        || (server.job?.state === "queued" ? "Queued…" : "Installing…"));

  return (
    <div className="server-tile server-tile--phantom">
      <div className="server-tile__art" style={{ backgroundImage: art, backgroundSize: "cover", backgroundPosition: "center" }}>
        <span className="server-tile__game">{server.blueprint || server.game}</span>
      </div>
      <div className="server-tile__body">
        <div className="server-tile__head">
          <div className="server-tile__name">{server.name}</div>
          <span className={"server-tile__pill server-tile__pill--" + (isFailed ? "install-failed" : "installing")}>
            <span className="dot"></span>
            {phaseText}
          </span>
        </div>
        {!isFailed && <div className="server-tile__progress" />}
        {isFailed && (
          <button
            type="button"
            className="server-tile__dismiss"
            onClick={() => serversStore.remove(server.id)}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function ServerTile({ server, onOpen, onAction, showHost }) {
  if (server._phantom) return <ServerPhantomTile server={server} />;
  // kgsm-api serves cover/hero directly (the old client-side RAWG hook is gone).
  // Prefers landscape hero, then portrait cover, then themed gradient placeholder.
  const art = artBg(server.hero, server.cover);
  const host = showHost && hostsStore ? hostsStore.find(server.hostId) : null;
  // Pin state (client-local). The star both reads and writes the favorites
  // store; toggling it mirrors the card into the pinned Favorites section on the
  // Servers page without moving it out of its host group.
  const isFav = useIsFavorite ? useIsFavorite(server.id) : false;

  const isOnline = server.status === "online";
  const isUpdating = server.status === "updating";
  const pendingVerb = server.job && server.job.state === "running" ? server.job.verb : null;
  // Live CPU/RAM are host-metrics — when the host's metrics feed is down they
  // go dark with a red status LED, matching the host diagnostics treatment.
  // Only meaningful while the server is online (offline servers report nothing).
  const mFresh = serverMetricsFreshness ? serverMetricsFreshness(server) : null;
  const metricsOff = !!(mFresh && mFresh.frozen) && isOnline;
  // Lifecycle actions are watchdog-mediated — lock the quick row when down.
  const watchdogDown = serverCapUsable ? !serverCapUsable(server, "watchdog") : false;
  // Players (viewer / consumer preview) can't operate this host — the quick
  // lifecycle row is replaced with a Join / connect button instead.
  const canOps = serverOperable ? serverOperable(server) : true;
  // Open-on-click is scoped to the art, name and notice regions only — NOT the
  // whole tile. The quick-action buttons and the Join control live in the body
  // right next to those regions; making the whole tile clickable used to swallow
  // their clicks, so nothing above the buttons carries an open handler anymore.
  const open = () => onOpen(server.id);
  return (
    <div className="server-tile">
      <div className="server-tile__art" onClick={open} style={{ backgroundImage: art, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="server-tile__corner">
          {host && <span className="server-tile__host"><Icon name="server" size={10} strokeWidth={2.2} />{host.name}</span>}
          {favoritesStore && (
            <button
              type="button"
              className={"server-tile__fav" + (isFav ? " is-on" : "")}
              onClick={(e) => { e.stopPropagation(); favoritesStore.toggle(server.id); }}
              aria-pressed={isFav}
              title={isFav ? "Remove from favorites" : "Add to favorites"}>
              <Icon name="star" size={14} strokeWidth={2.2} />
            </button>
          )}
        </div>
        <span className="server-tile__game">{server.game}</span>
      </div>
      <div className="server-tile__body">
        <div className="server-tile__head">
          <div className="server-tile__name" onClick={open}>{server.name}</div>
          <span className={"server-tile__pill " + (watchdogDown ? "server-tile__pill--unknown" : "server-tile__pill--" + server.status)}
            title={watchdogDown ? "Watchdog down — server state can’t be confirmed" : undefined}>
            <span className="dot"></span>
            {watchdogDown ? "unknown" : server.status}
          </span>
        </div>
        {server.notice
          ? <div className="server-tile__notice" onClick={open}>{server.notice}</div>
          : <div className="server-tile__notice server-tile__notice--empty" onClick={open}>No server note</div>}
        <div className="server-tile__meta">
          <span><Icon name="users" size={11} /> {server.players ? server.players.current + "/" + server.players.max : "—"}</span>
          <span className={"server-tile__metric" + (metricsOff ? " server-tile__metric--off" : "")}><Icon name="cpu" size={11} /> {server.cpu == null ? "—" : server.cpu + "%"}</span>
          <span className={"server-tile__metric" + (metricsOff ? " server-tile__metric--off" : "")}><Icon name="hard-drive" size={11} /> {server.ram ? (server.ram.used + (server.ram.max != null ? "/" + server.ram.max : "") + " GB") : "—"}</span>
          {metricsOff && (
            <span className="server-tile__metric-led" title={"Live metrics unavailable" + (mFresh.label ? " · " + mFresh.label : "")}>
              <span className="status-led status-led--down"></span>
            </span>
          )}
        </div>
        {canOps && (
          <div className="server-tile__quick">
            <ServerActionButton verb="start"   disabled={isOnline || isUpdating || watchdogDown} reason={watchdogDown ? "Watchdog unavailable" : null} pendingVerb={pendingVerb} onRun={(v) => onAction(server.id, v)} />
            <ServerActionButton verb="restart" disabled={!isOnline || watchdogDown}              reason={watchdogDown ? "Watchdog unavailable" : null} pendingVerb={pendingVerb} onRun={(v) => onAction(server.id, v)} />
            <ServerActionButton verb="stop"    disabled={!isOnline || watchdogDown}              reason={watchdogDown ? "Watchdog unavailable" : null} pendingVerb={pendingVerb} onRun={(v) => onAction(server.id, v)} />
          </div>
        )}
        {/* Join / connect — shown to everyone (operators play too), below their
            lifecycle controls. */}
        {ServerConnect && (
          <div className="server-tile__connect">
            <ServerConnect server={server} variant="tile" />
          </div>
        )}
      </div>
    </div>
  );
}

export { ServerTile };

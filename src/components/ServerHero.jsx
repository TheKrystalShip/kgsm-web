import React from "react";
import { Icon } from "./Icon.jsx";
import { ServerActionButton } from "./ServerActions.jsx";
import { ServerConnect } from "./ServerConnect.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { serverOperable } from "../lib/persona.js";

// Server hero card — top status, name, action chips, IP.

function StatusPill({ status, uptime, watchdogDown }) {
  // The watchdog reports a server's liveness; with it down we can't confirm the
  // status (or trust the uptime), so the pill reads "unknown".
  if (watchdogDown) {
    return (
      <span className="hero__status hero__status--unknown" title="Watchdog down — server state can’t be confirmed">
        <span className="dot"></span>
        status unknown
      </span>
    );
  }
  const cls = {
    online: "hero__status",
    offline: "hero__status hero__status--offline",
    updating: "hero__status hero__status--updating",
    crashed: "hero__status hero__status--offline",
  }[status] || "hero__status";
  return (
    <span className={cls}>
      <span className="dot"></span>
      {status}
      {uptime && uptime !== "—" && <span className="timer">{uptime}</span>}
    </span>
  );
}

function ServerHero({ server, onAction }) {
  const isOnline = server.status === "online";
  const isUpdating = server.status === "updating";
  // Can the signed-in user operate this server's host? Players (viewer / consumer
  // preview) get the Join + connect surface only — no lifecycle controls, no rename.
  const canOps = serverOperable ? serverOperable(server) : true;
  const pendingVerb = server.job && server.job.state === "running" ? server.job.verb : null;
  // Lifecycle actions are watchdog-mediated — when the host's watchdog is down
  // the supervisor can't start/stop/restart/update, so the chips lock out.
  const watchdogDown = serverCapUsable ? !serverCapUsable(server, "watchdog") : false;
  const wdReason = "Watchdog unavailable on this host — lifecycle actions are paused";
  const cover = (window.useRawgCover && server.rawg_slug) ? window.useRawgCover(server) : null;
  const artBg = cover
    ? `linear-gradient(135deg, rgba(11,15,20,0.4) 0%, transparent 60%), url("${cover}")`
    : server.art;
  return (
    <section className="hero">
      <div className="hero__art" style={{ background: artBg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
      <div className="hero__veil"></div>
      <div className="hero__content">
        <StatusPill status={server.status} uptime={server.uptime} watchdogDown={watchdogDown} />
        <h1 className="hero__name">
          {server.name}
          {canOps && <button className="hero__edit" aria-label="Rename"><Icon name="pencil" size={16} /></button>}
        </h1>
        {/* Runtime is honest backend metadata (native vs container) — surface it
            as a small tag. Absent in mock fixtures → renders nothing there. */}
        {server.runtime && (
          <div className="hero__tags">
            <span className="hero__tag" title="Supervision type">
              <Icon name={server.runtime === "container" ? "box" : "cpu"} size={12} strokeWidth={2} /> {server.runtime}
            </span>
          </div>
        )}
        {canOps && (
          <div className="action-row">
            <ServerActionButton verb="start"   variant="chip" disabled={isOnline || isUpdating || watchdogDown} reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
            <ServerActionButton verb="update"  variant="chip" disabled={isUpdating || watchdogDown}             reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
            <ServerActionButton verb="stop"    variant="chip" disabled={!isOnline || watchdogDown}              reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
            <ServerActionButton verb="restart" variant="chip" disabled={!isOnline || watchdogDown}              reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
          </div>
        )}
        {canOps && watchdogDown && (
          <div className="hero__watchdog-note">
            <Icon name="power-off" size={13} /> Watchdog unavailable — start, stop, restart and update are paused on this host.
          </div>
        )}
        {ServerConnect
          ? <ServerConnect server={server} variant="hero" />
          : (
            <div className="hero__ip">
              {server.ip}
              <button title="Copy"><Icon name="copy" size={14} /></button>
            </div>
          )}
      </div>
    </section>
  );
}

export { ServerHero };

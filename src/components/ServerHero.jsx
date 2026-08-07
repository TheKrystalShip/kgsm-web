import { Icon } from "./Icon.jsx";
import { ServerActionButton } from "./ServerActions.jsx";
import { ServerConnect } from "./ServerConnect.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { serverOperable } from "../lib/persona.js";
import { artBg } from "../lib/art.js";

// Server hero card — top status, name, action chips, IP.

// Nice labels for statuses whose raw backend word wouldn't read well verbatim.
// Everything else (online/offline/unknown/crashed) falls back to the raw
// lowercase status, matching how this pill already renders those.
const HERO_STATUS_LABEL = { starting: "Starting", updating: "Updating…", stopping: "Stopping…", restarting: "Restarting…" };

function StatusPill({ status, uptime, watchdogDown }) {
  // --glass swaps the pill's fill for the frosted dark backing so it stays legible
  // over the full-bleed key-art (the tone colour stays in the text + dot).
  // The watchdog reports a server's liveness; with it down we can't confirm the
  // status (or trust the uptime), so the pill reads "unknown".
  if (watchdogDown) {
    return (
      <span className="hero__status hero__status--unknown hero__status--glass" title="Watchdog down — server state can’t be confirmed">
        <span className="dot"></span>
        status unknown
      </span>
    );
  }
  const cls = {
    online: "hero__status",
    offline: "hero__status hero__status--offline",
    updating: "hero__status hero__status--updating",
    // On its way down — the process is still up, so this is deliberately NOT the offline tone.
    stopping: "hero__status hero__status--stopping",
    // Down and coming back — in transition like the two above, neither online nor offline.
    restarting: "hero__status hero__status--restarting",
    crashed: "hero__status hero__status--offline",
    // Launched, not yet joinable — the backend flips this to "running" once the
    // game finishes booting (server.patch, same SSE frame as every other status).
    starting: "hero__status hero__status--starting",
  }[status] || "hero__status";
  return (
    <span className={cls + " hero__status--glass"}>
      <span className="dot"></span>
      {HERO_STATUS_LABEL[status] || status}
      {uptime && uptime !== "—" && <span className="timer">{uptime}</span>}
    </span>
  );
}

function ServerHero({ server, onAction }) {
  const isOnline = server.status === "online";
  const isUpdating = server.status === "updating";
  // Launched but not yet joinable (between launch and the game finishing boot) —
  // treat it as busy like isUpdating: Start stays disabled, but Stop is allowed
  // (a booting server can still be shut down). Restart stays online-only — it
  // makes no sense to "restart" something that hasn't finished starting.
  const isStarting = server.status === "starting";
  // Shutting down — the process is still up but on its way out, so every lifecycle chip stays shut:
  // there is nothing to start yet, nothing left to stop, and nothing to restart until it lands.
  const isStopping = server.status === "stopping";
  // Bouncing — for the whole of it there is nothing to start, stop or restart again.
  const isRestarting = server.status === "restarting";
  // Can the signed-in user operate this server's host? Players (viewer / consumer
  // preview) get the Join + connect surface only — no lifecycle controls, no rename.
  const canOps = serverOperable(server);
  const pendingVerb = server.job && server.job.state === "running" ? server.job.verb : null;
  // Lifecycle actions are watchdog-mediated — when the host's watchdog is down
  // the supervisor can't start/stop/restart/update, so the chips lock out.
  const watchdogDown = !serverCapUsable(server, "watchdog");
  const wdReason = "Watchdog unavailable on this host — lifecycle actions are paused";
  // The Update chip lights up only when the update-check probe found a newer version
  // (server.update_available is a truthy target-version string). kgsm refuses to update
  // a RUNNING instance (the files are in use) and kgsm-api's CommandGate 409s that
  // synchronously — pre-disable here too so the constraint is visible before the click,
  // mirroring the Stop chip's pattern. The two-step confirm (confirm: true on the verb)
  // still arms on first click → "Confirm?" → fires on the second, so a lit chip needs two
  // deliberate presses; no accidental update.
  const hasUpdate = !!server.update_available;
  const updateUnavailable = !hasUpdate || isOnline || isStarting || isStopping || isRestarting;
  let updReason;
  if (!hasUpdate) updReason = server.update_checked_at ? "On the latest build" : "Checking for updates…";
  else if (isStopping) updReason = "Waiting for the server to finish shutting down";
  else if (isRestarting) updReason = "Waiting for the server to finish restarting";
  else if (isOnline || isStarting) updReason = "Server must be stopped before updating";
  // The cinematic background prefers the LANDSCAPE banner (`hero` = RAWG
  // background_image_additional), then falls back to the 2:3 portrait `cover`,
  // then to a themed gradient placeholder when neither is available.
  const bg = artBg(server.hero, server.cover);
  return (
    <section className="hero hero--cinematic">
      <div className="hero__art" style={{ backgroundImage: bg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
      <div className="hero__scrim"></div>
      <div className="hero__statuspos">
        <StatusPill status={server.status} uptime={server.uptime} watchdogDown={watchdogDown} />
      </div>
      <div className="hero__body">
        <div className="hero__heading">
          <h1 className="hero__name">
            {server.name}
            {canOps && <button className="hero__edit" aria-label="Rename"><Icon name="pencil" size={16} /></button>}
          </h1>
          {/* Runtime is honest backend metadata (native vs container) — surface it
              as a small glass tag beside the name. Absent → renders nothing. */}
          {server.runtime && (
            <span className="hero__tag hero__tag--glass" title="Supervision type">
              <Icon name={server.runtime === "container" ? "box" : "cpu"} size={12} strokeWidth={2} /> {server.runtime}
            </span>
          )}
        </div>
        {/* Frosted control bar: lifecycle actions (operators) on the left, a
            divider, then the connect/Join group on the right. Players see only
            the connect group. */}
        <div className="hero__bar">
          {canOps && (
            <>
              <div className="hero__group">
                <ServerActionButton verb="start"   variant="glass" disabled={isOnline || isUpdating || isStarting || isStopping || isRestarting || watchdogDown} reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
                <ServerActionButton verb="update"  variant="glass" disabled={isUpdating || watchdogDown || updateUnavailable} reason={watchdogDown ? wdReason : (updateUnavailable ? updReason : null)} pendingVerb={pendingVerb} onRun={onAction} />
                <ServerActionButton verb="stop"    variant="glass" disabled={!(isOnline || isStarting) || isRestarting || watchdogDown} reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
                <ServerActionButton verb="restart" variant="glass" disabled={!isOnline || isRestarting || watchdogDown}              reason={watchdogDown ? wdReason : null} pendingVerb={pendingVerb} onRun={onAction} />
              </div>
              <span className="hero__bardiv" aria-hidden="true"></span>
            </>
          )}
          <div className="hero__group hero__group--connect">
            <ServerConnect server={server} variant="hero-bar" />
          </div>
        </div>
        {canOps && watchdogDown && (
          <div className="hero__watchdog-note">
            <Icon name="power-off" size={13} /> Watchdog unavailable — start, stop, restart and update are paused on this host.
          </div>
        )}
      </div>
    </section>
  );
}

export { ServerHero };

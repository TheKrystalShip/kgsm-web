import React from "react";
import { Icon } from "./Icon.jsx";
import { api, connectionStore, realtimeStore } from "../lib/apiClient.js";
import { can } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";

// ErrorBoundary.jsx — the resilience layer.
//
// Cooperating pieces, by failure mode:
//   1. ErrorBoundary (class)  — catches SYNCHRONOUS render/lifecycle crashes.
//                               App-level = last resort; content-level = keeps
//                               the shell alive while one page recovers.
//   2. ConnectivityBanner     — the single connection-status slot, by precedence:
//                               browser OFFLINE → backend UNREACHABLE (warm REST
//                               drop) → one or more HOST links dropped (named).
//   2b. HostConnection        — per-host live/reconnecting/offline indicator, on
//                               each host's own surfaces (the channel is per host).
//   3. ColdStartDown          — a COLD failure (first load never succeeded, so
//                               there's nothing to show). The only full takeover.
//   4. SurfaceError           — one store/endpoint failed; inline + retry on
//                               just that surface, leaving stale data visible.
//
// Error boundaries DON'T catch async/API errors — those are state (the
// connection store + per-store status), surfaced by 2–4. Boundaries are only
// for code that throws while rendering.

// ---- 1. The boundary itself ------------------------------------------------
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // Telemetry seam — console today, a backend error endpoint later (one line).
    try {
      console.error("[Krystal] UI crash caught by boundary:", error, info && info.componentStack);
    } catch (e) {}
    if (this.props.onError) { try { this.props.onError(error, info); } catch (e) {} }
  }
  componentDidUpdate(prev) {
    // Clearing on a changed resetKey lets navigation recover a crashed page
    // WITHOUT remounting the whole subtree (which would drop page state).
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }
  reset() { this.setState({ error: null }); }
  render() {
    if (this.state.error) {
      const fb = this.props.fallback;
      if (typeof fb === "function") return fb(this.reset, this.state.error);
      if (fb) return fb;
      return React.createElement(AppCrash, { error: this.state.error, onReload: () => window.location.reload() });
    }
    return this.props.children;
  }
}

// A component that throws on render — the dev panel mounts this inside the
// content boundary to demonstrate per-page recovery.
function CrashNow() {
  throw new Error("Simulated render crash (dev tools)");
}

// ---- 2. Connectivity banner (the single connection-status slot) -----------
// One banner, three layered cases by precedence so they never stack:
//   1) browser OFFLINE   — global; no network means every host link is down.
//   2) backend UNREACHABLE — warm REST drop; affects all hosts ("Can't reach
//      Krystal"). Owns this case so the per-host list below stays quiet.
//   3) per-host link DROPPED — one or more hosts lost their live channel while
//      the backend is fine; names them so the operator knows what's stale.
// The realtime channel is PER HOST, so there is no global "live" UI — the
// healthy state shows nothing here, and each host's own surface carries its
// indicator (see HostConnection).
function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " and " + names[1];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function ConnectivityBanner({ onRetryRest }) {
  const restStatus = useStore(connectionStore, s => s.status);
  const restRetrying = useStore(connectionStore, s => s.retrying);
  const rt = useStore(realtimeStore, s => s);
  const hosts = useStore(hostsStore, s => s.list);
  const nameOf = (id) => (hosts.find(h => h.id === id) || {}).name || id;

  // 1) Browser offline — supersedes everything.
  if (!rt.online) {
    return (
      <div className="conn-banner conn-banner--down" role="status">
        <span className="conn-banner__pulse conn-banner__pulse--down"></span>
        <Icon name="wifi-off" size={15} />
        <span className="conn-banner__text">
          <b>You’re offline.</b> Live updates are paused for every host — what you see may be out of date. We’ll reconnect and catch up automatically when your network returns.
        </span>
      </div>
    );
  }
  // 2) Backend unreachable (warm REST drop) — affects all hosts.
  if (restStatus === "down") {
    return (
      <div className="conn-banner" role="status">
        <span className="conn-banner__pulse"></span>
        <Icon name="wifi-off" size={15} />
        <span className="conn-banner__text">
          <b>Can't reach Krystal.</b> Live updates are paused — what you see may be out of date, and changes might not save.
        </span>
        <button className="conn-banner__retry" onClick={onRetryRest} disabled={restRetrying}>
          <Icon name="rotate-cw" size={13} className={restRetrying ? "is-spinning" : ""} />
          {restRetrying ? "Reconnecting…" : "Retry now"}
        </button>
      </div>
    );
  }
  // 3) One or more host links dropped while the backend is fine.
  const dropped = Object.keys(rt.hosts).filter(id => rt.hosts[id].mode === "reconnecting");
  if (!dropped.length) return null;
  const names = dropped.map(nameOf);
  const one = names.length === 1;
  return (
    <div className="conn-banner" role="status">
      <span className="conn-banner__pulse"></span>
      <Icon name="refresh-cw" size={15} className="is-spinning" />
      <span className="conn-banner__text">
        <b>Lost the live connection to {joinNames(names)}.</b> Showing last-known data and refreshing on a timer while we reconnect — new console output from {one ? "it" : "those hosts"} is paused.
      </span>
      <button className="conn-banner__retry" onClick={() => dropped.forEach(id => api.reconnectHost(id))}>
        <Icon name="rotate-cw" size={13} /> Reconnect now
      </button>
    </div>
  );
}

// ---- 2b. Per-host connection indicator ------------------------------------
// Each host has its own WebSocket, so connection state is shown ON THAT HOST'S
// surfaces — never globally. `full` (the Fleet deep-dive header) always renders
// live/reconnecting/offline with a retry control; the compact form (Fleet grid
// cards) stays SILENT when live and only speaks up when a link is degraded, so
// healthy cards aren't cluttered.
function HostConnection({ hostId, full }) {
  const rt = useStore(realtimeStore, s => s);
  const restDown = useStore(connectionStore, s => s.status === "down");
  const h = rt.hosts[hostId];
  const mode = !rt.online ? "offline"
    : (restDown || (h && h.mode === "reconnecting")) ? "reconnecting"
    : "live";
  if (!full && mode === "live") return null;

  const META = {
    live:         { tone: "live", label: "Live" },
    reconnecting: { tone: "warn", label: "Reconnecting" },
    offline:      { tone: "down", label: "Offline" },
  }[mode];
  const retrySecs = h ? Math.ceil((h.nextRetryInMs || 0) / 1000) : 0;

  return (
    <span className={"host-conn host-conn--" + META.tone + (full ? " host-conn--full" : "")}
      title={"Live data channel for this host: " + META.label}>
      <span className={"host-conn__dot host-conn__dot--" + META.tone}></span>
      <span className="host-conn__label">{META.label}</span>
      {full && mode === "reconnecting" && (
        <>
          <span className="host-conn__meta">{retrySecs > 0 ? "retry in " + retrySecs + "s" : "retrying…"}{h && h.polling ? " · polling" : ""}</span>
          <button className="host-conn__btn" onClick={() => api.reconnectHost(hostId)}>
            <Icon name="rotate-cw" size={12} /> Reconnect
          </button>
        </>
      )}
      {full && mode === "offline" && (
        <span className="host-conn__meta">your device has no network</span>
      )}
    </span>
  );
}

// ---- 3. Cold-start takeover (nothing to show) -----------------------------
function ColdStartDown({ retrying, onRetry, onLogout, devMode }) {
  return (
    <div className="cold-down">
      <div className="cold-down__card">
        <div className="cold-down__icon"><Icon name="unplug" size={30} strokeWidth={1.7} /></div>
        <h1 className="cold-down__title">Can't reach Krystal</h1>
        <p className="cold-down__body">
          The control panel loaded, but it can't connect to the backend to fetch your
          servers. This is usually temporary — the host or your connection may be down.
        </p>
        <div className="cold-down__actions">
          <button className="cold-down__retry" onClick={onRetry} disabled={retrying}>
            <Icon name="rotate-cw" size={15} className={retrying ? "is-spinning" : ""} />
            {retrying ? "Reconnecting…" : "Try again"}
          </button>
          {onLogout && <button className="cold-down__ghost" onClick={onLogout}>Sign out</button>}
        </div>
        {devMode && (
          <button className="cold-down__demo" onClick={() => { if (api.__setHealth) api.__setHealth("ok"); onRetry(); }}>
            <Icon name="flask-conical" size={12} /> demo · restore backend &amp; retry
          </button>
        )}
        <div className="cold-down__hint"><Icon name="info" size={12} /> The connection is re-checked each time you retry.</div>
      </div>
    </div>
  );
}

// ---- 1b. App-level crash (full page, last resort) -------------------------
function AppCrash({ error, onReload }) {
  return (
    <div className="app-crash">
      <div className="app-crash__card">
        <div className="app-crash__icon"><Icon name="bug" size={26} strokeWidth={1.8} /></div>
        <h1 className="app-crash__title">Something went wrong</h1>
        <p className="app-crash__body">The panel hit an unexpected error and couldn't continue. Reloading usually clears it.</p>
        {error && error.message && <pre className="app-crash__detail">{String(error.message)}</pre>}
        <button className="app-crash__btn" onClick={onReload}><Icon name="rotate-cw" size={15} /> Reload Krystal</button>
      </div>
    </div>
  );
}

// ---- 1c. Content crash (inline, shell survives) ---------------------------
function ContentError({ error, onRetry, onHome }) {
  return (
    <div className="content-error">
      <div className="content-error__icon"><Icon name="triangle-alert" size={24} strokeWidth={1.9} /></div>
      <div className="content-error__title">This page hit an error</div>
      <div className="content-error__sub">The rest of the panel is fine — retry this view, or head back to the dashboard.</div>
      {error && error.message && <pre className="content-error__detail">{String(error.message)}</pre>}
      <div className="content-error__actions">
        <button className="content-error__btn" onClick={onRetry}><Icon name="rotate-cw" size={14} /> Try again</button>
        <button className="content-error__ghost" onClick={onHome}>Go home</button>
      </div>
    </div>
  );
}

// ---- 4. Surface error (one store/endpoint failed) -------------------------
function SurfaceError({ title, detail, onRetry, retrying }) {
  return (
    <div className="surface-error" role="alert">
      <Icon name="circle-x" size={15} />
      <span className="surface-error__text">
        <b>{title || "Couldn't load this data."}</b>
        {detail ? <span className="surface-error__detail"> {detail}</span> : null}
      </span>
      <button className="surface-error__btn" onClick={onRetry} disabled={retrying}>
        <Icon name="rotate-cw" size={12} className={retrying ? "is-spinning" : ""} />
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

// ---- Dev panel (demo harness; only shown with ?dev) -----------------------
function DevPanel({ health, connStatus, slow, onToggleHealth, onToggleSlow, onCrash, onExpireSession }) {
  const [open, setOpen] = React.useState(true);
  // Per-host realtime channels (drop one host's WS while the others stream).
  const hosts = useStore(hostsStore, s => s.list);
  useStore(realtimeStore, s => s);   // re-render on channel changes
  const sessions = useStore(sessionStore, s => s.byHost);
  if (!open) {
    return (
      <button className="dev-panel__fab" onClick={() => setOpen(true)} title="Resilience demo tools">
        <Icon name="flask-conical" size={15} />
      </button>
    );
  }
  return (
    <div className="dev-panel">
      <div className="dev-panel__head">
        <Icon name="flask-conical" size={13} />
        <span>Resilience demo</span>
        <button className="dev-panel__close" onClick={() => setOpen(false)} aria-label="Hide"><Icon name="x" size={13} /></button>
      </div>
      <div className="dev-panel__row">
        <span>Backend</span>
        <button className={"dev-panel__toggle" + (health === "down" ? " is-down" : "")} onClick={onToggleHealth}>
          <span className="dev-panel__dot"></span>{health === "down" ? "DOWN" : "OK"}
        </button>
      </div>
      <div className="dev-panel__row">
        <span>Network</span>
        <button className={"dev-panel__toggle" + (slow ? " is-slow" : "")} onClick={onToggleSlow}>
          <span className="dev-panel__dot"></span>{slow ? "SLOW" : "FAST"}
        </button>
      </div>
      <div className="dev-panel__row dev-panel__row--sub">
        <span>Realtime</span>
        <span className="dev-panel__hint-inline">per host · each its own WS</span>
      </div>
      {hosts.map(h => {
        const sock = api.__hostSocket ? api.__hostSocket(h.id) : "up";
        return (
          <div className="dev-panel__row dev-panel__row--host" key={h.id}>
            <span>{h.name}</span>
            <button className={"dev-panel__toggle" + (sock === "up" ? "" : " is-down")}
              onClick={() => api.__setHostSocket(h.id, sock === "down" ? "up" : "down")}>
              <span className="dev-panel__dot"></span>{sock === "up" ? "LIVE" : "DROP"}
            </button>
          </div>
        );
      })}
      <div className="dev-panel__row dev-panel__row--sub">
        <span>Identity</span>
        <span className="dev-panel__hint-inline">per-host sessions · §6·a</span>
      </div>
      <div className="dev-panel__row">
        <span>discord.com</span>
        <button className={"dev-panel__toggle" + (sessionStore.discordLive() ? "" : " is-down")}
          onClick={() => sessionStore.discordLive() ? sessionStore.dropDiscord() : sessionStore.restoreDiscord()}
          title="Drop the discord.com session → next bounce needs an interactive consent">
          <span className="dev-panel__dot"></span>{sessionStore.discordLive() ? "SESSION" : "LOGGED OUT"}
        </button>
      </div>
      {hosts.map(h => {
        const st = (sessions[h.id] || {}).status || "none";
        return (
          <div className="dev-panel__row dev-panel__row--host" key={"auth-" + h.id}>
            <span>{h.name}</span>
            <span className="dev-panel__authbtns">
              <button className={"dev-panel__toggle" + (st === "denied" ? " is-down" : "")}
                onClick={() => st === "denied" ? sessionStore.grant(h.id) : sessionStore.revoke(h.id)}
                title={st === "denied" ? "Grant role (clear 403)" : "Revoke role (force 403)"}>
                <span className="dev-panel__dot"></span>{st === "denied" ? "403" : st === "live" ? "OK" : st.toUpperCase().slice(0, 4)}
              </button>
              <button className="dev-panel__mini" title="Force session expiry (→ silent refresh on next call)"
                onClick={() => sessionStore.expire(h.id)}><Icon name="timer-reset" size={11} /></button>
            </span>
          </div>
        );
      })}
      <button className="dev-panel__action" onClick={() => sessionStore.forgetHosts()}><Icon name="server-off" size={12} /> Forget all hosts (→ add-host)</button>
      {onExpireSession && <button className="dev-panel__action" onClick={onExpireSession}><Icon name="user-x" size={12} /> Expire panel session (→ login)</button>}
      <div className="dev-panel__row">
        <span>Connection</span>
        <code className="dev-panel__conn">{connStatus}</code>
      </div>
      <button className="dev-panel__action" onClick={onCrash}><Icon name="bug" size={12} /> Crash this page</button>
      <button className="dev-panel__action" onClick={() => window.location.reload()}><Icon name="rotate-cw" size={12} /> Cold reload</button>
      <div className="dev-panel__hint">
        <b>Slow + Cold reload</b> = first-load skeletons (no data yet). <b>Slow + Refresh</b> = data stays put while it re-fetches. <b>Backend down + Refresh</b> = surface error. <b>Drop a host</b> = that host shows Reconnecting + polling fallback while the others keep streaming. <code>?api=down</code> = cold start.
      </div>
    </div>
  );
}

export { AppCrash, ColdStartDown, ConnectivityBanner, ContentError, CrashNow, DevPanel, ErrorBoundary, HostConnection, SurfaceError };

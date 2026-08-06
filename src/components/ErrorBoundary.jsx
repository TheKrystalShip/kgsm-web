import React from "react";
import { Icon } from "./Icon.jsx";

// ErrorBoundary.jsx — the resilience layer.
//
// Cooperating pieces, by failure mode:
//   1. ErrorBoundary (class)  — catches SYNCHRONOUS render/lifecycle crashes.
//                               App-level = last resort; content-level = keeps
//                               the shell alive while one page recovers.
//   2. ConnectivityBanner     — the single connection-status slot, by precedence:
//                               browser offline → backend UNREACHABLE (warm REST
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
    } catch {}
    if (this.props.onError) { try { this.props.onError(error, info); } catch {} }
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

// ---- 3. Cold-start takeover (nothing to show) -----------------------------
function ColdStartDown({ retrying, onRetry, onLogout }) {
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

export { AppCrash, ColdStartDown, ContentError, ErrorBoundary, SurfaceError };

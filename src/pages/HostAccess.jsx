import React from "react";
import { Icon } from "../components/Icon.jsx";
import { can } from "../lib/persona.js";
import { TIER_LABEL, sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { OAuthIcon } from "./LoginPage.jsx";

// HostAccess.jsx — UI for the per-host identity/session layer (Model A).
//
//   HostAuthBadge   — per-host session pill (live tier / connecting / expired /
//                     no-access). Used in the host switcher, Fleet, Settings.
//   HostDeniedNotice— the TERMINAL 403 surface: identity verified, but the role
//                     isn't granted on this host. Never offers re-auth (a 403
//                     re-bounce would loop); only "switch away" / "manage".
//   AddHostPage     — the intermediate "add a host" surface. Shown after login
//                     when no host is configured (the original empty-dashboard
//                     fix) and for adding another host later. Drives the silent
//                     Discord bounce (popup, gesture-bound) and lands a session.

function HostAuthBadge({ hostId, size }) {
  const rec = useStore(sessionStore, s => s.byHost[hostId]) || { status: "none" };
  const TIER = TIER_LABEL || {};
  const map = {
    live:          { tone: "ok",   icon: "shield-check", label: TIER[rec.tier] || "Connected" },
    bootstrapping: { tone: "info", icon: "loader-2",     label: "Connecting…", spin: true },
    expired:       { tone: "warn", icon: "rotate-cw",    label: "Reconnecting…", spin: true },
    denied:        { tone: "danger", icon: "lock",       label: "No access" },
    none:          { tone: "muted", icon: "plug",        label: "Not connected" },
  };
  const m = map[rec.status] || map.none;
  return (
    <span className={"host-auth host-auth--" + m.tone + (size === "sm" ? " host-auth--sm" : "")} title={m.label}>
      <Icon name={m.icon} size={size === "sm" ? 11 : 12} className={m.spin ? "is-spinning" : ""} />
      <span className="host-auth__label">{m.label}</span>
    </span>
  );
}

function HostDeniedNotice({ host, onBack, onManage, embedded }) {
  const name = (host && host.name) || "this host";
  return (
    <div className={"host-denied" + (embedded ? " host-denied--embedded" : "")}>
      <div className="host-denied__icon"><Icon name="lock" size={26} strokeWidth={1.8} /></div>
      <h2 className="host-denied__title">You don’t have permission on {name}</h2>
      <p className="host-denied__body">
        You’re signed in with Discord and <b>{name}</b> recognises you — but your Discord
        role doesn’t grant access here. Each host checks roles against its own
        community, so access can differ from host to host. Ask an admin of this
        host’s Discord to grant your role, then reconnect.
      </p>
      <div className="host-denied__actions">
        {onBack && <button className="host-btn host-btn--primary" onClick={onBack}><Icon name="layers" size={14} /> Back to all hosts</button>}
        {onManage && <button className="host-btn" onClick={onManage}><Icon name="server-cog" size={14} /> Manage hosts</button>}
      </div>
      <div className="host-denied__hint"><Icon name="info" size={12} /> This isn’t a sign-in problem — re-logging in won’t change your role. It’s set on {name}’s side.</div>
    </div>
  );
}

// A freshly-added host you DO have access to: valid-but-empty telemetry shape
// (mirrors makeHostSkeleton) so the fleet/diagnostics never crash; _pending so
// it reads as "awaiting first agent check-in" until metrics arrive.
function skeletonHost(name, hostname) {
  const slug = (name || hostname || "host").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) || "host";
  let id = slug, n = 2;
  while (hostsStore && hostsStore.find(id)) id = slug + "-" + n++;
  return {
    id, name: name || "New host", hostname: hostname || "host.example", region: "—",
    online: true, tier: "operator", boot_time: new Date().toISOString().slice(0, 19),
    kernel: "—", os: "—", panel_version: "0.14.2",
    cpu: { model: "—", cores: 0, threads: 0, freq_ghz: 0, usage_pct: 0, per_core: [], load_avg: [0, 0, 0], temp_c: 0 },
    ram: { total_gb: 0, used_gb: 0, cached_gb: 0, buffers_gb: 0, free_gb: 0, swap_total_gb: 0, swap_used_gb: 0 },
    disks: [], network: { interfaces: [], open_ports: [] }, sensors: [], processes: [],
    events: [{ ts: new Date().toISOString().slice(0, 19), severity: "info", icon: "plug", text: "Host registered — awaiting first agent check-in" }],
    logs: [], _pending: true,
  };
}

function AddHostPage({ user, firstRun, onAdded, onCancel, onLogout }) {
  const [url, setUrl] = React.useState("");
  // phase: idle | opening | verifying | denied | error
  const [phase, setPhase] = React.useState("idle");
  const normalized = url.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const valid = /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(normalized) || /^localhost(:\d+)?$/i.test(normalized);

  // The silent bounce. Popup is gesture-bound (this runs from the button click).
  // We fake the Discord round-trip the popup would do; a host URL containing
  // "community"/"noaccess" comes back 403 so the denied path is demoable here too.
  const connect = () => {
    if (!valid || phase === "opening" || phase === "verifying") return;
    const willDeny = /community|noaccess|no-access/i.test(normalized);
    setPhase("opening");
    setTimeout(() => {
      setPhase("verifying");                       // popup landed on /auth/discord/callback
      setTimeout(() => {
        if (willDeny) { setPhase("denied"); return; }
        const name = normalized.split(".")[0].replace(/^./, c => c.toUpperCase());
        const host = skeletonHost(name, normalized);
        host.url = normalized;
        hostsStore.add(host);
        // Land the host-scoped session exactly as a real callback would.
        sessionStore.bootstrap(host.id, { interactive: true }).then(() => {
          sessionStore.register(host);
          onAdded && onAdded(host.id);
        });
      }, 900);
    }, 700);
  };

  const busy = phase === "opening" || phase === "verifying";

  return (
    <div className="login-shell">
      <div className="login-shell__inner">
        <div className="login-shell__brand">
          <img src="/assets/tks-mark.png" alt="" />
          <div className="login-shell__brand-name">The Krystal Ship</div>
          <div className="login-shell__tagline">
            {firstRun ? "One more step — connect a host to manage." : "Connect another host."}
          </div>
        </div>

        <div className="login-card add-host-card">
          <div className="login-card__heading">{firstRun ? "Add your first host" : "Add a host"}</div>
          <div className="login-card__sub">
            A host is a machine running the Krystal agent. We’ll connect using the
            Discord account you’re already signed in with — no second login.
          </div>

          <label className="add-host__field">
            <span className="add-host__label">Host address</span>
            <div className={"add-host__input" + (url && !valid ? " add-host__input--bad" : "")}>
              <span className="add-host__scheme">https://</span>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="krystal-1.tks.example"
                spellCheck="false" autoCapitalize="off" autoCorrect="off"
                disabled={busy}
                onKeyDown={e => { if (e.key === "Enter") connect(); }} />
            </div>
            {url && !valid && <span className="add-host__err">Enter a valid host address.</span>}
          </label>

          {phase === "denied" ? (
            <div className="add-host__denied">
              <Icon name="lock" size={15} />
              <div>
                <b>Connected, but no access.</b> Your Discord identity checks out, but you
                don’t have a role on this host. Ask its admin to grant you one.
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="oauth-btn oauth-btn--discord add-host__connect"
              disabled={!valid || busy}
              onClick={connect}>
              {phase === "opening"   && (<><span className="oauth-spinner" /> Opening Discord…</>)}
              {phase === "verifying" && (<><span className="oauth-spinner" /> Verifying with the host…</>)}
              {!busy && (<><OAuthIcon provider="discord" /> Connect with Discord</>)}
            </button>
          )}

          <div className="add-host__note">
            <Icon name="shield-check" size={13} />
            <span>The host verifies your Discord identity once, then issues its own
            session. Your roles are checked on the host — access can differ per host.</span>
          </div>

          {phase === "denied" && (
            <button className="add-host__retry" onClick={() => { setPhase("idle"); setUrl(""); }}>
              <Icon name="arrow-left" size={13} /> Try a different host
            </button>
          )}
        </div>

        <div className="add-host__foot">
          {onCancel
            ? <button className="add-host__foot-link" onClick={onCancel}><Icon name="arrow-left" size={13} /> Back</button>
            : <span className="add-host__foot-hint">You can add more hosts later from the Fleet page.</span>}
          {onLogout && <button className="add-host__foot-link" onClick={onLogout}><Icon name="log-out" size={13} /> Sign out</button>}
        </div>
      </div>
    </div>
  );
}

export { AddHostPage, HostAuthBadge, HostDeniedNotice, skeletonHost };

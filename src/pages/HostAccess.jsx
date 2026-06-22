import React from "react";
import { Icon } from "../components/Icon.jsx";
import { LIVE, MOCK } from "../lib/config.js";
import { addConnection, connectHost, registryEntry, setAppUser } from "../lib/connect.js";
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
  // phase: idle | probing | needs_auth | not_kgsm | unreachable | (mock: opening | verifying | denied)
  const [phase, setPhase] = React.useState("idle");
  const normalized = url.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const valid =
    /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(normalized) ||
    /^localhost(:\d+)?$/i.test(normalized) ||
    /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(normalized);
  const busy = phase === "probing" || phase === "opening" || phase === "verifying";

  // Already connected (LIVE) outside the demo → this is a SECOND host. Multi-host
  // fan-out (Slice B) isn't wired yet, so a 2nd connection would silently show only
  // the first host's data — be honest rather than pretend it worked.
  const multiPending = LIVE && !MOCK;

  // Real connect: probe the public handshake, resolve identity, register + reload.
  // Auth-disabled hosts complete here; auth-enabled ones report needs_auth (the
  // Discord token-handoff is a backend gap, WIRING §6) instead of a dead-end bounce.
  const connectReal = async () => {
    if (!valid || busy) return;
    setPhase("probing");
    const res = await connectHost(url);
    if (res.status === "ok") {
      addConnection(registryEntry(res.origin, res.name));
      setAppUser(res.user);                 // app-shell identity from /me
      window.location.reload();             // re-eval config → LIVE; boot against the connected host
      return;
    }
    setPhase(res.status);                    // needs_auth | not_kgsm | unreachable
  };

  // MOCK demo: the original faked Discord round-trip (no real backend). A URL
  // containing "community"/"noaccess" demos the denied path.
  const connectMock = () => {
    if (!valid || busy) return;
    const willDeny = /community|noaccess|no-access/i.test(normalized);
    setPhase("opening");
    setTimeout(() => {
      setPhase("verifying");
      setTimeout(() => {
        if (willDeny) { setPhase("denied"); return; }
        const name = normalized.split(".")[0].replace(/^./, c => c.toUpperCase());
        const host = skeletonHost(name, normalized);
        host.url = normalized;
        hostsStore.add(host);
        sessionStore.bootstrap(host.id, { interactive: true }).then(() => {
          sessionStore.register(host);
          onAdded && onAdded(host.id);
        });
      }, 900);
    }, 700);
  };

  const connect = MOCK ? connectMock : connectReal;

  // Honest copy per failure phase (real connect).
  const FAIL = {
    needs_auth: { title: "This host needs a Discord sign-in", body: "It’s a kgsm-api, but it has authentication enabled — and connecting through Discord from here isn’t wired up yet. Use a host with auth disabled for now, or connect once the sign-in handoff lands." },
    not_kgsm: { title: "That doesn’t look like a kgsm-api", body: "We reached the address but it didn’t answer with a kgsm-api handshake. Double-check the host and port." },
    unreachable: { title: "Couldn’t reach that host", body: "No kgsm-api answered at that address. Check it’s running and reachable from here (host, port, https vs http)." },
  };
  const fail = FAIL[phase];

  return (
    <div className="login-shell">
      <div className="login-shell__inner">
        <div className="login-shell__brand">
          <img src="/assets/tks-mark.png" alt="" />
          <div className="login-shell__brand-name">The Krystal Ship</div>
          <div className="login-shell__tagline">
            {firstRun ? "First, connect to a kgsm-api host." : "Connect another host."}
          </div>
        </div>

        <div className="login-card add-host-card">
          <div className="login-card__heading">{firstRun ? "Connect your first host" : "Connect a host"}</div>
          <div className="login-card__sub">
            {MOCK
              ? "A host is a machine running the Krystal agent. We’ll connect using the Discord account you’re already signed in with."
              : "A host runs the kgsm-api control panel. Enter its address — we’ll verify it’s a kgsm-api and connect."}
          </div>

          {multiPending ? (
            <div className="add-host__note" style={{ marginTop: 14 }}>
              <Icon name="info" size={14} />
              <span>You’re connected to a host already. Viewing more than one host at once
              (multi-host fan-out) isn’t wired up yet — it’s the next slice of work.</span>
            </div>
          ) : (<>
          <label className="add-host__field">
            <span className="add-host__label">Host address</span>
            <div className={"add-host__input" + (url && !valid ? " add-host__input--bad" : "")}>
              <input
                value={url}
                onChange={e => { setUrl(e.target.value); if (phase !== "idle" && phase !== "probing") setPhase("idle"); }}
                placeholder={MOCK ? "krystal-1.tks.example" : "https://krystal-1.example  ·  http://127.0.0.1:8097"}
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
          ) : fail ? (
            <div className="add-host__denied">
              <Icon name="alert-triangle" size={15} />
              <div><b>{fail.title}.</b> {fail.body}</div>
            </div>
          ) : null}

          <button
            type="button"
            className="oauth-btn oauth-btn--discord add-host__connect"
            disabled={!valid || busy}
            onClick={connect}>
            {phase === "probing"   && (<><span className="oauth-spinner" /> Verifying the host…</>)}
            {phase === "opening"   && (<><span className="oauth-spinner" /> Opening Discord…</>)}
            {phase === "verifying" && (<><span className="oauth-spinner" /> Verifying with the host…</>)}
            {!busy && (MOCK
              ? (<><OAuthIcon provider="discord" /> Connect with Discord</>)
              : (<><Icon name="plug" size={15} /> Connect</>))}
          </button>

          <div className="add-host__note">
            <Icon name="shield-check" size={13} />
            <span>{MOCK
              ? "The host verifies your Discord identity once, then issues its own session. Roles are checked per host."
              : "Each host issues its own session and checks your role independently — access can differ per host."}</span>
          </div>
          </>)}
        </div>

        <div className="add-host__foot">
          {onCancel
            ? <button className="add-host__foot-link" onClick={onCancel}><Icon name="arrow-left" size={13} /> Back</button>
            : <span className="add-host__foot-hint">{firstRun ? "Your hosts are remembered on this device." : "You can add more hosts later."}</span>}
          {onLogout && <button className="add-host__foot-link" onClick={onLogout}><Icon name="log-out" size={13} /> Sign out</button>}
        </div>
      </div>
    </div>
  );
}

export { AddHostPage, HostAuthBadge, HostDeniedNotice, skeletonHost };

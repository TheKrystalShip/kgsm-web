import React from "react";
import { HostAuthBadge, HostDeniedNotice } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { CONNECTIONS } from "../lib/config.js";
import { addConnection, connectHost, registryEntry, setAppUser } from "../lib/connect.js";

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

function AddHostPage({ user, firstRun, onAdded, onCancel, onLogout }) {
  const [url, setUrl] = React.useState("");
  // phase: idle | probing | needs_auth | not_kgsm | unreachable
  const [phase, setPhase] = React.useState("idle");
  const normalized = url.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const valid =
    /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(normalized) ||
    /^localhost(:\d+)?$/i.test(normalized) ||
    /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(normalized);
  const busy = phase === "probing";

  // Already connected → this is a SECOND host. Multi-host fan-out (Slice B) isn't
  // wired yet, so a 2nd connection would silently show only the first host's
  // data — be honest rather than pretend it worked.
  const multiPending = CONNECTIONS.length > 0;

  // Real connect: probe the public handshake, resolve identity, register + reload.
  //   ok         → auth-disabled / already-authed: identity from /me, into the app.
  //   needs_auth → auth-ENABLED: register the host (URL only, id resolved after
  //                login) and reload → a connected host + no identity → the Discord
  //                LoginPage, which bounces against THIS host's /auth/discord/start.
  const connectReal = async () => {
    if (!valid || busy) return;
    setPhase("probing");
    const res = await connectHost(url);
    if (res.status === "ok") {
      addConnection(registryEntry(res.origin, res.name, res.hostId));
      setAppUser(res.user);                 // app-shell identity from /me
      window.location.reload();             // re-eval config → boot against the connected host
      return;
    }
    if (res.status === "needs_auth") {
      // id is null here — /hosts is 401 pre-login; completeOAuthLogin reconciles it
      // with the bearer after Discord. Register so a reload boots connected → LoginPage.
      addConnection(registryEntry(res.origin, res.name, null));
      window.location.reload();
      return;
    }
    setPhase(res.status);                    // not_kgsm | unreachable
  };

  const connect = connectReal;

  // Honest copy per failure phase (real connect). needs_auth is NOT a failure
  // any more — it registers + reloads into the Discord LoginPage (connectReal).
  const FAIL = {
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
            A host runs the kgsm-api control panel. Enter its address — we’ll verify it’s a kgsm-api and connect.
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
                placeholder="http://127.0.0.1:8080  ·  https://your-host"
                spellCheck="false" autoCapitalize="off" autoCorrect="off"
                disabled={busy}
                onKeyDown={e => { if (e.key === "Enter") connect(); }} />
            </div>
            {url && !valid && <span className="add-host__err">Enter a valid host address.</span>}
          </label>

          {fail ? (
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
            {!busy && (<><Icon name="plug" size={15} /> Connect</>)}
          </button>

          <div className="add-host__note">
            <Icon name="shield-check" size={13} />
            <span>Each host issues its own session and checks your role independently — access can differ per host.</span>
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

export { AddHostPage, HostAuthBadge, HostDeniedNotice };

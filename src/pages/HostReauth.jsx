import React from "react";
import { Icon } from "../components/Icon.jsx";
import { sessionStore } from "../lib/sessionStore.js";
import { OAuthIcon } from "../components/host-helpers.jsx";

// HostReauth.jsx — interactive per-host re-authentication (Model A).
//
// The per-host session machine (sessionStore) heals an expired bearer SILENTLY
// whenever the discord.com SSO anchor is alive. When it can't — the anchor is
// gone, so silent SSO answers `login_required` — re-auth needs a real user
// gesture (a Discord consent popup), which can't fire from inside a fetch. So
// the seam surfaces the host as `expired` and these two surfaces let the user
// re-confirm:
//
//   HostExpiredNotice — inline, non-terminal surface shown when you're SCOPED to
//                       a host whose session lapsed (parallel to HostDeniedNotice,
//                       but amber + recoverable). Offers "Re-authorize".
//   HostReauthModal   — the gesture-bound modal. NAMES the host, reuses the login
//                       card's Discord button, and drives the interactive
//                       bootstrap. NB: labelled "Re-authorize" — deliberately
//                       distinct from the realtime-socket "Reconnect" (#04),
//                       which is a different thing on the same host.

function HostExpiredNotice({ host, onReauth, onBack }) {
  const name = (host && host.name) || "this host";
  return (
    <div className="host-expired">
      <div className="host-expired__icon"><Icon name="rotate-cw" size={24} strokeWidth={1.8} /></div>
      <h2 className="host-expired__title">Your session for {name} expired</h2>
      <p className="host-expired__body">
        Krystal couldn’t renew your session on <b>{name}</b> in the background —
        your Discord sign-in needs a quick re-confirm. Your other hosts are
        unaffected. Re-authorize to pick up right where you left off.
      </p>
      <div className="host-expired__actions">
        <button className="host-btn host-btn--primary" onClick={onReauth}>
          <OAuthIcon provider="discord" size={15} /> Re-authorize with Discord
        </button>
        {onBack && <button className="host-btn" onClick={onBack}><Icon name="layers" size={14} /> Back to all hosts</button>}
      </div>
      <div className="host-expired__hint"><Icon name="info" size={12} /> Only {name} is affected — sessions are issued per host.</div>
    </div>
  );
}

function HostReauthModal({ host, onClose, onDone }) {
  const name = (host && host.name) || "this host";
  const id = host && host.id;
  // phase: idle | opening | verifying | denied | error
  const [phase, setPhase] = React.useState("idle");
  const busy = phase === "opening" || phase === "verifying";

  // Esc closes (unless mid-flight). Mirrors the other modals.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const reauth = () => {
    if (busy || !id || !sessionStore) return;
    setPhase("opening");                       // popup → discord.com (re-establishes the SSO anchor)
    setTimeout(() => {
      setPhase("verifying");                   // host re-verifies identity, mints a fresh session
      sessionStore.reauthorize(id).then(r => {
        if (r === "denied") { setPhase("denied"); return; }
        if (r !== "live")   { setPhase("error"); return; }
        onDone && onDone();
      }, () => setPhase("error"));
    }, 650);
  };

  return (
    <div className="modal-scrim reauth-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose && onClose(); }}>
      <div className="reauth-modal" role="dialog" aria-modal="true" aria-label={"Re-authorize " + name}>
        {!busy && (
          <button className="reauth-modal__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        )}
        <div className="reauth-modal__icon"><Icon name="shield-alert" size={24} strokeWidth={1.8} /></div>
        <div className="reauth-modal__head">
          <div className="reauth-modal__title">Re-authorize your session</div>
          <div className="reauth-modal__host"><Icon name="server" size={13} /> {name}</div>
        </div>

        {phase === "denied" ? (
          <div className="reauth-modal__denied">
            <Icon name="lock" size={15} />
            <div><b>Access changed.</b> Your Discord identity checks out, but your role on <b>{name}</b> was removed. Ask an admin of {name}’s Discord to grant it back.</div>
          </div>
        ) : phase === "error" ? (
          <>
            <div className="reauth-modal__sub">Couldn’t reach <b>{name}</b> to renew the session. Check the host is online, then try again.</div>
            <button className="oauth-btn oauth-btn--discord" onClick={reauth}><OAuthIcon provider="discord" /> Try again</button>
          </>
        ) : (
          <>
            <div className="reauth-modal__sub">
              Your session on <b>{name}</b> lapsed and couldn’t be renewed in the
              background. Re-confirm with the Discord account you’re already using —
              it takes a second and drops you back where you were.
            </div>
            <button className="oauth-btn oauth-btn--discord" disabled={busy} onClick={reauth}>
              {phase === "opening"   && (<><span className="oauth-spinner" /> Opening Discord…</>)}
              {phase === "verifying" && (<><span className="oauth-spinner" /> Verifying with {name}…</>)}
              {!busy && (<><OAuthIcon provider="discord" /> Re-authorize with Discord</>)}
            </button>
          </>
        )}

        <div className="reauth-modal__note">
          <Icon name="shield-check" size={13} />
          <span>This re-confirms your identity with {name} only — your other hosts and their sessions aren’t touched.</span>
        </div>
      </div>
    </div>
  );
}

export { HostExpiredNotice, HostReauthModal };

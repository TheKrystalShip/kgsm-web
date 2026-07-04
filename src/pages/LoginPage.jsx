import React from "react";
import { OAuthIcon } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { takeOAuthError } from "../lib/authRedirect.js";
import { API_BASE } from "../lib/config.js";
import { sessionStore } from "../lib/sessionStore.js";

// LoginPage — the unauthenticated landing surface.
//
// All of Krystal sits behind this. Discord OAuth is the primary path (the
// product is built for a Discord crew), with Google / GitHub / Microsoft
// shown as secondary providers for any future non-Discord audiences.

// LoginPage — the unauthenticated gate, shown once a host is connected but no
// identity is established yet. A full-page Discord OAuth bounce to the connected
// host's /auth/discord/start. The callback 302s back to this SPA with the session
// in the URL fragment (main.jsx → completeOAuthLogin), so there is no onLogin
// callback — the app reboots already authed. Auth is PER HOST, so we sign in
// against the one connected host (API_BASE) and SHOW the exact origin we bounce
// to: a localhost-vs-127.0.0.1 mismatch would otherwise fail as an opaque
// state-cookie 400. "Connect a different host" drops the registry → connect screen.
function LoginPage() {
  const [busy, setBusy] = React.useState(false);
  const [error] = React.useState(() => takeOAuthError());
  const origin = API_BASE || "";
  const hostLabel = origin.replace(/^https?:\/\//, "") || "this host";

  const signIn = () => {
    if (busy || !origin) return;
    setBusy(true);
    window.location.href = origin + "/auth/discord/start?prompt=consent";
  };
  const useDifferentHost = () => {
    try { sessionStore.forgetHosts(); } catch {}
    window.location.reload();   // registry now empty → the connect screen
  };

  return (
    <div className="login-shell">
      <div className="login-shell__inner">
        <div className="login-shell__brand">
          <img src="/assets/tks-mark.png" alt="" />
          <div className="login-shell__brand-name">The Krystal Ship</div>
          <div className="login-shell__tagline">Sign in to your control panel.</div>
        </div>

        <div className="login-card">
          <div className="login-card__heading">Sign in</div>
          {error && (
            <div className="login-card__error" role="alert">
              <Icon name="alert-triangle" size={14} />
              {error === "denied"
                ? "Your Discord account doesn’t have a role on this host."
                : "Sign-in didn’t complete — please try again."}
            </div>
          )}
          <div className="login-card__sub">
            This host verifies you through Discord and grants access based on your role in its community.
          </div>

          <button
            type="button"
            className="oauth-btn oauth-btn--discord"
            disabled={busy || !origin}
            onClick={signIn}>
            {busy
              ? (<><span className="oauth-spinner" /> Redirecting to Discord…</>)
              : (<><OAuthIcon provider="discord" /> Continue with Discord</>)}
          </button>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, color: "var(--fg-3)" }}>
            <Icon name="server" size={12} />
            <span>Signing in to <b style={{ color: "var(--fg-2)" }}>{hostLabel}</b></span>
          </div>

          <button
            type="button"
            onClick={useDifferentHost}
            style={{ marginTop: 16, background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="arrow-left" size={13} /> Connect a different host
          </button>
        </div>

        <div className="login-shell__legal">
          New here? This host sets up your access automatically on first sign-in, based on your Discord role.
        </div>
      </div>
    </div>
  );
}

export { LoginPage, OAuthIcon };

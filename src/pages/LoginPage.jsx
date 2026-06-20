import React from "react";
import { Icon } from "../components/Icon.jsx";
import { takeOAuthError } from "../lib/authRedirect.js";
import { API_BASE, LIVE } from "../lib/config.js";

// LoginPage — the unauthenticated landing surface.
//
// All of Krystal sits behind this. Discord OAuth is the primary path (the
// product is built for a Discord crew), with Google / GitHub / Microsoft
// stubbed out as secondary providers for any future non-Discord audiences.
//
// In the demo, every provider triggers the same fake auth round-trip — a
// short spinner, then a synthesised user. Wire to real OAuth endpoints
// behind `KRYSTAL_API_BASE/auth/{provider}/start` in production.

function OAuthIcon({ provider, size = 20 }) {
  const s = { width: size, height: size, display: "block" };
  if (provider === "discord") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="currentColor">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.51 12.51 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.01c.12.099.246.198.373.291a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.418 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.418 0-1.334.955-2.42 2.157-2.42 1.21 0 2.175 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"/>
      </svg>
    );
  }
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    );
  }
  if (provider === "github") {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="currentColor">
        <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>
      </svg>
    );
  }
  if (provider === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path fill="#F25022" d="M1 1h10v10H1z"/>
        <path fill="#7FBA00" d="M13 1h10v10H13z"/>
        <path fill="#00A4EF" d="M1 13h10v10H1z"/>
        <path fill="#FFB900" d="M13 13h10v10H13z"/>
      </svg>
    );
  }
  return null;
}

// User profile per provider. In production the OAuth callback returns the real
// identity (Discord username, avatar, email) and we store whatever it sends —
// so every user sees THEIR own name after signing in. For this prototype these
// objects stand in for that callback response; the Discord entry is the seeded
// identity ("Heisen") since Discord is the live sign-in path. This is the single
// source of the logged-in username — nothing downstream should hardcode a name.
const FAKE_PROFILES = {
  discord:   { name: "Heisen",      display: "Heisen",        provider: "discord",   email: "heisen@krystalship.example" },
  google:    { name: "haru.dev",    display: "Haru",          provider: "google",    email: "haru@gmail.example" },
  github:    { name: "haru-codes",  display: "haru-codes",    provider: "github",    email: "haru@users.noreply.github.com" },
  microsoft: { name: "h.kael",      display: "Haru Kael",     provider: "microsoft", email: "h.kael@outlook.example" },
};

function LoginPage({ onLogin }) {
  const [busy, setBusy] = React.useState(null); // provider id or null
  const [stay, setStay] = React.useState(true);
  // Preview-as switch (demo/verification lever): forces ONE role across the
  // whole panel so an admin can see exactly what each tier sees, then sign back
  // in to switch. Real authorization is per-host (you can be admin on one box,
  // operator on another, viewer on a third); this lens just fixes a single role
  // for testing. "admin" is the default — the panel as it is today.
  const [persona, setPersona] = React.useState("admin");
  // A failed/denied OAuth round-trip lands back here with #error=… (captured +
  // stashed in main.jsx); surface it once so the user isn't left guessing.
  const [error] = React.useState(() => takeOAuthError());

  const handleProvider = (provider) => {
    if (busy) return;
    // Live backend: a real OAuth bounce is a full-page navigation to the host's
    // /auth/discord/start; the callback 302s back with the session in the URL
    // fragment (captured in main.jsx → completeOAuthLogin). The fake round-trip
    // below stays for fixture mode (no VITE_API_BASE).
    if (LIVE && provider === "discord" && API_BASE) {
      setBusy(provider);
      window.location.href = API_BASE + "/auth/discord/start?prompt=consent";
      return;
    }
    setBusy(provider);
    setTimeout(() => {
      const profile = FAKE_PROFILES[provider] || FAKE_PROFILES.discord;
      onLogin({ ...profile, stay, persona });
    }, 900);
  };

  return (
    <div className="login-shell">
      <div className="login-shell__inner">
        <div className="login-shell__brand">
          <img src="/assets/tks-mark.png" alt="" />
          <div className="login-shell__brand-name">The Krystal Ship</div>
          <div className="login-shell__tagline">Spin up game servers without the SSH dance.</div>
        </div>

        <div className="login-card">
          <div className="login-card__heading">Sign in to Krystal</div>
          {error && (
            <div className="login-card__error" role="alert">
              <Icon name="alert-triangle" size={14} />
              {error === "denied"
                ? "Your Discord account doesn’t have a role on this host."
                : "Sign-in didn’t complete — please try again."}
            </div>
          )}
          <div className="login-card__sub">Use the same Discord account you use with the crew. Your servers and roles come along with you.</div>

          <button
            type="button"
            className="oauth-btn oauth-btn--discord"
            disabled={!!busy}
            onClick={() => handleProvider("discord")}>
            {busy === "discord"
              ? (<><span className="oauth-spinner" /> Connecting to Discord…</>)
              : (<><OAuthIcon provider="discord" /> Continue with Discord</>)}
          </button>

          <div className="oauth-divider">Discord only for now</div>

          <div className="oauth-row">
            <button type="button" className="oauth-btn oauth-btn--icon-only"
              disabled
              title="Discord is the only sign-in method right now"
              aria-label="Continue with Google (unavailable)">
              <OAuthIcon provider="google" />
            </button>
            <button type="button" className="oauth-btn oauth-btn--icon-only"
              disabled
              title="Discord is the only sign-in method right now"
              aria-label="Continue with GitHub (unavailable)">
              <OAuthIcon provider="github" />
            </button>
            <button type="button" className="oauth-btn oauth-btn--icon-only"
              disabled
              title="Discord is the only sign-in method right now"
              aria-label="Continue with Microsoft (unavailable)">
              <OAuthIcon provider="microsoft" />
            </button>
          </div>

          <label className="login-options" onClick={(e) => { if (e.target.tagName !== "INPUT") setStay(!stay); }}>
            <span className={"login-checkbox" + (stay ? " login-checkbox--on" : "")}>
              {stay && <Icon name="check" size={12} strokeWidth={3} />}
            </span>
            Stay signed in on this device
          </label>

          <div className="login-persona">
            <div className="login-persona__label">
              <Icon name="eye" size={12} /> Preview the panel as
            </div>
            <div className="login-persona__seg" role="radiogroup" aria-label="Preview the panel as">
              <button type="button" role="radio" aria-checked={persona === "admin"}
                className={"login-persona__opt" + (persona === "admin" ? " is-on" : "")}
                onClick={() => setPersona("admin")}>
                <Icon name="shield-check" size={13} /> Admin
              </button>
              <button type="button" role="radio" aria-checked={persona === "operator"}
                className={"login-persona__opt" + (persona === "operator" ? " is-on" : "")}
                onClick={() => setPersona("operator")}>
                <Icon name="wrench" size={13} /> Operator
              </button>
              <button type="button" role="radio" aria-checked={persona === "viewer"}
                className={"login-persona__opt" + (persona === "viewer" ? " is-on" : "")}
                onClick={() => setPersona("viewer")}>
                <Icon name="gamepad-2" size={13} /> Viewer
              </button>
            </div>
            <div className="login-persona__hint">
              {persona === "admin"
                ? "Full control \u2014 everything, including Fleet & host management."
                : persona === "operator"
                  ? "Operate servers, set notes, view Alerts & Audit. No Fleet."
                  : "Play-only \u2014 game servers & catalog. No ops, Alerts or Audit."}
            </div>
          </div>
        </div>

        <div className="login-shell__legal">
          New here? Krystal sets up your account automatically on first sign-in. By continuing you agree to our&nbsp;<a href="#">terms</a> and&nbsp;<a href="#">privacy policy</a>.
        </div>
      </div>
    </div>
  );
}

export { LoginPage, OAuthIcon };

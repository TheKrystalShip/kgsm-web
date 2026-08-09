import React from "react";
import { OAuthIcon, providerLabel } from "../components/host-helpers.jsx";
import { Icon } from "../components/Icon.jsx";
import { Select } from "../components/Select.jsx";
import { rememberAuthAnchor, takeOAuthError } from "../lib/authRedirect.js";
import { CONNECTIONS, soleConnectionOrigin } from "../lib/config.js";
import { sessionStore } from "../lib/sessionStore.js";

// LoginPage — the unauthenticated gate, shown once a host is connected but no
// identity is established yet. All of Krystal sits behind it.
//
// A KGSM password is the way in that needs nothing outside the host. Beside it
// sits one button per provider the chosen node reports from /auth/providers —
// asked, never assumed, so a button is never drawn for a bounce that 503s and a
// host wired to a provider this build predates is still reachable through it.
// Each is a full-page OAuth bounce to that node's /auth/{provider}/start. The
// callback 302s back to this SPA with the session in the URL fragment
// (main.jsx → completeOAuthLogin), so there is no onLogin callback — the app
// reboots already authed.
//
// Signing in picks the DOORWAY into the cluster: the session is minted by the node
// you come through and vouches onto the rest, so with several nodes connected the
// user names the one to sign in against and a sole node is simply it. The exact
// origin is shown either way — a localhost-vs-127.0.0.1 mismatch would otherwise
// fail as an opaque state-cookie 400. The chosen origin is remembered for the
// return leg, which must call /me on the node that issued the token.
// "Connect a different host" drops the registry → connect screen.
function LoginPage() {
  const [busy, setBusy] = React.useState(false);
  const [error] = React.useState(() => takeOAuthError());
  const nodes = CONNECTIONS.map(c => ({ url: c.url, name: c.name, label: String(c.url || "").replace(/^https?:\/\//, "") }));
  const [origin, setOrigin] = React.useState(() => soleConnectionOrigin());
  const hostLabel = String(origin || "").replace(/^https?:\/\//, "") || "this host";

  // The KGSM password form. Its own error, separate from the OAuth one above: a wrong password is
  // this form's business and must not read as "sign-in didn't complete", which is about a redirect.
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pwError, setPwError] = React.useState(null);

  // Which providers this node offers. Asked rather than assumed: a button for one the host is not
  // wired to bounces into a 503, and a host wired to one this SPA does not know about would
  // otherwise be unreachable through anything but a password. Anonymous, because there is no session
  // here yet. An unreachable node answers nothing, and the password form is still the way in.
  const [providers, setProviders] = React.useState([]);
  React.useEffect(() => {
    if (!origin) { setProviders([]); return; }
    let live = true;
    fetch(origin + "/auth/providers", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (live) setProviders((body && body.providers) || []); })
      .catch(() => { if (live) setProviders([]); });
    return () => { live = false; };
  }, [origin]);

  const signIn = (provider) => () => {
    if (busy || !origin) return;
    setBusy(provider);
    rememberAuthAnchor(origin);   // the return leg calls /me on THIS node
    window.location.href =
      origin + "/auth/" + encodeURIComponent(provider) + "/start?prompt=consent";
  };

  // Sign in with a KGSM account. No redirect: the tokens come back in the response, and the same
  // adoption path an OAuth return leg takes turns them into a live session on this node.
  const signInWithPassword = async (e) => {
    e.preventDefault();
    if (busy || !origin || !username || !password) return;
    setBusy(true);
    setPwError(null);
    try {
      const res = await fetch(origin + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setBusy(false);
        setPwError(passwordErrorText(body, res));
        return;
      }
      rememberAuthAnchor(origin);
      const { establishNodeSession } = await import("../lib/authRedirect.js");
      await establishNodeSession(origin, { access: body.token, refresh: body.refresh });
      // A full reload, like every other identity change — several hooks live below the `!user`
      // gate, so flipping it in place would break the Rules of Hooks.
      window.location.reload();
    } catch {
      setBusy(false);
      setPwError("Couldn’t reach this host. Check it is running and try again.");
    }
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
          <form className="login-form" onSubmit={signInWithPassword}>
            {pwError && (
              <div className="login-card__error" role="alert">
                <Icon name="alert-triangle" size={14} />
                {pwError}
              </div>
            )}
            <label className="login-form__label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className="login-form__input"
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck="false"
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)} />

            <label className="login-form__label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="login-form__input"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)} />

            <button
              type="submit"
              className="login-form__submit"
              disabled={busy || !origin || !username || !password}>
              {busy ? (<><span className="oauth-spinner" /> Signing in…</>) : "Sign in"}
            </button>
          </form>

          {providers.length > 0 && <div className="login-divider"><span>or</span></div>}

          {providers.map((p) => (
            <button
              key={p}
              type="button"
              className={"oauth-btn oauth-btn--" + p}
              disabled={busy || !origin}
              onClick={signIn(p)}>
              {busy === p
                ? (<><span className="oauth-spinner" /> Redirecting to {providerLabel(p)}…</>)
                : (<><OAuthIcon provider={p} /> Continue with {providerLabel(p)}</>)}
            </button>
          ))}

          {nodes.length > 1 ? (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, color: "var(--fg-3)" }}>
              <Icon name="server" size={12} />
              <label htmlFor="login-node" style={{ whiteSpace: "nowrap" }}>Sign in through</label>
              <Select id="login-node" variant="chip" value={origin} onChange={(e) => setOrigin(e.target.value)}>
                <option value="">Choose a node…</option>
                {nodes.map(n => (
                  <option key={n.url} value={n.url}>{n.name ? `${n.name} — ${n.label}` : n.label}</option>
                ))}
              </Select>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, color: "var(--fg-3)" }}>
              <Icon name="server" size={12} />
              <span>Signing in to <b style={{ color: "var(--fg-2)" }}>{hostLabel}</b></span>
            </div>
          )}

          <button
            type="button"
            onClick={useDifferentHost}
            style={{ marginTop: 16, background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="arrow-left" size={13} /> Connect a different host
          </button>
        </div>

        <div className="login-shell__legal">
          New here? Ask an administrator of this host for an account.
        </div>
      </div>
    </div>
  );
}

// What a refused password sign-in should say.
//
// The backend deliberately gives one answer to a wrong username and a wrong password, so this is
// careful not to re-open that distinction by guessing at one. `too_many_attempts` and
// `account_disabled` are real, different facts a person needs, and `users_unavailable` is the
// host's problem rather than theirs — saying "wrong password" there would send them hunting for
// something they cannot fix.
function passwordErrorText(body, res) {
  const code = body && body.error && body.error.code;
  if (code === "too_many_attempts") {
    const wait = Number(res.headers.get("Retry-After"));
    return wait > 0
      ? `Too many attempts. Try again in ${wait} second${wait === 1 ? "" : "s"}.`
      : "Too many attempts. Try again shortly.";
  }
  if (code === "account_disabled") return "That account is disabled on this host.";
  if (code === "users_unavailable") return "This host can’t reach its accounts right now.";
  if (code === "invalid_credentials") return "That username and password don’t match an account here.";
  return "Sign-in didn’t complete — please try again.";
}

export { LoginPage, OAuthIcon };

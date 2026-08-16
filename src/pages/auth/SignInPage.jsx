import React from "react";
import { Icon } from "../../components/Icon.jsx";
import {
  PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN,
  passwordOk, passwordStrength, signIn, signUp, usernameOk, usernameProblem,
} from "../../lib/authFlow.js";
import { rememberAuthAnchor, takeOAuthError } from "../../lib/authRedirect.js";
import { AuthError, AuthShell, DoorwayChip, PasswordField, PasswordMeter, ProviderButtons } from "./AuthChrome.jsx";

// SignInPage — one card, two tabs, against one node.
//
// The order down the card is the same on both tabs, so nothing moves when you toggle:
//
//   segment → providers → divider → form
//
// Providers and whether sign-up is open both come from the node's own /auth/providers,
// carried here on the probe the node screen already made. This SPA holds no list of
// providers and no opinion about whether a host takes new accounts.
//
// Errors sit with what they are about. A wrong password renders above the username,
// inside the form, where the eye already is on the way back to fixing it. A host that
// cannot be reached invalidates the tabs, the providers and the form alike, so that one
// sits at the very top of the card, above the segmented control.

const USERNAME_RULE = (
  <>{USERNAME_MIN}–{USERNAME_MAX} characters · letters, digits, <code>.</code> <code>_</code> <code>-</code> · starts with a letter or digit</>
);

function SignInPage({ node, tab, onTab, onSession, onChangeNode }) {
  const origin = node && node.origin;
  const hostName = (node && node.label) || (origin || "").replace(/^https?:\/\//, "") || "this host";
  const registering = tab === "register";

  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState(null);
  // A refusal about the HOST rather than about what was typed — it survives a tab switch
  // and disables both doors, because neither of them can work.
  const [hostError, setHostError] = React.useState(null);
  // A provider bounce that came back refused. One-shot, read at mount.
  const [bounceError] = React.useState(() => takeOAuthError());

  // Switching tabs keeps what was typed — somebody who tried to sign in and finds they
  // have no account should not retype their username to make one.
  React.useEffect(() => { setFormError(null); }, [tab]);

  const nameProblem = usernameProblem(username);
  const strength = passwordStrength(password);
  const confirmMismatch = registering && confirm.length > 0 && confirm !== password;

  const canSubmit = !busy && !!origin && (registering
    ? usernameOk(username) && passwordOk(password) && confirm === password
    : !!username && !!password);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    setHostError(null);

    const result = registering
      ? await signUp(origin, username.trim(), displayName.trim(), password)
      : await signIn(origin, username, password);

    if (!result.ok) {
      setBusy(false);
      if (result.unreachable) setHostError(result.error);
      else setFormError(result.error);
      return;
    }

    // The node minted a session. Adopting it is the same path an OAuth return leg takes,
    // so a session behaves identically whichever door it came through.
    rememberAuthAnchor(origin);
    await onSession(origin, result.session);
  };

  const bounce = (provider) => {
    if (busy || !origin) return;
    setBusy(provider);
    rememberAuthAnchor(origin);   // the return leg calls /me on THIS node
    window.location.href = origin + "/auth/" + encodeURIComponent(provider) + "/start?prompt=consent";
  };

  const providers = (node && node.providers) || [];
  const registrationOpen = !!(node && node.registration);
  const unreachable = !!hostError;

  return (
    <AuthShell tagline={registering ? "Create an account on this host." : "Sign in to your control panel."}>
      <div className="login-card">
        {/* Above the tabs: this is not about either of them. */}
        <AuthError>{hostError}</AuthError>

        <div className="authseg" role="tablist">
          <button
            type="button" role="tab" aria-selected={!registering}
            className={!registering ? "is-on" : ""}
            onClick={() => onTab("login")}>Sign in</button>
          <button
            type="button" role="tab" aria-selected={registering}
            className={registering ? "is-on" : ""}
            onClick={() => onTab("register")}>Register</button>
        </div>

        {bounceError && !registering ? (
          <AuthError>
            {bounceError === "denied"
              ? "That account doesn’t have a role on this host yet."
              : "Sign-in didn’t complete — please try again."}
          </AuthError>
        ) : null}

        <ProviderButtons
          providers={providers}
          verb={registering ? "register" : "login"}
          busy={typeof busy === "string" ? busy : null}
          disabled={unreachable || busy === true}
          onPick={bounce} />

        {registering && !registrationOpen ? (
          <>
            <div className="login-note login-note--warn">
              <Icon name="ban" size={15} />
              <div>
                <b>{hostName} isn’t taking new accounts.</b> An administrator has to create one for
                you, or sign in with an account you already have.
              </div>
            </div>
            {providers.length ? (
              <div className="field-hint" style={{ textAlign: "center", margin: 0 }}>
                Signing up with a provider is still open here.
              </div>
            ) : null}
          </>
        ) : (
          <>
            {providers.length ? (
              <div className="login-divider"><span>or with a KGSM account</span></div>
            ) : null}

            <form className="login-form" onSubmit={submit}>
              <AuthError field>{formError}</AuthError>

              <label className="login-form__label" htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
                className={"login-form__input"
                  + (registering && username && nameProblem ? " is-bad" : "")
                  + (registering && usernameOk(username) ? " is-good" : "")}
                type="text"
                autoComplete={registering ? "username" : "username"}
                autoCapitalize="off"
                spellCheck="false"
                value={username}
                disabled={unreachable || !!busy}
                onChange={(e) => { setUsername(e.target.value); if (formError) setFormError(null); }} />
              {registering ? (
                <>
                  {username && nameProblem
                    ? <div className="field-note field-note--bad"><Icon name="x" size={13} /> <span>{nameProblem}</span></div>
                    : null}
                  <div className="field-hint">{USERNAME_RULE}</div>
                </>
              ) : null}

              {registering ? (
                <>
                  <label className="login-form__label" htmlFor="auth-display">
                    <span>Display name</span><em>optional</em>
                  </label>
                  <input
                    id="auth-display"
                    className="login-form__input"
                    type="text"
                    autoComplete="nickname"
                    placeholder={username.trim() || "Heisen"}
                    value={displayName}
                    disabled={unreachable || !!busy}
                    onChange={(e) => setDisplayName(e.target.value)} />
                  <div className="field-hint">How you appear to everyone else. Defaults to your username.</div>
                </>
              ) : null}

              <PasswordField
                id="auth-password"
                label="Password"
                value={password}
                disabled={unreachable || !!busy}
                autoComplete={registering ? "new-password" : "current-password"}
                onChange={(e) => { setPassword(e.target.value); if (formError) setFormError(null); }}
                right={!registering ? (
                  <button
                    type="button"
                    className="btn-link"
                    style={{ fontSize: 11, letterSpacing: 0, textTransform: "none" }}
                    onClick={() => setFormError(
                      "Ask an administrator of " + hostName + " to reset it — this host has no self-service reset.")}>
                    Forgot?
                  </button>
                ) : null}>
                {registering ? (
                  <>
                    <PasswordMeter strength={strength} />
                    {password && !passwordOk(password)
                      ? <div className="field-hint" style={{ marginTop: -3 }}>At least {PASSWORD_MIN} characters. Length beats punctuation.</div>
                      : null}
                  </>
                ) : null}
              </PasswordField>

              {registering ? (
                <PasswordField
                  id="auth-confirm"
                  label="Confirm password"
                  value={confirm}
                  disabled={unreachable || !!busy}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}>
                  {confirmMismatch
                    ? <div className="field-note field-note--bad"><Icon name="x" size={13} /> <span>Passwords don’t match</span></div>
                    : confirm && confirm === password
                      ? <div className="field-note field-note--ok"><Icon name="check" size={13} /> <span>Passwords match</span></div>
                      : null}
                </PasswordField>
              ) : null}

              <button type="submit" className="login-form__submit" disabled={!canSubmit}>
                {busy === true
                  ? (<><span className="oauth-spinner" /> {registering ? "Creating your account…" : "Signing in…"}</>)
                  : (registering ? "Create account" : "Sign in")}
              </button>
            </form>
          </>
        )}

        {unreachable ? (
          <button type="button" className="btn-ghost" onClick={onChangeNode}>
            <Icon name="arrow-left" size={15} /> Choose another node
          </button>
        ) : null}
      </div>

      <DoorwayChip
        node={node}
        verb={registering ? "register" : "login"}
        down={unreachable}
        onOpen={onChangeNode} />
    </AuthShell>
  );
}

export { SignInPage };

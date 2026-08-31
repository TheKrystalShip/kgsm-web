import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { providerStartUrl, register, signIn } from "../../lib/anchor.js";
import { passwordOk, passwordStrength, usernameOk, usernameProblem } from "../../lib/authFlow.js";
import { takeOAuthError } from "../../lib/authRedirect.js";
import { AuthError, AuthShell, DoorwayChip, PasswordField, PasswordMeter, ProviderButtons } from "./AuthChrome.jsx";

// SignInPage — one card, two tabs, one cluster.
//
// A session belongs to the cluster, so this signs in at the ANCHOR and at nothing else.
//
// The order down the card is the same on both tabs, so nothing moves when you toggle:
//
//   segment → providers → divider → form
//
// Which providers exist and whether sign-up is open both come from the anchor's own
// /auth/providers. This SPA holds no list of providers and no opinion about whether a cluster takes
// new accounts — and the anchor's refusals name the rule they applied, which is why nothing here
// keeps a second copy of the rules to show alongside them.
//
// Errors sit with what they are about. A wrong password renders above the username, inside the
// form, where the eye already is on the way back to fixing it. An anchor that cannot be reached
// invalidates the tabs, the providers and the form alike, so that one sits at the top of the card.

function SignInPage({ cluster, tab, onTab, onSession, onChangeCluster }) {
  // Whichever door was chosen — an anchor holding a cluster's accounts, or a standalone node
  // holding its own. Both mint their own sessions. The credential calls are passed the whole door
  // rather than its address, because two of the paths are spelled differently on each and sending a
  // node the anchor's spelling reaches nothing.
  const door = cluster || null;
  const anchor = cluster && cluster.origin;
  const registering = tab === "register";

  const [username, setUsername] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState(null);
  // A refusal about the ANCHOR rather than about what was typed — it survives a tab switch and
  // disables both doors, because neither of them can work.
  const [anchorError, setAnchorError] = React.useState(null);
  // A provider bounce that came back refused. One-shot, read at mount.
  const [bounceError] = React.useState(() => takeOAuthError());

  // Switching tabs keeps what was typed — somebody who tried to sign in and finds they
  // have no account should not retype their username to make one.
  React.useEffect(() => { setFormError(null); }, [tab]);

  const nameProblem = usernameProblem(username);
  const strength = passwordStrength(password);
  const confirmMismatch = registering && confirm.length > 0 && confirm !== password;

  const canSubmit = !busy && !!anchor && (registering
    ? usernameOk(username) && passwordOk(password) && confirm === password
    : !!username && !!password);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    setAnchorError(null);

    const result = registering
      ? await register(anchor, username.trim(), password, displayName.trim())
      : await signIn(door, username, password);

    if (!result.ok) {
      setBusy(false);
      if (result.unreachable) setAnchorError(result.error);
      else setFormError(result.error);
      return;
    }

    // The anchor minted a session. Adopting it is the same path a provider's return leg takes, so a
    // session behaves identically whichever door it came through — and a registration lands holding
    // nothing, which is the same state a first provider arrival lands in.
    await onSession(result.session);
  };

  const bounce = (provider) => {
    if (busy || !anchor) return;
    setBusy(provider);
    window.location.href = providerStartUrl(anchor, provider);
  };

  const providers = (cluster && cluster.providers) || [];
  const registrationOpen = !!(cluster && cluster.registration);
  const unreachable = !!anchorError;

  return (
    <AuthShell tagline={registering ? "Create an account." : "Sign in to your control panel."}>
      <div className="login-card">
        {/* Above the tabs: this is not about either of them. */}
        <AuthError>{anchorError}</AuthError>

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
              ? "That account holds nothing on this cluster yet."
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
                <b>This cluster isn’t taking new accounts.</b>
              </div>
            </div>

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
                      "Ask an administrator to reset it.")}>
                    Forgot?
                  </button>
                ) : null}>
                {registering ? (
                  <>
                    <PasswordMeter strength={strength} />

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
          <button type="button" className="btn-ghost" onClick={onChangeCluster}>
            <Icon name="arrow-left" size={15} /> Another cluster
          </button>
        ) : null}
      </div>

      <DoorwayChip
        anchor={anchor}
        verb={registering ? "register" : "login"}
        down={unreachable}
        onOpen={onChangeCluster} />
    </AuthShell>
  );
}

export { SignInPage };

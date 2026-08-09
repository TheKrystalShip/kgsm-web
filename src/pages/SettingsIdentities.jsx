import React from "react";
import { Icon } from "../components/Icon.jsx";
import { Modal } from "../components/Modal.jsx";
import { Select } from "../components/Select.jsx";
import { OAuthIcon, providerLabel } from "../components/host-helpers.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { api } from "../lib/apiClient.js";
import { takeLinkOutcome } from "../lib/oauthFragment.js";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { sessionStore } from "../lib/sessionStore.js";

// SettingsIdentities — "Signing in": every way the caller can prove who they are on a host, and the
// only place they change any of it. The KGSM password and the connected provider accounts are one
// card because they are one question — a password that lives apart from the accounts that replace it
// makes the reader hunt for the other half.
//
// A KGSM account is the primary object and a Discord account is one credential attached to it, so
// any Discord account can be attached to any KGSM account and which server it is in says nothing
// about either. Nothing here changes what anyone MAY DO — that is the admin Accounts screen, and it
// reads from the account alone.
//
// Both writes ask for the password again first. A link outlives the session that makes it —
// afterwards, whoever holds that Discord account can sign in as this one — and a live session can be
// a borrowed unlocked laptop. Signing in counts as proving it, so someone who has just arrived is
// never asked twice.
//
// Per-host, like accounts and sessions: each host keeps its own, and a merged list would imply a
// connection exists somewhere it does not.

const label = providerLabel;

function SettingsIdentities({ sessionProvider }) {
  // Every host this browser holds a live session on. Unlike the accounts screen this is not
  // admin-only: it is the caller's own account on each of them.
  const hosts = React.useMemo(
    () => sessionStore.readRegistry()
      .filter((h) => h && h.id && sessionStore.isLive(h.id))
      .map((h) => ({ id: h.id, name: h.name || h.id })),
    []);

  const [hostId, setHostId] = React.useState(() => (hosts[0] ? hosts[0].id : null));
  const [data, setData] = React.useState(null);       // null = not loaded yet
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);       // a credential id, or "connect"
  const [proving, setProving] = React.useState(null); // the pending action, awaiting a password
  const [confirming, setConfirming] = React.useState(null);
  const [changingPassword, setChangingPassword] = React.useState(false);
  const [passwordChanged, setPasswordChanged] = React.useState(false);

  // The outcome of a link that just came back through the callback. One-shot: the browser was
  // redirected here from Discord, and this is the only place that can say whether it worked.
  const [outcome, setOutcome] = React.useState(() => takeLinkOutcome());

  const reload = React.useCallback(() => {
    if (!hostId) return Promise.resolve();
    setError(null);
    return api.identities(hostId).list().then(
      (d) => setData(d),
      (e) => { setData(null); setError(messageOf(e, "Couldn’t load your connected accounts.")); });
  }, [hostId]);

  React.useEffect(() => { reload(); }, [reload]);

  // Run a write, asking for the password first when this session has not proved one recently. The
  // backend refuses either way — this only decides whether the user is asked before or after.
  const guarded = (action) => {
    if (data && data.reauth && data.reauth.fresh) return action();
    setProving(() => action);
  };

  const connect = (provider) => () => {
    setBusy("connect:" + provider);
    setError(null);
    return api.identities(hostId).startLink(provider).then(
      (r) => { if (r && r.url) location.assign(r.url); else { setBusy(null); setError("This host didn’t return anywhere to go."); } },
      (e) => { setBusy(null); setError(messageOf(e, `Couldn’t start connecting a ${label(provider)} account.`)); });
  };

  const disconnect = (identity) => {
    setBusy(identity.id);
    setError(null);
    setConfirming(null);
    return api.identities(hostId).unlink(identity.id).then(
      () => reload().then(() => setBusy(null)),
      (e) => { setBusy(null); setError(messageOf(e, "Couldn’t disconnect that account.")); });
  };

  if (!hosts.length) return null;

  const identities = (data && data.identities) || [];
  const providers = (data && data.providers) || [];
  const linkable = providers.filter((p) => p.configured && !p.linked);
  // Whether THIS session was established with the KGSM password, read off the handle the backend
  // returned (`provider:subject`) — the same derivation the shell uses. Absent, treat it as not
  // local: offering a change that the backend will refuse is worse than not offering it.
  const localSession = sessionProvider === "local";

  return (
    <SettingsSection icon="key-round" title="Signing in"
      meta="Signing in proves who you are; what you may do is on your account.">
      {hosts.length > 1 && (
        <SettingsRow icon="server" title="Host" sub="Each host keeps its own accounts and connections.">
          <Select value={hostId || ""} onChange={(e) => setHostId(e.target.value)}>
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
        </SettingsRow>
      )}

      {outcome && (
        <div className={"settings-link__outcome" + (outcome.error ? " settings-link__outcome--bad" : "")}
          role="status">
          <Icon name={outcome.error ? "alert-triangle" : "circle-check"} size={14} />
          {outcome.error ? linkErrorText(outcome.error) : `${label(outcome.provider)} is connected.`}
          <button type="button" className="settings-link__dismiss" onClick={() => setOutcome(null)}>Dismiss</button>
        </div>
      )}

      {passwordChanged && (
        <div className="settings-link__outcome" role="status">
          <Icon name="circle-check" size={14} />
          Your password is changed. Your other devices stay signed in — end them under Devices if
          that is not what you want.
          <button type="button" className="settings-link__dismiss"
            onClick={() => setPasswordChanged(false)}>Dismiss</button>
        </div>
      )}

      {error && (
        <div className="login-card__error" role="alert">
          <Icon name="alert-triangle" size={14} />{error}
        </div>
      )}

      {data === null && !error ? (
        <div className="settings-users__empty">Loading…</div>
      ) : (
        <div className="settings-link">
          <div className="settings-link__row">
            <span className="settings-link__mark"><Icon name="key-round" size={18} /></span>
            <span className="settings-link__who">
              <span className="settings-link__name">KGSM password</span>
              <span className="settings-link__sub">
                {passwordSub(data, localSession)}
              </span>
            </span>
            {/* Changing it needs the CURRENT one, which only a session established with it can
                prove. A provider session holds no password to prove, so the button is not offered
                to it at all rather than offered and then refused. */}
            {data && data.hasPassword && localSession && (
              <button type="button" className="settings-link__btn"
                onClick={() => { setPasswordChanged(false); setChangingPassword(true); }}>
                Change
              </button>
            )}
          </div>

          {identities.map((i) => (
            <div key={i.id} className="settings-link__row">
              <span className="settings-link__mark">
                <OAuthIcon provider={i.provider} size={18} />
              </span>
              <span className="settings-link__who">
                <span className="settings-link__name">{label(i.provider)}</span>
                <span className="settings-link__sub">
                  {i.label || i.handle}
                  {i.lastUsed ? <> · last used {rel(i.lastUsed)}</> : <> · never used</>}
                </span>
              </span>
              <button type="button" className="settings-link__btn"
                disabled={busy === i.id}
                onClick={() => setConfirming(i)}>
                {busy === i.id ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ))}

          {identities.length === 0 && (
            <div className="settings-users__empty">No accounts connected.</div>
          )}
        </div>
      )}

      {linkable.length > 0 && (
        <div className="settings-foot">
          {linkable.map((p) => (
            <button key={p.provider} className="fb-editor__btn settings-link__connect"
              disabled={busy === "connect:" + p.provider}
              onClick={() => guarded(connect(p.provider))}>
              {busy === "connect:" + p.provider ? "Opening…" : `Connect ${label(p.provider)}`}
            </button>
          ))}
        </div>
      )}

      {proving && (
        <ProvePasswordDialog
          hostId={hostId}
          hasPassword={!!(data && data.hasPassword)}
          onClose={() => setProving(null)}
          onProved={() => { const run = proving; setProving(null); reload().then(() => run()); }} />
      )}

      {changingPassword && (
        <ChangePasswordDialog
          hostId={hostId}
          onClose={() => setChangingPassword(false)}
          onChanged={() => { setChangingPassword(false); setPasswordChanged(true); reload(); }} />
      )}

      {confirming && (
        <ConfirmDisconnectDialog
          identity={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={() => guarded(() => disconnect(confirming))} />
      )}
    </SettingsSection>
  );
}

// What the password row says about itself. Three states, and the middle one is the one worth being
// explicit about: an account CAN have a password that the current session simply cannot prove.
function passwordSub(data, localSession) {
  if (!data || !data.hasPassword) return "Not set — an administrator can give you one";
  if (!localSession) {
    return `Signs in as ${data.username} — sign in with it to change it`;
  }
  return `Signs in as ${data.username}`;
}

// Change your own password, proving the current one. The current password is required even though
// the caller holds a live session, and for the reason it should be: a session can be a borrowed
// laptop, and letting one set the password that would take the account back is how a temporary
// compromise becomes a permanent one.
//
// The new password is typed twice. The backend cannot catch a typo — it would accept and store it —
// so the only place a mistyped new password can be caught is here, before it becomes the one thing
// that signs this person in.
function ChangePasswordDialog({ hostId, onClose, onChanged }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [again, setAgain] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const mismatch = again.length > 0 && next !== again;
  const ready = !!current && !!next && next === again;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.users(hostId).changePassword(current, next);
      onChanged();
    } catch (e) {
      setBusy(false);
      setError(messageOf(e, "Couldn’t change your password."));
    }
  };

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy}>
      <div className="modal settings-users__form">
        <h2 className="host-remove__title">Change your password</h2>
        {error && (
          <div className="login-card__error" role="alert"><Icon name="alert-triangle" size={14} />{error}</div>
        )}

        <label className="login-form__label" htmlFor="pw-current">Current password</label>
        <input id="pw-current" className="login-form__input" type="password" value={current}
          autoComplete="current-password" autoFocus disabled={busy}
          onChange={(e) => setCurrent(e.target.value)} />

        <label className="login-form__label" htmlFor="pw-new">New password</label>
        <input id="pw-new" className="login-form__input" type="password" value={next}
          autoComplete="new-password" disabled={busy}
          onChange={(e) => setNext(e.target.value)} />

        <label className="login-form__label" htmlFor="pw-again">New password again</label>
        <input id="pw-again" className="login-form__input" type="password" value={again}
          autoComplete="new-password" disabled={busy}
          onChange={(e) => setAgain(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && ready) submit(); }} />
        {mismatch && (
          <div className="settings-users__note">
            <Icon name="alert-triangle" size={14} />
            Those two don’t match.
          </div>
        )}

        <div className="settings-users__actions">
          <span style={{ flex: 1 }} />
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={submit} disabled={busy || !ready}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Prove the password again. Deliberately its own step rather than a field on the action: the
// question is "are you the person who owns this account", and it is asked once for a window rather
// than per click.
function ProvePasswordDialog({ hostId, hasPassword, onClose, onProved }) {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.identities(hostId).reauth(password);
      onProved();
    } catch (e) {
      setBusy(false);
      setError(messageOf(e, "That password wasn’t accepted."));
    }
  };

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy}>
      <div className="modal settings-users__form">
        <h2 className="host-remove__title">Confirm it’s you</h2>
        <p className="host-remove__text">
          Connecting or disconnecting an account changes how you sign in from now on, so it asks for
          your password even though you’re already signed in.
        </p>
        {error && (
          <div className="login-card__error" role="alert"><Icon name="alert-triangle" size={14} />{error}</div>
        )}
        {!hasPassword ? (
          <div className="settings-users__note">
            <Icon name="info" size={14} />
            This account has no KGSM password. Sign out and sign in again — arriving is itself the
            confirmation — or ask an administrator to set one.
          </div>
        ) : (
          <>
            <label className="login-form__label" htmlFor="reauth-password">Password</label>
            <input id="reauth-password" className="login-form__input" type="password" value={password}
              autoComplete="current-password" autoFocus disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && password) submit(); }} />
          </>
        )}
        <div className="settings-users__actions">
          <span style={{ flex: 1 }} />
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {hasPassword && (
            <button className="host-btn host-btn--primary" onClick={submit} disabled={busy || !password}>
              {busy ? "Checking…" : "Confirm"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Disconnecting also ends the sessions that account established, which is the point of it and is
// worth saying before rather than after.
function ConfirmDisconnectDialog({ identity, onClose, onConfirm }) {
  return (
    <Modal onClose={onClose}>
      <div className="modal host-remove">
        <h2 className="host-remove__title">Disconnect {label(identity.provider)}?</h2>
        <p className="host-remove__text">
          {identity.label || identity.handle} will no longer sign you in to this host, and any
          session it started ends now. You can connect it again later.
        </p>
        <div className="settings-users__actions">
          <span style={{ flex: 1 }} />
          <button className="host-btn host-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="host-btn host-btn--danger" onClick={onConfirm}>Disconnect</button>
        </div>
      </div>
    </Modal>
  );
}

// What the callback reported, in words. The codes are the backend's; anything unrecognised is shown
// as the honest generic rather than guessed at.
function linkErrorText(code) {
  if (code === "identity_taken") return "That account is already connected to a different KGSM account.";
  if (code === "invalid_state") return "That took too long, or the request didn’t validate. Try again.";
  if (code === "auth_provider_error") return "Couldn’t reach the identity provider. Try again.";
  if (code === "login_required") return "The sign-in didn’t complete. Try again.";
  return "Couldn’t connect that account.";
}

function rel(ts) {
  if (!ts) return "—";
  try { return fmtRelative(parseTs(ts)); } catch { return "—"; }
}

function messageOf(e, fallback) {
  return (e && e.userMessage) || fallback;
}

export { SettingsIdentities };

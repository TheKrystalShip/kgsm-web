import React from "react";
import { Icon } from "../components/Icon.jsx";
import { Modal } from "../components/Modal.jsx";
import { Select } from "../components/Select.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { api } from "../lib/apiClient.js";
import { sessionStore } from "../lib/sessionStore.js";

// SettingsUsers — this host's KGSM accounts.
//
// An account is the primary identity object: it exists on its own, carries the tier, and an
// external provider (Discord today, others later) is a credential attached to it rather than the
// source of it. So this screen is where authority on a host is decided — the only place a tier ever
// changes — which is why it is on the critical path and not a convenience.
//
// Scoped to ONE host, deliberately, and not rolled up across the cluster: accounts are per-host, so
// a merged list would imply an account exists somewhere it does not. The picker names which host is
// being administered whenever there is more than one.
//
// Read straight from `api.users(host)` rather than through a store: accounts change only when
// somebody changes them here, and a cached list is a list that can be stale about who may do what.
// Each write re-reads.

const TIERS = ["viewer", "operator", "admin"];
const TIER_LABEL = { none: "No access", viewer: "Viewer", operator: "Operator", admin: "Admin" };
const STATUS_LABEL = { active: "Active", pending: "Awaiting approval", disabled: "Disabled" };

function SettingsUsers() {
  // Every host this browser holds a live admin session on. A viewer sees nothing here, because the
  // endpoints are admin-gated and rendering a table that 403s is worse than not offering it.
  const hosts = React.useMemo(
    () => sessionStore.readRegistry()
      .filter((h) => h && h.id && sessionStore.isLive(h.id) && sessionStore.tierOf(h.id) === "admin")
      .map((h) => ({ id: h.id, name: h.name || h.id })),
    []);

  const [hostId, setHostId] = React.useState(() => (hosts[0] ? hosts[0].id : null));
  const [rows, setRows] = React.useState(null);          // null = not loaded yet
  const [error, setError] = React.useState(null);
  const [editing, setEditing] = React.useState(null);    // a user row, or "new"

  const reload = React.useCallback(() => {
    if (!hostId) return Promise.resolve();
    setError(null);
    return api.users(hostId).list().then(
      (list) => setRows(list),
      (e) => { setRows([]); setError(messageOf(e, "Couldn’t load the accounts on this host.")); });
  }, [hostId]);

  React.useEffect(() => { reload(); }, [reload]);

  if (!hosts.length) return null;

  const activeAdmins = (rows || []).filter((u) => u.status === "active" && u.tier === "admin").length;

  return (
    <SettingsSection icon="users" title="Accounts"
      sub="Who can sign in to this host, and what they may do.">
      {hosts.length > 1 && (
        <SettingsRow icon="server" title="Host" sub="Accounts are per-host — each one keeps its own.">
          <Select value={hostId || ""} onChange={(e) => setHostId(e.target.value)}>
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
        </SettingsRow>
      )}

      {error && (
        <div className="login-card__error" role="alert">
          <Icon name="alert-triangle" size={14} />{error}
        </div>
      )}

      {rows === null ? (
        <div className="settings-users__empty">Loading…</div>
      ) : rows.length === 0 && !error ? (
        <div className="settings-users__empty">No accounts on this host yet.</div>
      ) : (
        <div className="settings-users">
          {rows.map((u) => (
            <button key={u.id} type="button" className="settings-users__row" onClick={() => setEditing(u)}>
              <span className="settings-users__avatar">{(u.displayName || u.username || "?")[0].toUpperCase()}</span>
              <span className="settings-users__who">
                <span className="settings-users__name">{u.displayName || u.username}</span>
                <span className="settings-users__handle">
                  {u.username}
                  {u.identities && u.identities.length > 0 && (
                    <> · {u.identities.map((i) => i.provider).join(", ")}</>
                  )}
                  {!u.hasPassword && u.identities && u.identities.length === 0 && <> · no way to sign in</>}
                </span>
              </span>
              <span className={"settings-users__tier settings-users__tier--" + u.tier}>{TIER_LABEL[u.tier] || u.tier}</span>
              <span className={"settings-users__status settings-users__status--" + u.status}>{STATUS_LABEL[u.status] || u.status}</span>
              <Icon name="chevron-right" size={14} />
            </button>
          ))}
        </div>
      )}

      <div className="settings-foot">
        <button className="fb-editor__btn" onClick={() => setEditing("new")} disabled={!hostId}>
          Add an account
        </button>
      </div>

      {editing && (
        <UserModal
          hostId={hostId}
          user={editing === "new" ? null : editing}
          // The backend refuses to leave a host with no way in, and says so with `last_admin`. The
          // modal is told the count so it can explain BEFORE somebody tries, rather than only after.
          isLastActiveAdmin={editing !== "new" && editing.status === "active"
            && editing.tier === "admin" && activeAdmins <= 1}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
    </SettingsSection>
  );
}

// Create or edit one account. One modal for both, because the fields are the same and a separate
// "create" form is how the two drift apart.
function UserModal({ hostId, user, isLastActiveAdmin, onClose, onSaved }) {
  const creating = !user;
  const [form, setForm] = React.useState(() => ({
    username: user ? user.username : "",
    displayName: user ? user.displayName : "",
    tier: user ? user.tier : "viewer",
    status: user ? user.status : "active",
    password: "",
  }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const users = api.users(hostId);
      if (creating) {
        await users.create({
          username: form.username.trim(),
          displayName: form.displayName.trim() || form.username.trim(),
          tier: form.tier,
          status: form.status,
          password: form.password || undefined,
        });
      } else {
        await users.update(user.id, {
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          tier: form.tier,
          status: form.status,
        });
        if (form.password) await users.setPassword(user.id, form.password);
      }
      onSaved();
    } catch (e) {
      setBusy(false);
      setError(messageOf(e, "Couldn’t save this account."));
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.users(hostId).remove(user.id);
      onSaved();
    } catch (e) {
      setBusy(false);
      setError(messageOf(e, "Couldn’t delete this account."));
    }
  };

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy}>
      <div className="modal settings-users__form">
        <h2 className="host-remove__title">{creating ? "Add an account" : form.username}</h2>
        {error && (
          <div className="login-card__error" role="alert"><Icon name="alert-triangle" size={14} />{error}</div>
        )}
        {isLastActiveAdmin && (
          <div className="settings-users__note">
            <Icon name="info" size={14} />
            This is the only active admin on this host. Give someone else the admin tier before
            changing or removing it.
          </div>
        )}

        <label className="login-form__label" htmlFor="user-username">Username</label>
        <input id="user-username" className="login-form__input" value={form.username}
          autoCapitalize="off" spellCheck="false" disabled={busy} onChange={set("username")} />

        <label className="login-form__label" htmlFor="user-display">Display name</label>
        <input id="user-display" className="login-form__input" value={form.displayName}
          disabled={busy} onChange={set("displayName")} />

        <label className="login-form__label" htmlFor="user-tier">Tier</label>
        <Select id="user-tier" value={form.tier} disabled={busy} onChange={set("tier")}>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </Select>

        <label className="login-form__label" htmlFor="user-status">Status</label>
        <Select id="user-status" value={form.status} disabled={busy} onChange={set("status")}>
          <option value="active">Active</option>
          <option value="pending">Awaiting approval</option>
          {!creating && <option value="disabled">Disabled</option>}
        </Select>

        <label className="login-form__label" htmlFor="user-password">
          {creating ? "Password (optional)" : "Set a new password"}
        </label>
        <input id="user-password" className="login-form__input" type="password" value={form.password}
          autoComplete="new-password" placeholder={creating ? "Leave empty for no password yet" : "Leave empty to keep the current one"}
          disabled={busy} onChange={set("password")} />
        {!creating && user.identities && user.identities.length > 0 && (
          <div className="settings-users__linked">
            Also signs in with: {user.identities.map((i) => i.handle).join(", ")}
          </div>
        )}

        <div className="settings-users__actions">
          {!creating && (
            <button className="host-btn host-btn--danger" onClick={remove} disabled={busy}>Delete</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={save}
            disabled={busy || !form.username.trim()}>
            {busy ? "Saving…" : creating ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The backend's own message when it wrote one, because it is more specific than anything guessable
// here — "that username is already taken", "that is the only active admin". Falls back only when
// there is nothing to show.
function messageOf(e, fallback) {
  return (e && e.userMessage) || fallback;
}

export { SettingsUsers };

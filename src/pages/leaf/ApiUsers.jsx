// ApiUsers — the API leaf's Users tab: this node's KGSM accounts.
//
// An account is the primary identity object: it exists on its own, carries the tier, and an
// external provider (Discord today, others later) is a credential attached to it rather than the
// source of it. So this screen is where authority on a node is decided — the only place a tier ever
// changes.
//
// It lives on the API leaf because kgsm-api is what holds the account store: the accounts are that
// service's state, administered where the service is, alongside its logs and its configuration.
// A person's own settings page answers "who am I and how do I sign in"; this answers "who may do
// what here", which is a different question about a different subject.
//
// Scoped to ONE node by the page's own route, and not rolled up across the cluster: accounts are
// per-node, so a merged list would imply an account exists somewhere it does not.
//
// Read straight from `api.users(host)` rather than through a store: accounts change only when
// somebody changes them here, and a cached list is a list that can be stale about who may do what.
// Each write re-reads.

import React from "react";

import { ConfirmRevokeDialog } from "../../components/ConfirmRevokeDialog.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { Select } from "../../components/Select.jsx";
import { SettingsSection } from "../../components/settings-primitives.jsx";
import { api } from "../../lib/apiClient.js";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { sessionStore } from "../../lib/sessionStore.js";

const TIERS = ["viewer", "operator", "admin"];
const TIER_LABEL = { none: "No access", viewer: "Viewer", operator: "Operator", admin: "Admin" };
const STATUS_LABEL = { active: "Active", pending: "Awaiting approval", disabled: "Disabled" };

function ApiUsers({ hostId }) {
  // The leaf page's own gate is the aggregate one — admin on ANY node reaches it — so the tier that
  // matters here is the one held on THIS node. Checked before asking, because a table that 403s
  // tells the reader less than a sentence naming what they'd need.
  const admin = !!hostId && sessionStore.isLive(hostId) && sessionStore.tierOf(hostId) === "admin";

  const [rows, setRows] = React.useState(null);          // null = not loaded yet
  const [error, setError] = React.useState(null);
  const [editing, setEditing] = React.useState(null);    // a user row, or "new"

  const reload = React.useCallback(() => {
    if (!hostId || !admin) return Promise.resolve();
    setError(null);
    return api.users(hostId).list().then(
      (list) => setRows(list),
      (e) => { setRows([]); setError(messageOf(e, "Couldn’t load the accounts on this node.")); });
  }, [hostId, admin]);

  React.useEffect(() => { reload(); }, [reload]);

  // Approve in place: set the account active at viewer. Anything more is a tier decision, which is
  // what the row's own editor is for.
  const [approving, setApproving] = React.useState(null);
  const approve = (u) => {
    setApproving(u.id);
    setError(null);
    api.users(hostId).update(u.id, { status: "active", tier: u.tier === "none" ? "viewer" : u.tier }).then(
      () => reload().then(() => setApproving(null)),
      (e) => { setError(messageOf(e, "Couldn’t approve that account.")); setApproving(null); });
  };

  if (!admin) {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">You don’t have access to this</div>
          <div className="chat-brief__empty-sub">
            Managing accounts needs the administrator role on this node.
          </div>
        </div>
      </div>
    );
  }

  const activeAdmins = (rows || []).filter((u) => u.status === "active" && u.tier === "admin").length;
  const waiting = (rows || []).filter((u) => u.status === "pending").length;
  // People waiting first. They are the only rows on this screen that need something done, and a
  // node with twenty accounts would otherwise bury them.
  const ordered = [...(rows || [])].sort(
    (a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));

  return (
    <SettingsSection icon="users" title="Accounts"
      meta="Who can sign in to this node, and what they may do.">
      {error && (
        <div className="login-card__error" role="alert">
          <Icon name="alert-triangle" size={14} />{error}
        </div>
      )}

      {waiting > 0 && (
        <div className="settings-users__waiting">
          <Icon name="hourglass" size={14} />
          {waiting === 1
            ? "1 person is waiting for approval. Until you approve them they can sign in and see nothing."
            : `${waiting} people are waiting for approval. Until you approve them they can sign in and see nothing.`}
        </div>
      )}

      {rows === null ? (
        <div className="settings-users__empty">Loading…</div>
      ) : rows.length === 0 && !error ? (
        <div className="settings-users__empty">No accounts on this node yet.</div>
      ) : (
        <div className="settings-users">
          {ordered.map((u) => (
            <div key={u.id} className="settings-users__row">
              <button type="button" className="settings-users__open" onClick={() => setEditing(u)}>
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
              {u.status === "pending" && (
                /* One gesture, because this is the whole of what an admin does on this screen most
                   days. It grants VIEWER and nothing more: approving somebody is deciding they
                   belong here, and deciding what they may do is a second, deliberate act. */
                <button type="button" className="settings-users__approve"
                  disabled={approving === u.id}
                  onClick={() => approve(u)}>
                  {approving === u.id ? "Approving…" : "Approve"}
                </button>
              )}
            </div>
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
          // The backend refuses to leave a node with no way in, and says so with `last_admin`. The
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
            This is the only active admin on this node. Give someone else the admin tier before
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

        {!creating && <UserSessions hostId={hostId} user={user} disabled={busy} />}

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

// Where this account is signed in, and ending any of it — inside the modal for the person it
// belongs to, so an administrator acts on somebody they have already named. The alternative was a
// lookup box that took a raw `usr_…` id, which asked an admin to know an opaque string by heart to
// perform the most consequential thing on this screen.
//
// Signing somebody out is deliberately NOT the same act as disabling them: the sessions end and the
// account is untouched, so they can sign straight back in. The confirmation says so, because an
// admin reaching for this during an incident is usually reaching for the other one.
function UserSessions({ hostId, user, disabled }) {
  const [rows, setRows] = React.useState(null);   // null = not loaded
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);   // a sid, "all", or null
  const [confirm, setConfirm] = React.useState(null);
  const name = user.displayName || user.username;

  const reload = React.useCallback(() => {
    setError(null);
    return api.sessions(hostId).list(user.id).then(
      (s) => setRows((s && s.sessions) || []),
      (e) => { setRows([]); setError(messageOf(e, "Couldn’t load their sessions.")); });
  }, [hostId, user.id]);

  React.useEffect(() => { reload(); }, [reload]);

  const run = () => {
    if (!confirm) return;
    const all = confirm.mode === "admin-all";
    setBusy(all ? "all" : confirm.sid);
    const call = all
      ? api.sessions(hostId).revokeUser(user.id)
      : api.sessions(hostId).revokeSid(confirm.sid);
    call.then(
      () => { setConfirm(null); setBusy(null); reload(); },
      (e) => { setBusy(null); setError(messageOf(e, "Couldn’t end that session.")); });
  };

  return (
    <div className="settings-users__sessions">
      <div className="settings-users__sessions-head">
        <span>Signed in on</span>
        {rows && rows.length > 0 && (
          <button type="button" className="settings-users__sessions-all"
            disabled={disabled || busy != null}
            onClick={() => setConfirm({ mode: "admin-all" })}>
            {busy === "all" ? "Signing out…" : "Sign out everywhere"}
          </button>
        )}
      </div>

      {error && (
        <div className="login-card__error" role="alert"><Icon name="alert-triangle" size={14} />{error}</div>
      )}

      {rows === null && !error && <div className="settings-users__empty">Loading…</div>}
      {rows !== null && rows.length === 0 && !error && (
        <div className="settings-users__empty">No active sessions.</div>
      )}

      {(rows || []).map((s) => (
        <div key={s.sid} className="settings-users__session">
          <span className="settings-users__session-device">
            {s.userAgent && String(s.userAgent).trim() ? s.userAgent : "Unknown device"}
          </span>
          <span className="settings-users__session-when">last active {rel(s.lastSeen)}</span>
          <button type="button" className="settings-link__btn"
            disabled={disabled || busy != null}
            onClick={() => setConfirm({ mode: "admin-one", sid: s.sid })}>
            {busy === s.sid ? "Ending…" : "End"}
          </button>
        </div>
      ))}

      {confirm && (
        <ConfirmRevokeDialog
          mode={confirm.mode}
          targetName={name}
          busy={busy != null}
          onClose={() => setConfirm(null)}
          onConfirm={run} />
      )}
    </div>
  );
}

function rel(ts) {
  if (!ts) return "—";
  try { return fmtRelative(parseTs(ts)); } catch { return "—"; }
}

// The backend's own message when it wrote one, because it is more specific than anything guessable
// here — "that username is already taken", "that is the only active admin". Falls back only when
// there is nothing to show.
function messageOf(e, fallback) {
  return (e && e.userMessage) || fallback;
}

export { ApiUsers };

import React from "react";
import { Icon } from "../components/Icon.jsx";
import { Modal } from "../components/Modal.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { api } from "../lib/apiClient.js";
import { fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";
import { isAdminAnywhere } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";

// SettingsSessions.jsx — "Active sessions" + "Recent logins" (Settings page),
// plus an admin-only "Manage user sessions" section.
//
// Self-service session management against the root-routed kgsm-api session
// endpoints (api.sessions(hostId), Slice 1): list every active session for
// this user across devices, revoke one or all, and show a read-only
// recent-login history from /api/v1/me's recentLogins. Component-local state
// only (no new store) — mirrors DiscordPage.jsx's DiscordLiveConfig fetch
// pattern. A revoke that includes the caller's OWN current session (a single
// revoke on the "This device" row, or "Log out all", which always includes
// it) proactively calls onLogout right after the 204: the backend has already
// revoked server-side, so the app clears its local session and returns to the
// login gate instead of sitting on a now-dead token.
//
// "Active sessions" is a CLUSTER view: one login grants access everywhere and
// each node mints its own session, so the list is a symmetric fan-out over every
// node this browser holds a LIVE session on (sessionStore's registry + isLive),
// with no node treated as primary. Sessions and recent logins are both unions
// over whatever answered; a node that fails drops its rows and earns an honest
// partial note rather than silently shrinking the list. Every current:true row
// across those nodes is the SAME browser, so they collapse into one "This
// device" row whose "Log out" revokes the caller's own session on each node.
//
// A single-row revoke goes to the node that row came from — the row carries its
// own node. "Log out all" is cluster-wide and the backend fans session.revoke to
// peers itself, so any live node performs it.
//
// The admin section is gated on the aggregate persona rule (admin on ANY node);
// it looks up ANOTHER user's sessions by id and can revoke one or all of them
// through one node. It never touches onLogout — an admin revoking someone else's
// session never signs the admin out; the backend enforces the tier check
// server-side, this gate is UX only.

// Guard timestamp formatting against null/unparsable values — never throw,
// never fabricate a value; render the honest placeholder instead.
function fmtGuard(ts, fn) {
  if (!ts) return "—";
  try { return fn(parseTs(ts)); } catch { return "—"; }
}

function deviceLabel(text) {
  return text && String(text).trim() ? text : "Unknown device";
}

// A tiny, non-authoritative heuristic — just picks a nicer icon. Never used
// for anything but glyph choice.
function deviceIcon(userAgent) {
  return /mobile|android|iphone|ipad/i.test(userAgent || "") ? "smartphone" : "monitor";
}

// The destructive-confirm dialog, shaped like RemoveHostDialog
// (src/pages/diagnostics/diagHostCards.jsx) — reuses its `.host-remove` /
// `.host-btn` classes rather than adding a parallel set.
//
// Four variants, all sharing the same markup:
//   "one"       — self-service, revoke the caller's own single session
//   "all"       — self-service, "Log out all" (always includes the caller)
//   "admin-one" — admin, revoke ONE of another user's sessions
//   "admin-all" — admin, log another user out of every device
// The admin variants take `targetUserId` so the copy names who's affected —
// never a silent/anonymous destructive action.
function ConfirmRevokeDialog({ mode, targetUserId, busy, onConfirm, onClose }) {
  const isAdmin = mode === "admin-one" || mode === "admin-all";
  const isAll = mode === "all" || mode === "admin-all";

  let title = "Log out this device?";
  let text = "This ends the session on that device. If it's your current device, you'll need to sign in again.";
  if (mode === "all") {
    title = "Log out everywhere?";
    text = "This ends every active session on every device, including this one. You'll need to sign in again.";
  } else if (mode === "admin-one") {
    title = "Revoke this session for user " + targetUserId + "?";
    text = "This ends that one session for user " + targetUserId + ". Their other devices stay signed in.";
  } else if (mode === "admin-all") {
    title = "Log user " + targetUserId + " out of every device?";
    text = "This ends every active session for user " + targetUserId + ", on every device.";
  }

  return (
    <Modal onClose={busy ? undefined : onClose} canClose={!busy}>
      <div className="modal host-remove">
        <div className="host-remove__icon host-remove__icon--danger">
          <Icon name="log-out" size={20} />
        </div>
        <h2 className="host-remove__title">{title}</h2>
        <p className="host-remove__text">{text}</p>
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--danger" onClick={onConfirm} disabled={busy}>
            <Icon name="log-out" size={14} /> {busy ? (isAdmin ? "Working…" : "Logging out…") : (isAdmin && isAll ? "Log out" : isAdmin ? "Revoke" : "Log out")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SettingsSessions({ onLogout }) {
  // Your sessions are a CLUSTER fact: one login grants access everywhere and
  // each node mints its own session, so this page fans out over every node the
  // browser holds a live session on and merges. No node is "primary" — none of
  // them is the one you are "on".
  //
  // `hostId` is the ENTRY POINT for cluster-wide mutations only (revoke-all
  // propagates over the backend's own bus, so any live node performs it for the
  // whole cluster). It is not a scope, and nothing is read through it alone.
  const liveNodes = sessionStore.readRegistry().filter(h => h && h.id && sessionStore.isLive(h.id));
  const hostId = (liveNodes[0] && liveNodes[0].id) || null;
  const nodeKey = liveNodes.map(h => h.id).join(",");

  const [sessions, setSessions] = React.useState([]);
  const [otherNote, setOtherNote] = React.useState(null); // honest partial-fan-out-failure note, or null
  const [liveNodeCount, setLiveNodeCount] = React.useState(1); // nodes this browser fetched sessions from
  const [recentLogins, setRecentLogins] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(null);       // sid being revoked, "all", "aggregated", or null
  const [confirm, setConfirm] = React.useState(null); // { mode: "one"|"all", sid?, nodeId?, aggregated?, nodeIds? } | null

  // Admin cross-user revoke — a distinct, tier-gated section with its own
  // state so it never interferes with the self-service list/dialog above.
  // Real gate (the backend enforces the same check server-side; this is UX).
  // Aggregate, per the persona rule: admin on ANY node reaches the section, and
  // the node it acts through enforces its own tier.
  const isAdmin = isAdminAnywhere();
  const [targetUserId, setTargetUserId] = React.useState("");
  const [adminSessions, setAdminSessions] = React.useState([]);
  const [adminLoading, setAdminLoading] = React.useState(false);
  const [adminErr, setAdminErr] = React.useState(null);
  const [adminLookedUp, setAdminLookedUp] = React.useState(false);
  const [adminNotice, setAdminNotice] = React.useState(null);
  const [adminBusy, setAdminBusy] = React.useState(null);       // sid being revoked, "all", or null
  const [adminConfirm, setAdminConfirm] = React.useState(null); // { mode: "admin-one"|"admin-all", sid?, userId } | null

  React.useEffect(() => {
    if (!hostId) { setLoading(false); return undefined; }
    let live = true;
    setLoading(true);
    setErr(null);
    setOtherNote(null);

    // One symmetric fan-out over every live node. Each node reports its own
    // sessions and its own recent logins (a login happens at the node you
    // authenticated against and is vouched onward), so both are unions across
    // whatever answered. A node that fails drops its rows and earns an honest
    // note — the list never silently shrinks.
    setLiveNodeCount(liveNodes.length);
    Promise.allSettled(liveNodes.map(h =>
      Promise.all([api.sessions(h.id).list(), api.host(h.id).get("/me")])
        .then(([s, me]) => ({ node: h, rows: (s && s.sessions) || [], logins: (me && me.recentLogins) || [] }))
    )).then(results => {
      if (!live) return;
      const ok = [];
      let failed = 0;
      results.forEach(r => { if (r.status === "fulfilled") ok.push(r.value); else failed += 1; });
      setSessions(ok.flatMap(({ node, rows }) =>
        rows.map(row => ({ ...row, nodeId: node.id, nodeName: node.name || node.id }))
      ));
      setRecentLogins(
        ok.flatMap(({ logins }) => logins)
          .sort((a, b) => new Date(b.at || b.time || 0) - new Date(a.at || a.time || 0))
      );
      setOtherNote(failed > 0
        ? failed + " of " + liveNodes.length + " node" + (liveNodes.length > 1 ? "s" : "") + " didn't respond — showing partial results."
        : null);
      // Every node failing is a real error, not a partial.
      setErr(ok.length === 0 ? "Couldn't load sessions." : null);
      setLoading(false);
    });

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodeKey IS the identity of liveNodes; depending on the array itself would refetch every render
  }, [nodeKey]);

  if (!hostId) {
    return (
      <SettingsSection icon="monitor-smartphone" title="Active sessions">
        <SettingsRow icon="plug" title="No host connected" sub="Connect a host to manage your sessions." />
      </SettingsSection>
    );
  }

  const runRevoke = () => {
    if (!confirm) return;
    const isAll = confirm.mode === "all";

    if (confirm.aggregated) {
      // The collapsed "This browser" row (only reachable when liveNodeCount >
      // 1 — see the rendering below): log this device out of every node it's
      // live on, one best-effort self-revoke per node, then the same
      // proactive onLogout as any other current-session revoke.
      const ids = (confirm.nodeIds && confirm.nodeIds.length) ? confirm.nodeIds : [hostId];
      setBusy("aggregated");
      Promise.allSettled(ids.map(id => api.sessions(id).revoke({}))).then(() => {
        setConfirm(null);
        setBusy(null);
        onLogout();
      });
      return;
    }

    // Log out all always includes the caller's own session; a single revoke
    // is "current" only when it targets the row marked current:true.
    const revokesCurrent = isAll || sessions.some(s => s.sid === confirm.sid && s.current);
    // "Log out all" is cluster-wide and the backend fans session.revoke to peers
    // itself, so any live node performs it — no client-side fan-out. A
    // single-row revoke goes to the node that row came from: the row IS the
    // object being acted on, so it carries its own node.
    const targetNode = isAll ? hostId : (confirm.nodeId || hostId);
    setBusy(isAll ? "all" : confirm.sid);
    api.sessions(targetNode).revoke(isAll ? { all: true } : { sid: confirm.sid }).then(
      () => {
        setConfirm(null);
        setBusy(null);
        if (revokesCurrent) { onLogout(); return; }
        setSessions(prev => prev.filter(s => s.sid !== confirm.sid));
      },
      (e) => {
        setBusy(null);
        setErr((e && e.userMessage) || "Couldn't log out that session.");
      },
    );
  };

  const hasSessions = sessions.length > 0;
  // Only meaningful when liveNodeCount > 1 (cheap to always compute).
  const currentRows = sessions.filter(s => s.current);
  const otherDeviceRows = sessions.filter(s => !s.current);
  const currentNodeIds = [...new Set(currentRows.map(s => s.nodeId))];
  const currentNodeNames = [...new Set(currentRows.map(s => s.nodeName || s.nodeId))];

  // A login row is only useful when it carries the device (user-agent) it was
  // made from — a bare timestamp with no device tells the user nothing. Drop
  // those rather than render an "Unknown device" placeholder for them.
  const shownLogins = recentLogins.filter(r => r && r.device && String(r.device).trim());

  // Admin: look up another user's sessions by id. Trims + ignores empty —
  // never fires a lookup for a blank id.
  const runAdminLookup = () => {
    const uid = targetUserId.trim();
    if (!uid) return;
    setAdminLoading(true);
    setAdminErr(null);
    setAdminNotice(null);
    api.sessions(hostId).list(uid).then(
      (s) => {
        setAdminSessions((s && s.sessions) || []);
        setAdminLoading(false);
        setAdminLookedUp(true);
      },
      (e) => {
        setAdminErr((e && e.userMessage) || "Couldn't load sessions for that user.");
        setAdminSessions([]);
        setAdminLoading(false);
        setAdminLookedUp(true);
      },
    );
  };

  // Admin: revoke one session (admin-one) or every session for the target
  // user (admin-all). Never proactively signs the ADMIN out — that only
  // happens on the self-service path above, whatever userId is targeted here.
  const runAdminRevoke = () => {
    if (!adminConfirm) return;
    const isAllMode = adminConfirm.mode === "admin-all";
    setAdminBusy(isAllMode ? "all" : adminConfirm.sid);
    const call = isAllMode
      ? api.sessions(hostId).revokeUser(adminConfirm.userId)
      : api.sessions(hostId).revokeSid(adminConfirm.sid);
    call.then(
      () => {
        setAdminBusy(null);
        setAdminConfirm(null);
        if (isAllMode) {
          setAdminSessions([]);
          setAdminNotice("Logged out user " + adminConfirm.userId + " everywhere.");
        } else {
          setAdminSessions(prev => prev.filter(s => s.sid !== adminConfirm.sid));
        }
      },
      (e) => {
        setAdminBusy(null);
        setAdminErr((e && e.userMessage) || "Couldn't complete that action.");
      },
    );
  };

  return (
    <>
      <SettingsSection
        icon="monitor-smartphone"
        title="Active sessions"
        action={hasSessions && (
          <button className="settings-btn-danger" onClick={() => setConfirm({ mode: "all" })} disabled={busy != null}>
            Log out all
          </button>
        )}
      >
        {err && (
          <div className="settings-notice settings-notice--danger">
            <Icon name="alert-triangle" size={13} /> {err}
          </div>
        )}
        {!loading && otherNote && (
          <div className="settings-notice">
            <Icon name="alert-triangle" size={13} /> {otherNote}
          </div>
        )}
        {loading && <div className="settings-notice">Loading…</div>}
        {!loading && !err && !hasSessions && <div className="settings-notice">No active sessions.</div>}

        {/* N=1 (no other live-session node): the exact single-host row list,
            untouched — same order, same fields, same revoke wiring as before
            this page was cluster-aware. */}
        {!loading && liveNodeCount <= 1 && sessions.map(s => (
          <SettingsRow
            key={s.sid}
            icon={deviceIcon(s.userAgent)}
            title={
              <>
                <span className="settings-session__device">{deviceLabel(s.userAgent)}</span>
                {s.current && <span className="settings-session__current">This device</span>}
              </>
            }
            sub={
              "Signed in " + fmtGuard(s.created, d => fmtRelative(d)) +
              " · last active " + fmtGuard(s.lastSeen, d => fmtRelative(d)) +
              " · expires " + fmtGuard(s.expires, fmtTime)
            }
          >
            <button className="settings-btn-danger" onClick={() => setConfirm({ mode: "one", sid: s.sid, nodeId: s.nodeId })} disabled={busy != null}>
              {busy === s.sid ? "Logging out…" : "Log out"}
            </button>
          </SettingsRow>
        ))}

        {/* N>=2: every current:true row across live nodes is this same
            browser — collapsed into one row, revoked cluster-wide. Other
            devices render per-node, tagged with their node's name. */}
        {!loading && liveNodeCount > 1 && currentRows.length > 0 && (
          <SettingsRow
            key="__this-browser__"
            icon={deviceIcon(currentRows[0].userAgent)}
            title={
              <>
                <span className="settings-session__device">{deviceLabel(currentRows[0].userAgent)}</span>
                <span className="settings-session__current">This device</span>
              </>
            }
            sub={
              "Active on " + (currentNodeNames.length <= 3
                ? currentNodeNames.join(", ")
                : currentNodeNames.length + " nodes")
            }
          >
            <button
              className="settings-btn-danger"
              onClick={() => setConfirm({ mode: "one", aggregated: true, nodeIds: currentNodeIds })}
              disabled={busy != null}
            >
              {busy === "aggregated" ? "Logging out…" : "Log out"}
            </button>
          </SettingsRow>
        )}
        {!loading && liveNodeCount > 1 && otherDeviceRows.map(s => (
          <SettingsRow
            key={s.nodeId + ":" + s.sid}
            icon={deviceIcon(s.userAgent)}
            title={
              <>
                <span className="settings-session__device">{deviceLabel(s.userAgent)}</span>
                {/* No token/partial for a "node chip" exists yet (this file owns
                    JSX only) — a minimal inline layout nudge, no hardcoded color. */}
                <span className="settings-session__node" style={{ marginLeft: 8, opacity: 0.65, fontSize: "10.5px" }}>
                  {s.nodeName || s.nodeId}
                </span>
              </>
            }
            sub={
              "Signed in " + fmtGuard(s.created, d => fmtRelative(d)) +
              " · last active " + fmtGuard(s.lastSeen, d => fmtRelative(d)) +
              " · expires " + fmtGuard(s.expires, fmtTime)
            }
          >
            <button className="settings-btn-danger" onClick={() => setConfirm({ mode: "one", sid: s.sid, nodeId: s.nodeId })} disabled={busy != null}>
              {busy === s.sid ? "Logging out…" : "Log out"}
            </button>
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection icon="history" title="Recent logins">
        {shownLogins.length === 0 && <div className="settings-notice">No recent logins.</div>}
        {shownLogins.map((r, i) => (
          <SettingsRow
            key={(r && r.ts ? r.ts : "row") + "-" + i}
            icon={deviceIcon(r.device)}
            title={<span className="settings-session__device">{r.device}</span>}
            sub={fmtGuard(r && r.ts, fmtTime) + " · " + fmtGuard(r && r.ts, d => fmtRelative(d))}
          />
        ))}
      </SettingsSection>

      {isAdmin && (
        <SettingsSection
          icon="shield"
          title="Manage user sessions"
          action={targetUserId.trim() && (
            <button
              className="settings-btn-danger"
              onClick={() => setAdminConfirm({ mode: "admin-all", userId: targetUserId.trim() })}
              disabled={adminBusy != null}
            >
              Log out this user everywhere
            </button>
          )}
        >
          <SettingsRow
            icon="user-search"
            title="Look up a user's sessions"
            sub="Enter another user's id to view and revoke their active sessions. Admin only."
          >
            <input
              value={targetUserId}
              onChange={(e) => { setTargetUserId(e.target.value); setAdminNotice(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") runAdminLookup(); }}
              placeholder="User ID"
              spellCheck="false"
              className="settings-input settings-input--mono"
              style={{ width: 220 }}
            />
            <button className="settings-btn-ghost" onClick={runAdminLookup} disabled={!targetUserId.trim() || adminLoading}>
              {adminLoading ? "Looking up…" : "Look up sessions"}
            </button>
          </SettingsRow>

          {adminErr && (
            <div className="settings-notice settings-notice--danger">
              <Icon name="alert-triangle" size={13} /> {adminErr}
            </div>
          )}
          {adminNotice && (
            <div className="settings-notice settings-notice--ok">
              <Icon name="circle-check-big" size={13} /> {adminNotice}
            </div>
          )}
          {adminLookedUp && !adminLoading && !adminErr && adminSessions.length === 0 && (
            <div className="settings-notice">No active sessions for that user.</div>
          )}
          {adminSessions.map(s => (
            <SettingsRow
              key={s.sid}
              icon={deviceIcon(s.userAgent)}
              title={<span className="settings-session__device">{deviceLabel(s.userAgent)}</span>}
              sub={
                "Signed in " + fmtGuard(s.created, d => fmtRelative(d)) +
                " · last active " + fmtGuard(s.lastSeen, d => fmtRelative(d)) +
                " · expires " + fmtGuard(s.expires, fmtTime)
              }
            >
              <button
                className="settings-btn-danger"
                onClick={() => setAdminConfirm({ mode: "admin-one", sid: s.sid, userId: targetUserId.trim() })}
                disabled={adminBusy != null}
              >
                {adminBusy === s.sid ? "Revoking…" : "Revoke"}
              </button>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}

      {confirm && (
        <ConfirmRevokeDialog
          mode={confirm.mode}
          busy={busy != null}
          onClose={() => setConfirm(null)}
          onConfirm={runRevoke}
        />
      )}

      {adminConfirm && (
        <ConfirmRevokeDialog
          mode={adminConfirm.mode}
          targetUserId={adminConfirm.userId}
          busy={adminBusy != null}
          onClose={() => setAdminConfirm(null)}
          onConfirm={runAdminRevoke}
        />
      )}
    </>
  );
}

export { SettingsSessions };
export default SettingsSessions;

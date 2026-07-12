import React from "react";
import { Icon } from "../components/Icon.jsx";
import { Modal } from "../components/Modal.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { api } from "../lib/apiClient.js";
import { CONNECTIONS } from "../lib/config.js";
import { fmtRelative, fmtTime, parseTs } from "../lib/formatting.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useSelectedHostId } from "../lib/stores.js";

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
// "Active sessions" is cross-node aware (SPA-C1): it fans its session list
// across every node this browser holds a LIVE session on (sessionStore's
// registry + isLive), not just the selected/default host. Every current:true
// row across those nodes is the SAME browser, so they collapse into one "This
// device" row whose "Log out" revokes the caller's own session on each node.
// A device with only one live connection sees exactly the single-host list
// this page always rendered — the fan-out only changes anything at N>=2.
// "Log out all" still only targets the primary node; the backend fans
// session.revoke to peers server-side.
//
// The admin section (tier-gated, sessionStore.tierOf(hostId) === "admin")
// looks up ANOTHER user's sessions by id and can revoke one or all of them,
// scoped to the selected/primary host only — not fanned. It never touches
// onLogout — an admin revoking someone else's session never signs the admin
// out; the backend enforces the tier check server-side, this gate is UX only.

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
  // Resolve a concrete host the same way other in-page settings surfaces do
  // (DiscordLiveConfig): the selected host, falling back to the sole/first
  // connection. "all" (the fleet-wide pseudo-selection) isn't a real host.
  const sel = useSelectedHostId();
  const hostId = (sel && sel !== "all") ? sel : (CONNECTIONS[0] && CONNECTIONS[0].id) || null;

  // Active-sessions state is split by node: `primarySessions` is the
  // selected/default host, fetched exactly the way the single-host path
  // always has; `otherSessions` is every OTHER node the SPA holds a live
  // session on (SPA-C1 cluster fan-out — see the effect below). `sessions`
  // (defined after the early-return, next to `runRevoke`) is just their
  // union: at N=1 (no other live nodes) `otherSessions` stays `[]` forever,
  // so `sessions` === `primarySessions` and every downstream read (revoke,
  // rendering) behaves exactly as it did before this node was fanned.
  const [primarySessions, setPrimarySessions] = React.useState([]);
  const [otherSessions, setOtherSessions] = React.useState([]);
  const [otherNote, setOtherNote] = React.useState(null); // honest partial-fan-out-failure note, or null
  const [liveNodeCount, setLiveNodeCount] = React.useState(1); // nodes this browser fetched sessions from (primary + others)
  const [recentLogins, setRecentLogins] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(null);       // sid being revoked, "all", "aggregated", or null
  const [confirm, setConfirm] = React.useState(null); // { mode: "one"|"all", sid?, nodeId?, aggregated?, nodeIds? } | null

  // Admin cross-user revoke — a distinct, tier-gated section with its own
  // state so it never interferes with the self-service list/dialog above.
  // Real gate (the backend enforces the same check server-side; this is UX).
  const isAdmin = hostId ? sessionStore.tierOf(hostId) === "admin" : false;
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

    const registry = sessionStore.readRegistry();
    const nameOf = (id) => { const h = registry.find(r => r && r.id === id); return (h && h.name) || id; };

    // Primary fetch — unchanged from the single-host path. Drives `err`,
    // `loading` and `recentLogins`; at N=1 this is the ONLY fetch, so the
    // row rendering below (liveNodeCount <= 1 branch) reads straight off it.
    Promise.all([
      api.sessions(hostId).list(),
      api.host(hostId).get("/me"),
    ]).then(
      ([s, me]) => {
        if (!live) return;
        setPrimarySessions(((s && s.sessions) || []).map(row => ({ ...row, nodeId: hostId, nodeName: nameOf(hostId) })));
        setRecentLogins((me && me.recentLogins) || []);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setErr((e && e.userMessage) || "Couldn't load sessions.");
        setLoading(false);
      },
    );

    // Cluster fan-out (SPA-C1): every OTHER node this browser holds a live
    // session on (the primary is always covered above, regardless of its own
    // live-ness, so it's excluded here to avoid double-fetching it). A
    // per-node failure just drops that node's rows and adds an honest note —
    // it never blanks the primary list. At N=1 `others` is empty, this block
    // resolves synchronously, and liveNodeCount stays 1 — the untouched
    // single-host row-rendering branch is what actually renders.
    const others = registry.filter(h => h && h.id && h.id !== hostId && sessionStore.isLive(h.id));
    setLiveNodeCount(1 + others.length);

    if (others.length === 0) {
      setOtherSessions([]);
    } else {
      Promise.allSettled(others.map(h =>
        api.sessions(h.id).list().then(s => ({ node: h, rows: (s && s.sessions) || [] }))
      )).then(results => {
        if (!live) return;
        const ok = [];
        let failed = 0;
        results.forEach(r => { if (r.status === "fulfilled") ok.push(r.value); else failed += 1; });
        setOtherSessions(ok.flatMap(({ node, rows }) =>
          rows.map(row => ({ ...row, nodeId: node.id, nodeName: node.name || node.id }))
        ));
        setOtherNote(failed > 0
          ? failed + " of " + others.length + " other node" + (others.length > 1 ? "s" : "") + " didn't respond — showing partial results."
          : null);
      });
    }

    return () => { live = false; };
  }, [hostId]);

  if (!hostId) {
    return (
      <SettingsSection icon="monitor-smartphone" title="Active sessions">
        <SettingsRow icon="plug" title="No host connected" sub="Connect a host to manage your sessions." />
      </SettingsSection>
    );
  }

  // The union of every node's fetched rows. At N=1 `otherSessions` is always
  // `[]`, so this is exactly `primarySessions` — identical to the old single
  // `sessions` state.
  const sessions = [...primarySessions, ...otherSessions];

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
    // "Log out all" always targets the primary node (the backend fans
    // session.revoke to peers server-side — no client-side fan-out here). A
    // single-row revoke targets whichever node that row came from; at N=1
    // that's always the primary, so this is unchanged.
    const targetNode = isAll ? hostId : (confirm.nodeId || hostId);
    setBusy(isAll ? "all" : confirm.sid);
    api.sessions(targetNode).revoke(isAll ? { all: true } : { sid: confirm.sid }).then(
      () => {
        setConfirm(null);
        setBusy(null);
        if (revokesCurrent) { onLogout(); return; }
        if (targetNode === hostId) setPrimarySessions(prev => prev.filter(s => s.sid !== confirm.sid));
        else setOtherSessions(prev => prev.filter(s => s.sid !== confirm.sid));
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

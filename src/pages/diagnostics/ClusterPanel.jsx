// ClusterPanel — the Cluster page's federation panel: the local node plus the
// backend peer roster it federates with, rendered with honest membership/
// status/latency badges and admin peer CRUD. Pure presentational + narrow
// local state (add-form open/busy, per-row busy/confirm flags); all truth
// comes from clusterStore/hostsStore — nothing here is fabricated.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { api } from "../../lib/apiClient.js";
import { canOn } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { clusterStore, hostsStore } from "../../lib/stores.js";

// membership (a gossip/liveness axis) -> badge tone + label. Never invented —
// an unrecognized/missing value falls back to the honest "unknown" tone.
const MEMBERSHIP_META = {
  alive:   { tone: "ok",          label: "alive" },
  joining: { tone: "provisional", label: "joining" },
  suspect: { tone: "warn",        label: "suspect" },
  dead:    { tone: "danger",      label: "dead" },
  left:    { tone: "muted",       label: "left" },
  unknown: { tone: "muted",       label: "unknown" },
};

function membershipMeta(membership) {
  return MEMBERSHIP_META[membership] || MEMBERSHIP_META.unknown;
}

function MembershipBadge({ membership }) {
  const meta = membershipMeta(membership);
  return (
    <span className={"cluster-badge cluster-badge--" + meta.tone}>
      <span className="cluster-badge__dot"></span>
      {meta.label}
    </span>
  );
}

// status (a separate reachability axis) -> chip. `enabled === false` wins over
// status — a disabled peer is shown as disabled regardless of reachability.
function StatusChip({ status, enabled }) {
  if (enabled === false) {
    return (
      <span className="cluster-chip cluster-chip--disabled">
        <Icon name="power-off" size={11} strokeWidth={2.2} />disabled
      </span>
    );
  }
  if (status === "reachable") {
    return (
      <span className="cluster-chip cluster-chip--ok">
        <Icon name="wifi" size={11} strokeWidth={2.2} />reachable
      </span>
    );
  }
  if (status === "unreachable") {
    return (
      <span className="cluster-chip cluster-chip--danger">
        <Icon name="wifi-off" size={11} strokeWidth={2.2} />unreachable
      </span>
    );
  }
  return (
    <span className="cluster-chip cluster-chip--muted">
      <Icon name="circle-help" size={11} strokeWidth={2.2} />unknown
    </span>
  );
}

function AddPeerForm({ hostId, onDone, onCancel }) {
  const [url, setUrl] = React.useState("");
  const [nickname, setNickname] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const submit = () => {
    const u = url.trim();
    if (!u || busy) return;
    setBusy(true);
    setErr(null);
    api.peers(hostId).add(u, nickname.trim() || null)
      .then(() => { clusterStore.refresh(hostId); onDone(); })
      .catch((e) => setErr((e && e.message) || "Couldn't add that peer."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="cluster-addform">
      <label className="host-field">
        <span className="host-field__label">Peer URL</span>
        <input
          className="host-field__input host-field__input--mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://peer.example:8097"
          spellCheck="false"
          autoFocus
          disabled={busy}
        />
      </label>
      <label className="host-field">
        <span className="host-field__label">Nickname <span className="host-field__opt">optional</span></span>
        <input
          className="host-field__input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g. Frankfurt box"
          disabled={busy}
        />
      </label>
      {err && (
        <div className="cluster-addform__err">
          <Icon name="triangle-alert" size={13} />{err}
        </div>
      )}
      <div className="cluster-addform__foot">
        <button className="host-btn host-btn--ghost host-btn--sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="host-btn host-btn--primary host-btn--sm" onClick={submit} disabled={busy || !url.trim()}>
          <Icon name={busy ? "loader" : "plus"} size={13} strokeWidth={2.4} className={busy ? "cluster-spin" : ""} />
          {busy ? "Adding…" : "Add peer"}
        </button>
      </div>
    </div>
  );
}

function PeerRow({ node, hostId, canManage }) {
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const canAct = canManage && !!node.peerId;

  const toggle = () => {
    if (busy) return;
    setBusy(true);
    api.peers(hostId).setEnabled(node.peerId, !node.enabled)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const remove = () => {
    if (busy) return;
    setBusy(true);
    api.peers(hostId).remove(node.peerId)
      .then(() => clusterStore.refresh(hostId))
      .catch(() => {})
      .finally(() => { setBusy(false); setConfirming(false); });
  };

  return (
    <div className="cluster-row">
      <div className="cluster-row__id">
        <span className="cluster-row__label">{node.label}</span>
        <span className="cluster-row__nodeid">{node.nodeId}</span>
      </div>
      <MembershipBadge membership={node.membership} />
      <StatusChip status={node.status} enabled={node.enabled} />
      <span className="cluster-row__latency">{node.latencyMs != null ? node.latencyMs + " ms" : "—"}</span>
      <span className="cluster-row__url" title={node.clientUrl || ""}>{node.clientUrl || "—"}</span>
      {canAct && (
        <div className="cluster-row__actions">
          {confirming ? (
            <>
              <button className="host-btn host-btn--danger host-btn--sm" onClick={remove} disabled={busy}>Confirm remove</button>
              <button className="host-btn host-btn--ghost host-btn--sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            </>
          ) : (
            <>
              <button
                className="icon-btn"
                title={node.enabled ? "Disable peer" : "Enable peer"}
                aria-label={node.enabled ? "Disable peer" : "Enable peer"}
                onClick={toggle}
                disabled={busy}
              >
                <Icon name={node.enabled ? "power-off" : "power"} size={14} />
              </button>
              <button
                className="icon-btn"
                title="Remove peer"
                aria-label="Remove peer"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                <Icon name="trash-2" size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterPanel({ hostId }) {
  const st = useStore(clusterStore, (s) => s);
  const localHost = useStore(hostsStore, (s) => s.list).find((h) => h.id === hostId);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    if (hostId) clusterStore.refresh(hostId);
  }, [hostId]);

  if (!hostId) return null;

  const canManage = canOn("host.manage", hostId) && !!st.admin;
  const loading = (st.status === "loading" || st.status === "idle") && !st.everLoaded;

  return (
    <section className="cluster-panel">
      <div className="cluster-panel__head">
        <div>
          <h2 className="cluster-panel__title">Cluster</h2>
          <p className="cluster-panel__sub">This node and the peers it federates with.</p>
        </div>
        {canManage && !adding && (
          <button className="host-btn host-btn--ghost host-btn--sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} strokeWidth={2.4} />Add peer
          </button>
        )}
      </div>

      {canManage && adding && (
        <AddPeerForm hostId={hostId} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      )}

      {localHost && (
        <div className="cluster-row cluster-row--local">
          <div className="cluster-row__id">
            <span className="cluster-row__label">{localHost.name}</span>
            <span className="cluster-row__nodeid">{localHost.hostname}</span>
          </div>
          <span className="cluster-chip cluster-chip--local">
            <Icon name="map-pin" size={11} strokeWidth={2.2} />local
          </span>
        </div>
      )}

      {loading && (
        <div className="cluster-panel__loading">
          <Icon name="loader" size={14} className="cluster-spin" />Loading cluster…
        </div>
      )}

      {st.status === "error" && (
        <div className="cluster-panel__error">
          <Icon name="triangle-alert" size={14} />
          <span>Couldn't load cluster peers.</span>
          <button className="host-btn host-btn--ghost host-btn--sm" onClick={() => clusterStore.refresh(hostId)}>Retry</button>
        </div>
      )}

      {st.status === "ready" && st.nodes.length === 0 && (
        <div className="cluster-panel__empty">
          <Icon name="waypoints" size={22} />
          <div>This node isn't federated with any peers yet.</div>
        </div>
      )}

      {st.status === "ready" && st.nodes.length > 0 && (
        <div className="cluster-panel__rows">
          {st.nodes.map((n) => (
            <PeerRow key={n.nodeId} node={n} hostId={hostId} canManage={canManage} />
          ))}
        </div>
      )}
    </section>
  );
}

export { ClusterPanel };
export default ClusterPanel;

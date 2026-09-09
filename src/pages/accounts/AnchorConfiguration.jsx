// AnchorConfiguration — what the cluster's auth anchor can be configured with, changed where it is.
//
// A leaf's configuration is delivered by the node that runs it: kgsm-api scans that node's disk for
// descriptors and writes the change to a process on the same machine. An anchor is a peer of every
// node rather than something one of them hosts, and is reached by address from a browser that is
// usually nowhere near it — so the anchor answers for its own configuration, on the origin this page
// already talks to it on for accounts and sessions.
//
// The rows are the leaf configuration page's own (`LeafConfigRow`), because a component's settings
// read the same whoever is serving them: the same three provenance tiers, the same risk badges, the
// same reset. Only the transport differs, and that is the whole of what this file adds.
//
// Applying restarts the anchor. There is no canary and no rollback, and that is a property of the
// situation rather than a missing feature: the process that would watch the restart and put the old
// values back is the process being restarted. So the confirmation says what is about to happen, and
// the anchor's own log names the file to remove if it does not come back.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { SettingsSection } from "../../components/settings-primitives.jsx";
import { applyConfig, readConfig } from "../../lib/anchor.js";
import { clusterCredential, sessionStore } from "../../lib/sessionStore.js";
import { LeafConfigRow } from "../leafConfig/LeafConfigRow.jsx";
import { buildPayload, currentOf, dirtyFields, groupFields } from "../leafConfig/leafConfigHelpers.js";

function AnchorConfiguration({ anchor }) {
  const [config, setConfig] = React.useState(null);
  const [state, setState] = React.useState("loading");   // loading | ready | none | error
  const [error, setError] = React.useState(null);
  const [drafts, setDrafts] = React.useState({});
  const [resets, setResets] = React.useState(() => new Set());
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState(null);
  const [copyState, setCopyState] = React.useState(null);

  const load = React.useCallback(() => {
    if (!anchor || !sessionStore.isLive()) { setState("error"); setError("This browser holds no session for the anchor."); return; }
    setError(null);
    return readConfig(anchor, clusterCredential).then(
      (c) => { setConfig(c); setState("ready"); },
      (e) => {
        // 404 is the ordinary answer for an anchor that has shipped no descriptor, and it is a
        // different thing from a failure to ask.
        if (e && e.status === 404) { setState("none"); return; }
        setState("error");
        setError("Couldn’t read this anchor’s configuration.");
      });
  }, [anchor]);

  React.useEffect(() => { load(); }, [load]);

  const change = (key, value) => setDrafts((d) => ({ ...d, [key]: value }));
  const toggleReset = (key) => setResets((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const copy = (key, value) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(
      () => setCopyState({ key, ok: true }),
      () => setCopyState({ key, ok: false }));
  };

  const fields = (config && config.fields) || [];
  const pending = dirtyFields(fields, drafts, resets);

  const apply = () => {
    setBusy(true);
    setError(null);
    applyConfig(anchor, clusterCredential, buildPayload(fields, drafts, resets)).then(
      (res) => {
        setBusy(false);
        setConfirming(false);
        setDrafts({});
        setResets(new Set());
        setConfig(res.config);
        setOutcome(res);
      },
      (e) => {
        setBusy(false);
        setConfirming(false);
        setError(e && e.userMessage ? e.userMessage : "Couldn’t apply the change.");
      });
  };

  if (state === "none") {
    return (
      <SettingsSection icon="sliders-horizontal" title="Configuration">
        <div className="settings-users__empty">
          This anchor ships no config descriptor, so there is nothing to configure here.
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection icon="sliders-horizontal" title="Configuration"
      meta="What this anchor runs on. Applying restarts it.">
      {error && (
        <div className="login-card__error" role="alert"><Icon name="alert-triangle" size={14} />{error}</div>
      )}

      {outcome && (
        /* What happened, in the anchor's own terms. `restarting: false` is the one that matters:
           the change is written and is NOT in force, which reads nothing like a change being
           applied and must not be shown as one. */
        <div className={"settings-users__note" + (outcome.restarting ? "" : " settings-users__note--warn")} role="status">
          <Icon name={outcome.restarting ? "info" : "alert-triangle"} size={14} />
          {outcome.outcome === "unchanged"
            ? "Nothing changed — those are the values it was already running on."
            : outcome.restarting
              ? "Applied. The anchor is restarting to pick it up, so signing in may be unavailable for a moment."
              : "Written, but the anchor could not restart itself — the change is not in force until it does."}
        </div>
      )}

      {state === "loading" && <div className="settings-users__empty">Loading…</div>}

      {state === "ready" && config && (
        <>
          {!config.editable && config.editableReason && (
            <div className="settings-users__note">
              <Icon name="info" size={14} />{config.editableReason}
            </div>
          )}

          {groupFields(config, fields).map((group) => (
            <div key={group.id} className="lcf-group">
              <div className="chat-brief__head">{group.label}</div>
              {group.fields.map((f) => (
                <LeafConfigRow
                  key={f.key}
                  f={f}
                  editable={config.editable}
                  drafts={drafts}
                  resets={resets}
                  onChange={change}
                  onToggleReset={toggleReset}
                  onCopy={copy}
                  copyState={copyState} />
              ))}
            </div>
          ))}

          <div className="settings-foot">
            <button className="fb-editor__btn" disabled={!config.editable || pending.length === 0}
              onClick={() => setConfirming(true)}>
              {pending.length === 0 ? "No changes" : `Apply ${pending.length} change${pending.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {confirming && (
        <Modal onClose={busy ? undefined : () => setConfirming(false)} canClose={!busy}>
          <div className="modal lcf-review">
            <h2 className="host-remove__title">Apply and restart</h2>
            <div className="settings-users__note">
              <Icon name="alert-triangle" size={14} />
              The anchor restarts to pick this up. It holds every account in the cluster, so nobody
              can sign in while it is down — and nothing puts these values back on its behalf if it
              does not come back.
            </div>
            <div className="lcf-review__body">
              {pending.map((f) => (
                <div key={f.key} className="lcf-chg">
                  <div className="lcf-chg__t">
                    <span className="lcf-chg__label">{f.label}</span>
                    {f.envName && <code className="lcf-chg__env">{f.envName}</code>}
                  </div>
                  <div className="lcf-chg__d">
                    <span className="lcf-chg__from">{currentOf(f) ?? "—"}</span>
                    <Icon name="arrow-right" size={13} />
                    <span className="lcf-chg__to">
                      {resets.has(f.key) ? (f.floor ?? f.default ?? "—") : String(drafts[f.key])}
                    </span>
                    {resets.has(f.key) && <span className="lcf-chg__note">override removed</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="settings-users__actions">
              <span style={{ flex: 1 }} />
              <button className="host-btn host-btn--ghost" disabled={busy}
                onClick={() => setConfirming(false)}>Cancel</button>
              <button className="host-btn host-btn--primary" disabled={busy} onClick={apply}>
                {busy ? "Applying…" : "Apply and restart"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SettingsSection>
  );
}

export { AnchorConfiguration };

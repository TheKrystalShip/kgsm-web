// LeafConfigReview — the confirm step. Shows every staged change as from → to, names any paired
// API key that moves with it, and requires an explicit acknowledgement when something staged is
// `wiring` or `destructive`. One apply, one restart.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { RiskBadge } from "./LeafConfigRow.jsx";

function shownValue(f, drafts) {
  if (f.isSecret) return "a new secret";
  const v = drafts[f.key];
  return v === "" ? "empty" : String(v);
}
function shownCurrent(f) {
  if (f.isSecret) return f.set ? "•••••• set" : "not set";
  if (f.effective == null) return "unset";
  return f.effective === "" ? "empty" : String(f.effective);
}
// What a reset lands on: the leaf's own configured value, or its coded default when its config
// doesn't set one. Never guessed — when neither is known, say so.
function resetTarget(f) {
  if (f.floor != null) return (f.floor === "" ? "empty" : f.floor) + " (the leaf's own value)";
  if (f.default != null) return f.default + " (the leaf's default)";
  return "unset";
}

function LeafConfigReview({ config, staged, drafts, resets, busy, onCancel, onApply }) {
  const [ack, setAck] = React.useState(false);
  const risky = staged.filter(f => f.risk === "wiring" || f.risk === "destructive");
  const paired = staged.filter(f => f.pairedApiKey);
  const needsAck = risky.length > 0;

  return (
    <Modal onClose={busy ? undefined : onCancel} canClose={!busy}>
      <div className="modal lcf-review">
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name="check" size={18} /></div>
          <div>
            <h2 className="host-editor__title">
              Apply {staged.length} change{staged.length === 1 ? "" : "s"} to {config.displayName}
            </h2>
            <p className="host-editor__sub">
              Written as one override file, then <code>{config.unit}</code> is restarted <b>once</b> and probed.
            </p>
          </div>
          {!busy && (
            <button className="host-editor__close" onClick={onCancel} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        <div className="host-editor__body lcf-review__body">
          {staged.map(f => {
            const isReset = resets.has(f.key);
            return (
              <div className="lcf-chg" key={f.key}>
                <div className="lcf-chg__t">
                  <span className="lcf-chg__label">{f.label}</span>
                  <RiskBadge risk={f.risk} />
                  {f.envName && <code className="lcf-chg__env">{f.envName}</code>}
                </div>
                <div className="lcf-chg__d">
                  <span className="lcf-chg__from">{shownCurrent(f)}</span>
                  <Icon name="arrow-right" size={13} />
                  <span className="lcf-chg__to">{isReset ? resetTarget(f) : shownValue(f, drafts)}</span>
                  {isReset && <span className="lcf-chg__note">override removed</span>}
                </div>
                {f.pairedApiKey && (
                  <div className="lcf-chg__paired">
                    <Icon name="git-branch" size={12} />
                    <span>
                      Moves <code>{f.pairedApiKey}</code> with it, in the same apply, so the panel
                      does not lose the leaf.
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {needsAck && (
            <label className="lcf-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
              <span>
                <b>{risky.length} of these can break something.</b>{" "}
                {risky.some(f => f.risk === "wiring") && (
                  "A wiring change restarts the leaf perfectly and can still leave this panel unable to reach it — "
                  + "the result says so rather than silently reverting. "
                )}
                {risky.some(f => f.risk === "destructive") && "A data change can drop or orphan what is already stored. "}
                I understand.
              </span>
            </label>
          )}

          {paired.length > 0 && (
            <div className="lcf-note lcf-note--info">
              <Icon name="info" size={14} />
              <span>
                {paired.length} paired API key{paired.length === 1 ? "" : "s"} will be updated in the
                same transaction.
              </span>
            </div>
          )}
        </div>

        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={onApply} disabled={busy || (needsAck && !ack)}>
            {busy ? <Icon name="loader" size={14} className="act-spin" /> : <Icon name="refresh-cw" size={14} />}
            {busy ? "Applying…" : "Apply & restart"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { LeafConfigReview };

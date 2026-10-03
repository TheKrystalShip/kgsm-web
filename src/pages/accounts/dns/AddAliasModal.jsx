// AddAliasModal — name an existing, published game server or capability under an additional label.
// The anchor claims the alias at the same place its target already resolves to — a game server's node
// (`NameService.ClaimAlias`) or a capability's holder (`NameService.ClaimCapabilityAlias`) — so this
// form only ever asks which target and which label, and can never point a name anywhere new.
//
// The caller decides what can be aliased and where the alias lands: `targets` are the rows offered,
// `describe` is how one reads in the picker, and `suffix` is the base the label is composed under —
// the play base for a server, the zone itself for a capability.

import React from "react";

import { Icon, Modal, Select } from "@thekrystalship/krystal-ui";
import { addAlias } from "../../../lib/dnsClient.js";

function AddAliasModal({ targets, targetLabel, describe, suffix, placeholder, existingNames, onClose, onDone }) {
  const published = (targets || []).filter((r) => r.state === "published");
  const [target, setTarget] = React.useState(published[0] ? published[0].name : "");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const trimmed = label.trim().toLowerCase();
  const fullName = trimmed ? trimmed + suffix : "";
  const taken = trimmed && (existingNames || []).includes(fullName);
  const valid = !!target && !!trimmed && !taken;

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    addAlias(target, trimmed)
      .then(onDone)
      .catch((e) => { setErr((e && e.userMessage) || "That didn’t work."); setBusy(false); });
  };

  return (
    <Modal onClose={onClose} canClose={!busy}>
      <div className="modal host-editor">
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name="link" size={18} /></div>
          <div>
            <h2 className="host-editor__title">Add alias</h2>
          </div>
          <button className="host-editor__close" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="host-editor__body">
          <label className="host-field">
            <span className="host-field__label">{targetLabel}</span>
            <Select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
              {published.length === 0 && <option value="">Nothing published</option>}
              {published.map((r) => (
                <option key={r.name} value={r.name}>{describe(r)}</option>
              ))}
            </Select>
          </label>
          <label className="host-field">
            <span className="host-field__label">Alias</span>
            <span className="dns-alias-row">
              <input className="host-field__input host-field__input--mono" value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={placeholder} spellCheck="false" autoCapitalize="off" autoCorrect="off"
                disabled={busy} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
              <span className="dns-alias-suffix">{suffix}</span>
            </span>
            {trimmed && <span className="host-field__hint">{taken ? "taken" : "free"}</span>}
          </label>
          {err && (
            <div className="cluster-addform__err">
              <Icon name="triangle-alert" size={13} /><span>{err}</span>
            </div>
          )}
        </div>

        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={submit} disabled={!valid || busy}>
            <Icon name={busy ? "loader" : "plus"} size={14} strokeWidth={2.4} className={busy ? "cluster-spin" : ""} />
            {busy ? "Adding…" : "Add alias"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { AddAliasModal };

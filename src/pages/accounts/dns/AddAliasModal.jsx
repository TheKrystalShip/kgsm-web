// AddAliasModal — name an existing, published game server under an additional label. The anchor
// claims the alias at the same node its server already resolves to (`NameService.ClaimAlias`), so
// this form only ever asks which server and which label — it can never point a name anywhere new.

import React from "react";

import { Icon } from "../../../components/Icon.jsx";
import { Modal } from "../../../components/Modal.jsx";
import { Select } from "../../../components/Select.jsx";
import { addAlias } from "../../../lib/dnsClient.js";
import { shortName } from "./dnsKit.jsx";

function AddAliasModal({ gameRows, existingNames, zone, playBase, onClose, onDone }) {
  const published = (gameRows || []).filter((r) => r.state === "published");
  const [server, setServer] = React.useState(published[0] ? published[0].name : "");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const suffix = "." + (playBase || "play") + (zone ? "." + zone : "");
  const trimmed = label.trim().toLowerCase();
  const fullName = trimmed ? trimmed + suffix : "";
  const taken = trimmed && (existingNames || []).includes(fullName);
  const valid = !!server && !!trimmed && !taken;

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    addAlias(server, trimmed)
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
            <span className="host-field__label">Server</span>
            <Select value={server} disabled={busy} onChange={(e) => setServer(e.target.value)}>
              {published.length === 0 && <option value="">No published servers</option>}
              {published.map((r) => (
                <option key={r.name} value={r.name}>{(r.key || r.name) + " · " + r.member + " · " + shortName(r.name, zone)}</option>
              ))}
            </Select>
          </label>
          <label className="host-field">
            <span className="host-field__label">Alias</span>
            <span className="dns-alias-row">
              <input className="host-field__input host-field__input--mono" value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="smp" spellCheck="false" autoCapitalize="off" autoCorrect="off"
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

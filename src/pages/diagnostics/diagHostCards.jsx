// A node's own controls, as opposed to its member controls: renaming it, and the form that does.
// Re-exported from diagComponents.jsx so consumers name one module. Pure render + narrow local state.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { can } from "../../lib/persona.js";

// The one thing a node row can change about a node: what it is called, and where it is said to be.
// A label is this panel's, not the cluster's — which is why it sits beside the member controls
// rather than among them, and why it is here at all: everything else about a node is measured.
//
// Nothing for somebody who cannot manage a node. There is no write to place.
function NodeEditButton({ host, onEdit }) {
  if (!can("host.manage")) return null;
  const label = "Rename " + (host.name || host.id);
  return (
    <button
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onEdit(host); }}
    >
      <Icon name="pencil" size={13} />
    </button>
  );
}

// Renaming a node. A display name and a region are this browser's words for a machine — everything
// else a node row shows is measured — so this is the whole of what it edits.
function HostEditorModal({ host, onSave, onClose }) {
  const clean = (v) => (v && v !== "\u2014" ? v : "");
  const [name, setName] = React.useState(clean(host?.name));
  const [region, setRegion] = React.useState(clean(host?.region));
  const canSave = !!name.trim();
  const submit = () => { if (canSave) onSave({ label: name.trim(), region: region.trim() }); };
  return (
    <Modal onClose={onClose}>
      <div className="modal host-editor">
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name="pencil" size={18} /></div>
          <div>
            <h2 className="host-editor__title">Rename {host?.name || "this node"}</h2>
            <p className="host-editor__sub">Set how this machine appears across the panel — its label and region.</p>
          </div>
          <button className="host-editor__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="host-editor__body">
          <label className="host-field">
            <span className="host-field__label">Display name</span>
            <input className="host-field__input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frankfurt box" autoFocus />
          </label>
          <label className="host-field">
            <span className="host-field__label">Region <span className="host-field__opt">optional</span></span>
            <input className="host-field__input host-field__input--mono" value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. eu-west" spellCheck="false" />
          </label>
        </div>
        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={submit} disabled={!canSave}>
            <Icon name="check" size={14} strokeWidth={2.4} />
            Save changes
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { NodeEditButton, HostEditorModal };

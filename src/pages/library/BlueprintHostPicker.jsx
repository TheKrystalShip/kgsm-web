// BlueprintHostPicker — which host's disk a blueprint file lands on.
//
// A blueprint file belongs to ONE host, so every blueprint surface (the editor
// on a game page, the create page) has to name the host explicitly rather than
// fan out. Both use this picker so they read the same and the choice means the
// same thing in both. Renders nothing when only one host qualifies — the caller
// auto-selects it, and a one-option dropdown is noise.

import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon.jsx";

function BlueprintHostPicker({ hosts, selectedId, onSelect, title = "Which host to edit" }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef(null);
  const menuRef = React.useRef(null);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const list = hosts || [];
  if (list.length <= 1) return null;

  const current = list.find(h => h.id === selectedId) || null;

  return (
    <div className="bp-editor__host" ref={triggerRef}>
      <button
        className={"bp-editor__host-trigger" + (open ? " bp-editor__host-trigger--open" : "")}
        onClick={() => setOpen(o => !o)}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}>
        <span className="bp-editor__host-name">{current ? current.name : "Select host"}</span>
        <Icon name="chevrons-up-down" size={13} />
      </button>
      {open && createPortal(
        <div className="bp-editor__host-menu" role="listbox" ref={menuRef}
          style={{ position: "fixed", top: "var(--bp-host-top, 0)", right: 16, zIndex: 1000 }}>
          {list.map(h => {
            const active = h.id === selectedId;
            return (
              <button key={h.id}
                className={"bp-editor__host-opt" + (active ? " bp-editor__host-opt--active" : "")}
                onClick={() => { setOpen(false); if (!active) onSelect(h.id); }}
                role="option" aria-selected={active}>
                <span>{h.name}</span>
                {active && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

export { BlueprintHostPicker };
export default BlueprintHostPicker;

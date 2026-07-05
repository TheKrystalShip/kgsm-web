// AssistantHostPicker — chooses which host's assistant the dock talks to.
// Shows the live status dot + model; only opens a menu when >1 host qualifies.

import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon.jsx";
import { hostCapability } from "../../lib/capabilities.js";
import { usePortalPopover } from "./usePortalPopover.js";

function AssistantHostPicker({ hosts, current, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { pos, menuRef } = usePortalPopover(open, setOpen, ref);
  if (!current) return null;
  const cap = hostCapability(current, "assistant");
  const dotTone = cap.state === "operational" ? "online" : cap.state === "degraded" ? "warn" : "danger";
  const many = (hosts || []).length > 1;
  const pick = (id) => { setOpen(false); if (id !== current.id) onSelect(id); };
  return (
    <div className="asst-host" ref={ref}>
      <button
        className={"asst-host__trigger" + (open ? " asst-host__trigger--open" : "") + (many ? "" : " asst-host__trigger--solo")}
        onClick={() => many && setOpen(o => !o)} title="Which host’s assistant"
        aria-haspopup={many ? "listbox" : undefined} aria-expanded={open}>
        <span className={"asst-host__dot asst-host__dot--" + dotTone}></span>
        <span className="asst-host__name">{current.name}</span>
        {many && <Icon name="chevrons-up-down" size={13} className="asst-host__caret" />}
      </button>
      {open && many && pos && createPortal(
        <div className="asst-host__menu" role="listbox" ref={menuRef} style={pos}>
          <div className="asst-host__menu-label">Host assistant</div>
          {hosts.map(h => {
            const c = hostCapability(h, "assistant");
            const usable = c.state === "operational" || c.state === "degraded";
            const t = c.state === "operational" ? "online" : c.state === "degraded" ? "warn" : "danger";
            const active = h.id === current.id;
            return (
              <button key={h.id} className={"asst-host__opt" + (active ? " asst-host__opt--active" : "") + (usable ? "" : " asst-host__opt--down")}
                onClick={() => usable && pick(h.id)} disabled={!usable} role="option" aria-selected={active}>
                <span className={"asst-host__dot asst-host__dot--" + t}></span>
                <span className="asst-host__opt-name">{h.name}</span>
                {!usable && <span className="asst-host__opt-state">offline</span>}
                {active && <Icon name="check" size={14} className="asst-host__opt-check" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export { AssistantHostPicker };

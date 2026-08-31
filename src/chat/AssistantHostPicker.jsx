// AssistantHostPicker — chooses which assistant the dock talks to.
// Shows the live status dot + model.
//
// An assistant is the cluster's own or a service on one node, and both appear here as one list. The
// difference matters to whoever is choosing — one acts across every node, the other only on the
// machine it runs on — so each entry says which it is rather than being named after a member.
//
// With none chosen — several assistants and nothing in the conversation to
// derive one from — the picker IS the choice: it reads "Choose an assistant" and opens
// even at a single option, because that option has not been taken yet.

import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "../components/Icon.jsx";
import { usePortalPopover } from "../hooks/usePortalPopover.js";

function AssistantHostPicker({ hosts, current, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { pos, menuRef } = usePortalPopover(open, setOpen, ref);
  const list = hosts || [];
  if (!current && !list.length) return null;
  const dotTone = !current ? "muted"
    : current.state === "operational" ? "online" : current.state === "degraded" ? "warn" : "danger";
  const openable = list.length > 1 || !current;
  const pick = (id) => { setOpen(false); if (!current || id !== current.id) onSelect(id); };
  return (
    <div className="asst-host" ref={ref}>
      <button
        className={"asst-host__trigger" + (open ? " asst-host__trigger--open" : "") + (openable ? "" : " asst-host__trigger--solo")}
        onClick={() => openable && setOpen(o => !o)} title="Which assistant"
        aria-haspopup={openable ? "listbox" : undefined} aria-expanded={open}>
        <span className={"asst-host__dot asst-host__dot--" + dotTone}></span>
        <span className="asst-host__name">{current ? current.name : "Choose an assistant"}</span>
        {openable && <Icon name="chevrons-up-down" size={13} className="asst-host__caret" />}
      </button>
      {open && openable && pos && createPortal(
        <div className="asst-host__menu" role="listbox" ref={menuRef} style={pos}>
          <div className="asst-host__menu-label">Assistant</div>
          {list.map(h => {
            const usable = h.state === "operational" || h.state === "degraded";
            const t = h.state === "operational" ? "online" : h.state === "degraded" ? "warn" : "danger";
            const active = !!current && h.id === current.id;
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

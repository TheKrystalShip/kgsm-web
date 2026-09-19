// dnsRowActions.jsx — one row's action, in the two presentations every table on this page uses:
// an icon button inline on a wide screen, and the same action inside a "⋯" menu on a phone,
// which is the split `PlayerModeration.jsx` established for the players roster. Every table here
// offers at most one action per row (an alias's own removal, a certificate's own renewal), so this
// is that idiom trimmed to one item rather than a second copy of the moderation menu.

import React from "react";
import { createPortal } from "react-dom";

import { Icon } from "../../../components/Icon.jsx";

const MENU_WIDTH = 196;

// action: { icon, label, tone: "safe"|"danger", onRun, pending, disabled, reason }
function DnsRowActionButton({ action }) {
  const { icon, label, tone, onRun, pending, disabled, reason } = action;
  const click = (e) => {
    e.stopPropagation();
    if (disabled || pending) return;
    onRun();
  };
  return (
    <button type="button" className={"icon-btn pmod-btn pmod-btn--" + tone + (pending ? " is-pending" : "")}
      disabled={disabled || pending} title={pending ? label + "…" : (reason || label)}
      aria-label={pending ? label + "…" : label} onClick={click}>
      {pending ? <span className="act-spin" /> : <Icon name={icon} size={15} strokeWidth={1.9} />}
    </button>
  );
}

function DnsRowMenu({ anchorRef, action, onClose }) {
  const [pos, setPos] = React.useState(null);
  const panelRef = React.useRef(null);
  const height = 12 + 38 + (action.reason ? 30 : 0);

  React.useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const top = below < height + 12 ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top, left });
  }, [anchorRef, height]);

  React.useEffect(() => {
    const onDocDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  const disabled = !!action.reason || action.pending;
  return createPortal(
    <div className="pmod-menu" role="menu" ref={panelRef}
      style={{ top: pos.top + "px", left: pos.left + "px", width: MENU_WIDTH + "px" }}>
      <button type="button" className={"pmod-menu__item pmod-menu__item--" + action.tone}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); if (!disabled) { action.onRun(); onClose(); } }}>
        <Icon name={action.icon} size={14} strokeWidth={2.2} />
        <span className="pmod-menu__text">
          <span>{action.pending ? action.label + "…" : action.label}</span>
          {action.reason ? <span className="pmod-menu__why">{action.reason}</span> : null}
        </span>
      </button>
    </div>,
    document.body,
  );
}

// The whole cell — desktop icon button, phone kebab. `action` is null for a row with nothing to do
// (an ordinary game server, an anchor's own name), and the cell then renders nothing at all rather
// than an empty column.
function DnsRowActions({ action }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef(null);
  const close = React.useCallback(() => setOpen(false), []);

  if (!action) return null;

  return (
    <span className="pmod">
      <span className="pmod__inline">
        <DnsRowActionButton action={action} />
      </span>
      <span className="pmod__compact">
        <button type="button" ref={triggerRef}
          className={"icon-btn pmod-kebab" + (open ? " icon-btn--on" : "")}
          aria-haspopup="menu" aria-expanded={open} aria-label={"Actions for " + action.label}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          <Icon name="ellipsis" size={15} />
        </button>
        {open && <DnsRowMenu anchorRef={triggerRef} action={action} onClose={close} />}
      </span>
    </span>
  );
}

export { DnsRowActions };

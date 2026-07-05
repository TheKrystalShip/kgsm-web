import React from "react";
import { createPortal } from "react-dom";

// Modal — the shared overlay primitive. Portals a fixed, full-viewport scrim to
// <body> and centralizes the three things every modal in this app used to
// hand-roll (an Escape effect + a scrim + a click-outside check, copied ~8×):
//   • close on Escape (window keydown)
//   • close on scrim mouse-down *outside* the content (target === currentTarget,
//     so a press that starts inside the box — e.g. a text drag — never closes)
//   • both gated by `canClose` (pass false to block close while a request is
//     in flight, replacing the old per-modal `!busy` guards)
//
// This primitive is BEHAVIOUR-ONLY: the caller owns the inner content AND the
// scrim's visual class (`scrimClassName`), so each migrated site keeps its exact
// look (`.modal-scrim`, `.k-backdrop`, `.console-modal-scrim`, …). All three are
// `position: fixed; inset: 0`, so portaling to <body> never shifts them — it just
// lifts them out of any `transform`/`overflow` ancestor that could clip them.
function Modal({ onClose, canClose = true, scrimClassName = "modal-scrim", children }) {
  React.useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && canClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, canClose]);

  const onScrimDown = (e) => {
    if (e.target === e.currentTarget && canClose && onClose) onClose();
  };

  return createPortal(
    <div className={scrimClassName} onMouseDown={onScrimDown}>
      {children}
    </div>,
    document.body,
  );
}

export { Modal };

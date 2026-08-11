import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { useStore } from "../lib/store.js";
import { toast, toastStore } from "../lib/toasts.js";

// Toasts — the live stack of outcome cards. Mounted once per surface; portals to
// <body> like Modal.jsx, so it never inherits a page's stacking or overflow.
//
// What is NOT here: any notion of what happened on the fleet. See lib/toasts.js
// for the rule, and NotificationsPanel.jsx for the history these fall into.

const TONE_ICON = { error: "circle-alert", success: "circle-check", info: "info" };

function ToastCard({ t }) {
  const [paused, setPaused] = React.useState(false);
  const dismiss = React.useCallback(() => toast.dismiss(t.id), [t.id]);

  // A sticky card (every error) has no timer at all. `t.ts` is in the deps on
  // purpose: a folded repeat bumps it, which restarts the countdown so the last
  // occurrence gets its full reading time rather than inheriting the first's.
  React.useEffect(() => {
    if (t.sticky || paused) return;
    const ms = t.tone === "success" ? 4000 : 6000;
    const id = setTimeout(dismiss, ms);
    return () => clearTimeout(id);
  }, [t.sticky, t.tone, t.ts, paused, dismiss]);

  return (
    <div
      className={"toast toast--" + t.tone}
      // An error is announced immediately; anything else waits its turn so a
      // background success can't talk over what someone is reading.
      role={t.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast__icon"><Icon name={TONE_ICON[t.tone] || "info"} size={16} strokeWidth={2} /></span>
      <div className="toast__body">
        <div className="toast__title">
          {t.title}
          {t.count > 1 && <span className="toast__count" title={t.count + " occurrences"}>×{t.count}</span>}
        </div>
        {t.detail && <div className="toast__detail">{t.detail}</div>}
        {t.action && (
          <button type="button" className="toast__action" onClick={() => { t.action.onClick(); dismiss(); }}>
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast__close" onClick={dismiss} aria-label="Dismiss">
        <Icon name="x" size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}

function Toasts() {
  const live = useStore(toastStore, s => s.live);
  if (typeof document === "undefined") return null;
  return createPortal(
    // aria-live on the CONTAINER, which must exist in the DOM before a card
    // arrives — a live region added at the same moment as its content is not
    // reliably announced.
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {live.map(t => <ToastCard key={t.id} t={t} />)}
    </div>,
    document.body,
  );
}

export { Toasts };
export default Toasts;

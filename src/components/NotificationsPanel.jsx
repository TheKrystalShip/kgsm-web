import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { usePortalPopover } from "../hooks/usePortalPopover.js";
import { fmtRelative } from "../lib/formatting.js";
import { useStore } from "../lib/store.js";
import { toast, toastStore, unreadCount, unreadTone } from "../lib/toasts.js";

// NotificationsPanel — the sidebar entry and popover for the toast history.
//
// A toast is gone in seconds by design; this is where you go when one left
// before you read it. It sits in the sidebar's FOOT, deliberately away from
// Monitoring, because it is not the Alerts feed and must not read as it:
//
//   Alerts        what the AlertEngine says about the FLEET. Server-side,
//                 the same for everyone looking at this host.
//   Notifications what YOU did in THIS browser, and how it went.
//
// It is also the only record of a command kgsm-api refused up front — those never
// reach the engine, so no audit row is ever written for them (see lib/toasts.js).
// Deliberately no link to the audit log: that log holds what happened to the
// FLEET and none of these rows, so offering it as a "see more" would promise a
// continuation of this list that does not exist there.

const TONE_ICON = { error: "circle-alert", success: "circle-check", info: "info" };

// The collapsed rail hides `.nav-item__label` and re-places `.nav-item__badge`
// itself (kit/extras.css), so this needs no rail-specific markup.
function NotificationsPanel({ onOpenServer }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { pos, menuRef } = usePortalPopover(open, setOpen, ref);
  const history = useStore(toastStore, s => s.history);
  const unread = useStore(toastStore, unreadCount);
  const tone = useStore(toastStore, unreadTone);

  // Opening IS the acknowledgement — the rows are on screen, so holding the
  // badge up would just make it a thing to dismiss twice.
  const toggle = () => setOpen(o => {
    const next = !o;
    if (next) toast.markAllRead();
    return next;
  });

  const pick = (t) => {
    setOpen(false);
    if (t.serverId && onOpenServer) onOpenServer(t.serverId);
  };

  const now = new Date();

  return (
    <div className="notif" ref={ref}>
      <div
        className={"nav-item" + (open ? " nav-item--active" : "")}
        onClick={toggle}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        data-tip={"Notifications" + (unread > 0 ? " · " + unread : "")}
        aria-label={"Notifications" + (unread > 0 ? ", " + unread + " unread" : "")}
        aria-haspopup="menu" aria-expanded={open}
      >
        <Icon name="bell" size={16} />
        <span className="nav-item__label">Notifications</span>
        {unread > 0 && <span className={"nav-item__badge nav-item__badge--" + tone}>{unread}</span>}
      </div>

      {open && pos && createPortal(
        <div className="notif__menu" role="menu" ref={menuRef} style={pos}>
          <div className="notif__head">
            <span className="notif__head-label">Notifications</span>
            {history.length > 0 && (
              <button type="button" className="notif__clear" onClick={() => toast.clearHistory()}>Clear all</button>
            )}
          </div>

          <div className="notif__list">
            {history.length === 0 ? (
              <div className="notif__empty">
                <Icon name="bell-off" size={18} />
                <span>Nothing yet.</span>
                {/* Says which of the two lists this is, so it is never mistaken for Alerts. */}
                <span className="notif__empty-sub">Actions you take here show up in this list.</span>
              </div>
            ) : history.map(t => (
              <div
                key={t.id}
                className={"notif__item notif__item--" + t.tone + (t.serverId ? " notif__item--link" : "")}
                onClick={() => pick(t)}
                role={t.serverId ? "button" : undefined}
                tabIndex={t.serverId ? 0 : undefined}
                onKeyDown={t.serverId ? (e => { if (e.key === "Enter") pick(t); }) : undefined}
              >
                <span className="notif__icon"><Icon name={TONE_ICON[t.tone] || "info"} size={14} strokeWidth={2} /></span>
                <div className="notif__body">
                  <div className="notif__title">
                    {t.title}
                    {t.count > 1 && <span className="notif__count">×{t.count}</span>}
                  </div>
                  {t.detail && <div className="notif__detail">{t.detail}</div>}
                  <div className="notif__meta">
                    <span>{fmtRelative(new Date(t.ts), now)}</span>
                    {t.code && <><span className="notif__dot">·</span><code className="notif__code">{t.code}</code></>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export { NotificationsPanel };
export default NotificationsPanel;

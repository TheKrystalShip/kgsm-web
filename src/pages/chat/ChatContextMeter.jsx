// ChatContextMeter — the compact context-window gauge in the composer toolbar.
// Shows token occupancy as a percentage bar; click opens a popover with exact
// figures and a "Compact" CTA.

import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon.jsx";
import { usePortalPopover } from "./usePortalPopover.js";

function ChatContextMeter({ usage, onCompact }) {
  const win = usage && usage.contextWindow > 0 ? usage.contextWindow : 0;
  const used = win && usage.usedTokens >= 0 ? usage.usedTokens : 0;
  const pct = win ? Math.min(100, Math.round((used / win) * 100)) : 0;
  const tone = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "\u2014");
  const fmtTokens = (n) => {
    if (typeof n !== "number") return "\u2014";
    if (n < 1000) return String(n);
    const big = n >= 1000000;
    const div = big ? 1000000 : 1000;
    const rounded = big ? Math.round(n / 100000) / 10 : Math.round(n / 1000);
    const approx = rounded * div !== n;
    return (approx ? "~" : "") + rounded + (big ? "M" : "k");
  };
  const remaining = win
    ? (typeof usage.remainingTokens === "number" ? usage.remainingTokens : Math.max(0, win - used))
    : 0;
  const title = win
    ? "Context window \u00b7 " + fmt(used) + " / " + fmt(win) + " tokens used (" + fmt(remaining) + " left)"
    : "Context window \u00b7 empty \u2014 fills as the conversation grows";

  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { pos, menuRef } = usePortalPopover(open, setOpen, ref);

  const [compacting, setCompacting] = React.useState(false);
  const [note, setNote] = React.useState(null);
  React.useEffect(() => { if (!open) setNote(null); }, [open]);
  const runCompact = async () => {
    if (!onCompact || compacting) return;
    setCompacting(true);
    setNote(null);
    try {
      const r = await onCompact();
      if (r && r.compacted) setOpen(false);
      else setNote("Already compact \u2014 nothing to summarize yet.");
    } catch (e) {
      setNote(e && e.code === 401
        ? "Session expired \u2014 re-authorize this host to compact."
        : "Couldn\u2019t compact \u2014 try again.");
    } finally {
      setCompacting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={ref}
        className={"chat-act-toggle chat-ctx chat-ctx--" + tone + (open ? " chat-ctx--open" : "")}
        onClick={() => setOpen(o => !o)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}>
        <Icon name="gauge" size={13} className="chat-ctx__icon" />
        <span className="chat-ctx__track"><i style={{ width: pct + "%" }} /></span>
        <span className="chat-ctx__val">{pct}%</span>
      </button>
      {open && pos && createPortal(
        <div className={"chat-ctx__pop chat-ctx__pop--" + tone} ref={menuRef} style={pos} role="dialog" aria-label="Context window usage">
          <div className="chat-ctx__pop-head">
            <Icon name="gauge" size={13} />
            <span>Context window</span>
          </div>
          <div className="chat-ctx__pop-row">
            <span className="chat-ctx__pop-pct">{pct}%</span>
            <span className="chat-ctx__pop-cap">{win ? "of the window used" : "used \u2014 no turns yet"}</span>
          </div>
          <div className="chat-ctx__pop-track"><i style={{ width: pct + "%" }} /></div>
          <div className="chat-ctx__pop-nums">
            {win ? (
              <>
                <span><b>{fmtTokens(used)}</b> / {fmtTokens(win)} tokens</span>
                <span>{fmtTokens(remaining)} left</span>
              </>
            ) : (
              <span className="chat-ctx__pop-empty">The window fills as the conversation grows.</span>
            )}
          </div>
          <div className="chat-ctx__pop-foot">
            <button
              type="button"
              className="chat-ctx__compact"
              onClick={onCompact ? runCompact : undefined}
              disabled={!onCompact || compacting}
              title={onCompact
                ? "Summarize the older messages to free up the context window"
                : "Nothing to compact yet \u2014 send a message first"}>
              {compacting
                ? <><span className="oauth-spinner" /> Compacting…</>
                : <><Icon name="fold-vertical" size={13} strokeWidth={2.2} /> Compact</>}
            </button>
            {note && <span className="chat-ctx__pop-note">{note}</span>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export { ChatContextMeter };

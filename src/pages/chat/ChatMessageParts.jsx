// Chat message sub-components — leaf renderers with narrow prop interfaces.
// No parent state awareness, no conversation/host coupling.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { commandMeta } from "./chatConstants.js";
import { API_COMMAND_VERBS } from "./chatConstants.js";

function ChatContextPill({ msg }) {
  const pending = msg.state === "pending";
  const label = msg.label || "Working";
  const summary = msg.summary || "";
  const verbose = !pending && (summary.length > 120 || summary.includes("\n"));
  const [open, setOpen] = React.useState(false);

  if (verbose) {
    return (
      <div className={"chat-disc chat-disc--tool" + (open ? " chat-disc--open" : "")}>
        <button
          type="button"
          className="chat-disc__toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <Icon name="database" size={13} className="chat-disc__icon" />
          <span className="chat-disc__label">{label}</span>
          <Icon name="chevron-down" size={13} strokeWidth={2.2} className="chat-disc__chev" />
        </button>
        {open && <div className="chat-disc__body">{summary}</div>}
      </div>
    );
  }

  return (
    <div className={"chat-context" + (pending ? " chat-context--pending" : "")}>
      <span className="chat-context__icon">
        {pending
          ? <span className="chat-context__spinner"></span>
          : <Icon name="database" size={12} />}
      </span>
      <span className="chat-context__label">
        {pending ? label + "\u2026" : label}
        {!pending && summary && <span className="chat-context__detail"> · {summary}</span>}
      </span>
      {!pending && <Icon name="check" size={12} strokeWidth={2.6} className="chat-context__check" />}
    </div>
  );
}

function ChatThinking({ text, streaming }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={"chat-disc chat-disc--think" + (open ? " chat-disc--open" : "")}>
      <button
        type="button"
        className="chat-disc__toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="brain" size={13} className="chat-disc__icon" />
        <span className="chat-disc__label">{streaming ? "Thinking\u2026" : "Thinking"}</span>
        <Icon name="chevron-down" size={13} strokeWidth={2.2} className="chat-disc__chev" />
      </button>
      {open && <div className="chat-disc__body">{text}</div>}
    </div>
  );
}

function ChatCommand({ msg, onRun }) {
  const [armed, setArmed] = React.useState(false);
  const meta = commandMeta(msg.verb);
  const apiBacked = API_COMMAND_VERBS.has(msg.verb);
  const target = msg.subjectId || "this server";

  if (msg.state === "confirmed") {
    return (
      <div className="chat-actions">
        <div className="chat-actions__done">
          <Icon name="check" size={13} strokeWidth={2.6} />
          <span>Confirmed <b>{meta.label}</b> on {target}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="chat-actions">
      <div className="chat-actions__label">
        <Icon name="zap" size={12} /> Suggested action
      </div>
      <div className="chat-actions__row">
        {!apiBacked ? (
          <button className="chat-action chat-action--disabled" disabled
            title="This action isn’t available from the panel yet.">
            <Icon name={meta.icon} size={13} strokeWidth={2.2} />
            <span>{meta.label} {target}</span>
            <span className="chat-action__reason">Not available from the panel yet</span>
          </button>
        ) : armed ? (
          <div className="chat-action chat-action--armed">
            <span className="chat-action__confirm-q">{msg.confirm}</span>
            <div className="chat-action__confirm-btns">
              <button className={"chat-action__go chat-action__go--" + meta.tone} onClick={() => { setArmed(false); onRun(msg); }}>
                <Icon name="check" size={13} strokeWidth={2.4} /> Confirm
              </button>
              <button className="chat-action__cancel" onClick={() => setArmed(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={"chat-action chat-action--" + meta.tone} onClick={() => setArmed(true)}>
            <Icon name={meta.icon} size={13} strokeWidth={2.2} />
            <span>{meta.label} {target}</span>
            {msg.reason && <span className="chat-action__reason">{msg.reason}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

function ChatScopeNotice({ msg }) {
  return (
    <div className="chat-scope-notice">
      <Icon name="crosshair" size={12} />
      <span>{msg.label}</span>
    </div>
  );
}

function ChatCheckpointNotice({ msg }) {
  return (
    <div className="chat-scope-notice" style={{ opacity: 0.65 }}>
      <Icon name="history" size={12} />
      <span>{msg.label || "Conversation compacted"}</span>
    </div>
  );
}

function ChatToggleNotice({ msg }) {
  const isThink = msg.toggle === "thinking";
  const icon = isThink ? "brain" : (msg.on ? "zap" : "zap-off");
  const cls = "chat-toggle-notice"
    + (msg.on ? " chat-toggle-notice--on" : "")
    + (isThink ? " chat-toggle-notice--think" : " chat-toggle-notice--actions");
  return (
    <div className={cls}>
      <Icon name={icon} size={12} className="chat-toggle-notice__icon" />
      <span className="chat-toggle-notice__text">{msg.label}</span>
    </div>
  );
}

function ChatVerify({ msg }) {
  if (msg.state === "pending") {
    return (
      <div className="chat-verify chat-verify--pending">
        <span className="oauth-spinner"></span>
        <span>Verifying {msg.action.label.toLowerCase()}…</span>
      </div>
    );
  }
  const r = msg.result || { ok: true, headline: "Done.", lines: [] };
  return (
    <div className={"chat-verify chat-verify--" + (r.ok ? "ok" : "warn")}>
      <div className="chat-verify__head">
        <Icon name={r.ok ? "circle-check-big" : "alert-triangle"} size={14} />
        <span>{r.headline}</span>
      </div>
      {r.lines && r.lines.length > 0 && (
        <div className="chat-verify__lines">
          {r.lines.map((l, i) => (
            <span key={i} className={"chat-verify__chip chat-verify__chip--" + l.status}>
              {l.label}: <b>{l.detail}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatPending() {
  return (
    <div className="chat-typing" role="status" aria-label="The assistant is typing">
      <span></span><span></span><span></span>
    </div>
  );
}

function ChatSystemNotice({ msg }) {
  const down = msg.kind === "assistant-down";
  return (
    <div className={"chat-system chat-system--" + (down ? "down" : "up")}>
      <span className={"status-led status-led--" + (down ? "down" : "live")}></span>
      <div className="chat-system__body">
        <span className="chat-system__title">
          {down ? msg.host + "\u2019s assistant is unavailable" : msg.host + "\u2019s assistant reconnected"}
        </span>
        {down && (
          <span className="chat-system__detail">
            {(msg.message || "The connection to this host\u2019s assistant dropped.") + " Your messages will send once it\u2019s back."}
            {msg.others && msg.others.length > 0 &&
              " Other assistants are online (" + msg.others.join(", ") + "), but they run on different hosts and can\u2019t see this host\u2019s data \u2014 so they can\u2019t pick up where this one left off."}
          </span>
        )}
      </div>
    </div>
  );
}

export {
  ChatContextPill, ChatThinking, ChatCommand, ChatScopeNotice,
  ChatCheckpointNotice, ChatToggleNotice, ChatVerify, ChatPending, ChatSystemNotice,
};

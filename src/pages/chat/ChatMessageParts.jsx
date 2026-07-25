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

// Live progress stepper for a long-running autonomous tool call (create_blueprint):
// a check-them-off list built from `progress` SSE frames (see chatUtils' reduceTurnFrame
// "progress" case). Renders inline in the assistant bubble, next to the tool pills — it
// is NOT gated behind pendingCards, so it updates live while the tool is still running.
function ChatSteps({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <div className="chat-steps">
      {steps.map((s, i) => (
        <div key={s.id + ":" + s.key + ":" + i} className={"chat-steps__step chat-steps__step--" + s.status}>
          <span className="chat-steps__mark">
            {s.status === "active"
              ? <span className="chat-steps__spinner"></span>
              : <Icon name="check" size={11} strokeWidth={2.6} />}
          </span>
          <span className="chat-steps__label">{s.label}</span>
        </div>
      ))}
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
  // Install's subject is the blueprint; prefer the custom instance name the user asked for when set.
  const target = msg.instanceName || msg.subjectId || "this server";

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
      {msg.verb === "write_file" && msg.file && (
        <div className="chat-filepreview">
          <div className="chat-filepreview__path">
            <Icon name="file-pen" size={11} strokeWidth={2.2} />
            <code>{msg.file.path}</code>
          </div>
          <pre className="chat-filepreview__body">{msg.file.proposedContent}</pre>
        </div>
      )}
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

// Monaco is heavy (editor core + workers) — lazy-load it so the chunk only downloads
// when a blueprint-review card actually mounts, never on first paint. Same instance the
// file browser uses, so the yaml highlighting + theming come for free.
const CodeEditor = React.lazy(() => import("../../components/CodeEditor.jsx"));

// The in-chat blueprint-review checkpoint (assistant-blueprint-review-plan.md P2). One card,
// double duty: the mandatory pre-test review of the assistant's drafted config, AND the
// recovery surface when the autonomous repair loop exhausts (it comes back editable with the
// boot log attached for a second pass). It renders raw YAML in Monaco, re-validated server-side
// on Save; nothing lands in the catalog without a real verified boot. The state machine —
// proposed → verifying → verified｜failed, looping back to proposed on a re-edit — lives on the
// message (msg.bpState), driven by ChatPage's confirm round-trip; this component is presentational.
function ChatBlueprintDraft({ msg, onSave, onGiveUp, onRun }) {
  const state = msg.bpState || "proposed";
  const game = msg.instanceName || msg.subjectId || "this game";
  const busy = state === "verifying";
  // Local editor buffer. Re-seed whenever a new draft arrives — the token changes on the
  // re-edit loop, so keying the reset on it (plus the draft text) refreshes the editor cleanly.
  const [text, setText] = React.useState(msg.draftYaml || "");
  React.useEffect(() => { setText(msg.draftYaml || ""); }, [msg.token, msg.draftYaml]);
  const dirty = text !== (msg.draftYaml || "");

  if (state === "verified") {
    const name = msg.bpDisplayName || game;
    return (
      <div className="chat-bp chat-bp--ok">
        <div className="chat-bp__head">
          <span className="chat-bp__icon chat-bp__icon--ok"><Icon name="package-plus" size={14} /></span>
          <div className="chat-bp__titles">
            <span className="chat-bp__title">Added to the catalog · {name}</span>
            {msg.bpProof && <span className="chat-bp__sub">it {msg.bpProof}</span>}
          </div>
        </div>
        {msg.bpSlug && (
          <button type="button" className="chat-bp__cta"
            onClick={() => onRun && onRun({ verb: "install", subjectId: msg.bpSlug, instanceName: null, cmdId: null })}>
            <Icon name="server" size={13} strokeWidth={2.2} /> Make me a server
          </button>
        )}
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="chat-bp chat-bp--fail">
        <div className="chat-bp__head">
          <span className="chat-bp__icon chat-bp__icon--fail"><Icon name="octagon-x" size={14} /></span>
          <div className="chat-bp__titles">
            <span className="chat-bp__title">Didn’t add {msg.bpDisplayName || game}</span>
            {msg.bpReason && <span className="chat-bp__sub">{msg.bpReason}</span>}
          </div>
        </div>
      </div>
    );
  }

  // proposed (initial review or a re-edit) — the editor, optionally with the last boot log.
  return (
    <div className={"chat-bp" + (busy ? " chat-bp--busy" : "")}>
      <div className="chat-bp__head">
        <span className="chat-bp__icon"><Icon name="file-pen" size={14} /></span>
        <div className="chat-bp__titles">
          <span className="chat-bp__title">Review the {game} config</span>
          <span className="chat-bp__sub">Edit anything below, then save — I’ll test-install it and verify it boots before adding it.</span>
        </div>
      </div>
      {msg.evidence && (
        <div className="chat-bp__evidence">
          <div className="chat-bp__evidence-label">
            <Icon name="terminal-square" size={11} /> Last attempt didn’t boot — here’s what it logged
          </div>
          <pre className="chat-bp__evidence-body">{msg.evidence}</pre>
        </div>
      )}
      <div className="chat-bp__editor">
        <React.Suspense fallback={<div className="fb-editor__empty"><span className="oauth-spinner" /> Loading editor…</div>}>
          <CodeEditor value={text} onChange={setText} path="draft.bp.yaml" readOnly={busy} />
        </React.Suspense>
      </div>
      {busy ? (
        <div className="chat-bp__verifying">
          <span className="oauth-spinner" />
          <span>Test-installing and verifying {game}… this can take a few minutes.</span>
        </div>
      ) : (
        <div className="chat-bp__actions">
          <button type="button" className="chat-bp__btn chat-bp__btn--primary" onClick={() => onSave && onSave(msg, text)}>
            <Icon name="check" size={13} strokeWidth={2.4} /> Save &amp; test-install
          </button>
          <button type="button" className="chat-bp__btn" onClick={() => setText(msg.draftYaml || "")} disabled={!dirty}
            title={dirty ? "Revert your edits to the drafted config" : "No edits to revert"}>
            <Icon name="rotate-cw" size={13} /> Restore
          </button>
          <button type="button" className="chat-bp__btn chat-bp__btn--ghost" onClick={() => onGiveUp && onGiveUp(msg)}>
            Give up
          </button>
        </div>
      )}
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
  ChatContextPill, ChatSteps, ChatThinking, ChatCommand, ChatBlueprintDraft, ChatScopeNotice,
  ChatCheckpointNotice, ChatToggleNotice, ChatVerify, ChatPending, ChatSystemNotice,
};

// The panel's blueprint card in the chat — a draft the assistant wrote, reviewed and saved here.

import React from "react";
import { Icon, ReversablePortal } from "@thekrystalship/krystal-ui";

// Monaco is heavy (editor core + workers) — lazy-load it so the chunk only downloads
// when a blueprint-review card actually mounts, never on first paint. Same instance the
// file browser uses, so the yaml highlighting + theming come for free.
const CodeEditor = React.lazy(() => import("../components/CodeEditor.jsx"));

// The in-chat blueprint-review checkpoint. One card,
// double duty: the mandatory pre-test review of the assistant's drafted config, AND the
// recovery surface when the autonomous repair loop exhausts (it comes back editable with the
// boot log attached for a second pass). It renders raw YAML in Monaco, re-validated server-side
// on Save; nothing lands in the catalog without a real verified boot. The state machine —
// proposed → verifying → verified｜failed, looping back to proposed on a re-edit — lives on the
// message (msg.bpState), driven by ChatPage's confirm round-trip; this component is presentational.
function ChatBlueprintDraft({ msg, onSave, onGiveUp, onRun, onDraftEdit, onDraftActive }) {
  const state = msg.bpState || "proposed";
  const game = msg.instanceName || msg.subjectId || "this game";
  const busy = state === "verifying";
  // Local editor buffer. Re-seed whenever a new draft arrives — the token changes on the
  // re-edit loop, so keying the reset on it (plus the draft text) refreshes the editor cleanly.
  const [text, setText] = React.useState(msg.draftYaml || "");
  React.useEffect(() => { setText(msg.draftYaml || ""); }, [msg.token, msg.draftYaml]);
  const dirty = text !== (msg.draftYaml || "");
  // Expose this draft's CURRENT content (manual edits included) to ChatPage, so a chat message asking
  // the assistant to revise it can carry the exact content the user sees — that's what lets the assistant
  // actually change the draft from chat (via revise_blueprint) instead of pretending it did. While this
  // draft is the OPEN (editable) one, register it as active and keep its live content in sync.
  React.useEffect(() => {
    if (state === "proposed" && onDraftEdit) onDraftEdit(msg.cmdId, text);
  }, [text, state, msg.cmdId, onDraftEdit]);
  React.useEffect(() => {
    if (state === "proposed" && onDraftActive) onDraftActive(msg.cmdId, true);
    return () => { if (onDraftActive) onDraftActive(msg.cmdId, false); };
  }, [state, msg.cmdId, onDraftActive]);
  // Full-screen pop-out (same behaviour as the Files editor + console + charts): the whole
  // review card lifts into a portaled Modal so a long config isn't capped at the inline height.
  const [expanded, setExpanded] = React.useState(false);
  // Collapse if the card leaves the editable state (verified/failed have no editor to expand).
  React.useEffect(() => { if (state !== "proposed" && state !== "verifying") setExpanded(false); }, [state]);

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

  // Superseded: a newer draft replaced this one (a revise or a re-draft). Read-only, no editor and no
  // action buttons — the stale token/content here is no longer usable; the user works the newer card below.
  if (state === "superseded") {
    return (
      <div className="chat-bp chat-bp--superseded" aria-disabled="true">
        <div className="chat-bp__head">
          <span className="chat-bp__icon chat-bp__icon--muted"><Icon name="history" size={14} /></span>
          <div className="chat-bp__titles">
            <span className="chat-bp__title">Replaced by an updated draft for {game}</span>
            <span className="chat-bp__sub">This version is no longer editable — review and save the newer draft below.</span>
          </div>
        </div>
      </div>
    );
  }

  // proposed (initial review or a re-edit) — the editor, optionally with the last boot log.
  // The whole card is built once as `body` and projected through ReversablePortal so the
  // pop-out reuses the exact same editor + actions by reparenting the real DOM node — the
  // Monaco instance/model survive the toggle and stay bound to `text` (mirrors FileBrowser).
  const body = (
    <div className={"chat-bp" + (busy ? " chat-bp--busy" : "") + (expanded ? " chat-bp--full" : "")}>
      <div className="chat-bp__head">
        <span className="chat-bp__icon"><Icon name="file-pen" size={14} /></span>
        <div className="chat-bp__titles">
          <span className="chat-bp__title">Review the {game} config</span>
          <span className="chat-bp__sub">Edit anything below, then save — I’ll test-install it and verify it boots before adding it.</span>
        </div>
        <button type="button" className="chat-bp__expand" onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}>
          <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
        </button>
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
          <span>
            Test-installing and verifying {game}… this can take a few minutes.
            {msg.bpProgress && <span className="chat-bp__verify-step"> · {msg.bpProgress}</span>}
          </span>
        </div>
      ) : (
        // Give up far left · Reset then Save pinned far right (Save is the primary teal CTA).
        // Buttons reuse the Files editor's fb-editor__btn family so they match app-wide.
        <div className="chat-bp__actions">
          <button type="button" className="fb-editor__btn fb-editor__btn--ghost fb-editor__btn--sm"
            onClick={() => onGiveUp && onGiveUp(msg)}>
            Give up
          </button>
          <span className="chat-bp__spacer" />
          <button type="button" className="fb-editor__btn fb-editor__btn--secondary"
            onClick={() => setText(msg.draftYaml || "")} disabled={!dirty}
            title={dirty ? "Revert your edits to the drafted config" : "No edits to revert"}>
            <Icon name="rotate-ccw" size={14} /> Reset
          </button>
          <button type="button" className="fb-editor__btn" onClick={() => onSave && onSave(msg, text)}>
            <Icon name="check" size={14} strokeWidth={2.4} /> Save &amp; test-install
          </button>
        </div>
      )}
    </div>
  );

  // Popped out: leave a quiet placeholder in the inline slot and reparent the real
  // card into a portaled modal slot (portaled to <body> — .app__main is a
  // container-type ancestor that would otherwise clip a fixed child). ReversablePortal
  // moves the DOM node, so the Monaco editor + `text` binding survive the toggle.
  // Same pattern as FileBrowser / ConsolePanel.
  return (
    <ReversablePortal
      fullscreen={expanded}
      onClose={() => setExpanded(false)}
      scrimClassName="chat-bp-modal-scrim"
      modalClassName="chat-bp-modal"
      ariaLabel={"Review the " + game + " config"}
      placeholder={(
        <div className="chat-bp chat-bp--placeholder">
          <Icon name="maximize-2" size={22} strokeWidth={1.6} />
          <div className="chat-bp__placeholder-text">Reviewing {game} in full screen.</div>
          <button type="button" className="fb-editor__btn fb-editor__btn--secondary fb-editor__btn--sm"
            onClick={() => setExpanded(false)}>
            <Icon name="minimize-2" size={13} /> Restore
          </button>
        </div>
      )}>
      {body}
    </ReversablePortal>
  );
}

export { ChatBlueprintDraft };

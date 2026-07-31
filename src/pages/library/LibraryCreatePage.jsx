// LibraryCreatePage (#/library/new) — author a brand-new blueprint.
//
// The buffer is seeded from the ENGINE's own blueprint.tp skeleton
// (GET /library/scaffold), so the manual path and the assistant's authoring lane
// start from one template — the SPA never carries a skeleton of its own.
//
// Two audiences on one page (§7.4):
//   Admin    — full editor, Save writes POST /library, assistant hand-off optional.
//   Operator — the same editor read-only, with the assistant hand-off as the
//              primary action. Creation is admin-only server-side, so the editor
//              is a launchpad for an operator, not a dead end.
//
// A blueprint file lives on ONE host's disk, so the host is explicit: auto-selected
// when only one qualifies, picked otherwise.

import React from "react";
import { BlueprintHostPicker } from "./BlueprintHostPicker.jsx";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { ReversablePortal } from "../../components/ReversablePortal.jsx";
import { hostCapability } from "../../lib/capabilities.js";
import { canOn, isAdmin } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { blueprintFileStore, hostsStore, libraryStore } from "../../lib/stores.js";

const CodeEditor = React.lazy(() => import("../../components/CodeEditor.jsx"));

// The engine's own rule for a blueprint name, mirrored so a bad name is caught before
// the round trip. The API refuses independently — this is a courtesy, not the authority.
const NAME_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const NAME_MAX = 64;

function LibraryCreatePage({ onBrowse, onOpenGame, onAskAssistant }) {
  const allHosts = useStore(hostsStore, s => s.list);

  // ---- host selection ------------------------------------------------------
  // A host qualifies when the user can at least operate on it: an admin creates
  // here, an operator hands off to that host's assistant. Either way the file
  // lands on the host chosen here.
  const hosts = React.useMemo(
    () => (allHosts || []).filter(h => canOn("server.operate", h.id)),
    [allHosts],
  );
  const [selectedHostId, setSelectedHostId] = React.useState(null);
  React.useEffect(() => {
    if (hosts.length === 0) { setSelectedHostId(null); return; }
    if (!hosts.some(h => h.id === selectedHostId)) setSelectedHostId(hosts[0].id);
  }, [hosts, selectedHostId]);

  const hostId = selectedHostId;
  const hostObj = hostId ? hosts.find(h => h.id === hostId) || null : null;
  const canWrite = hostId ? isAdmin(hostId) : false;

  // The assistant hand-off is offered only where that host actually provisions one
  // (§7.5) — absent means the button is not rendered, never a promise we can't keep.
  const assistantCap = hostObj ? hostCapability(hostObj, "assistant") : null;
  const hasAssistant = !!assistantCap && assistantCap.state !== "absent";

  // ---- buffer --------------------------------------------------------------
  const [name, setName] = React.useState("");
  const [scaffold, setScaffold] = React.useState(null);
  const [draft, setDraft] = React.useState("");
  const [loadError, setLoadError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState(null);     // engine validator messages
  const [nameError, setNameError] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);

  // Seed from the engine's skeleton on mount / host change.
  React.useEffect(() => {
    if (!hostId) return;
    let live = true;
    setScaffold(null); setDraft(""); setLoadError(null); setErrors(null); setNameError(null);
    blueprintFileStore.scaffold(hostId).then(
      (text) => { if (live) { setScaffold(text); setDraft(text); } },
      (err) => { if (live) setLoadError(err); },
    );
    return () => { live = false; };
  }, [hostId]);

  // ---- actions -------------------------------------------------------------
  const errText = (e, fallback) => (e && (e.userMessage || e.message)) || fallback;
  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= NAME_MAX && NAME_RE.test(trimmedName);

  const save = () => {
    if (!hostId || saving || !canWrite) return;
    if (!nameValid) {
      setNameError(trimmedName
        ? "Use lowercase letters, digits, and single - or _ separators."
        : "Give the blueprint a name.");
      return;
    }
    setSaving(true); setErrors(null); setNameError(null);
    blueprintFileStore.create(hostId, trimmedName, draft).then(
      // Re-hydrate the catalog BEFORE navigating: the game page resolves its game out of
      // libraryStore, which still holds the pre-create list, so landing there first shows
      // "that game isn't in the library". A refresh failure doesn't strand the user — the
      // blueprint exists either way, so navigate regardless and let the page retry.
      () => libraryStore.refresh().catch(() => {}).then(() => {
        setSaving(false);
        onOpenGame(trimmedName);
      }),
      (e) => {
        setSaving(false);
        if (e && e.envCode === "name_taken") {
          setNameError(errText(e, "That name is already taken."));
        } else if (e && e.envCode === "blueprint_invalid" && e.details && e.details.errors) {
          setErrors(e.details.errors);
        } else {
          setErrors([errText(e, "Couldn’t create this blueprint.")]);
        }
      },
    );
  };

  const reset = () => {
    if (scaffold != null) setDraft(scaffold);
    setErrors(null); setNameError(null);
  };

  const ask = () => {
    if (!hostId) return;
    onAskAssistant(trimmedName || null, hostId);
  };

  // ---- no eligible host ----------------------------------------------------
  if (hosts.length === 0) {
    return (
      <>
        <div className="library-head">
          <div className="dash-head__row">
            <h1>New blueprint</h1>
          </div>
          <div className="library-head__sub">
            You don’t have permission to author blueprints on any connected host. Ask an admin.
          </div>
        </div>
        <button className="fb-editor__btn fb-editor__btn--secondary" onClick={onBrowse}>
          <Icon name="arrow-left" size={13} /> Back to the catalog
        </button>
      </>
    );
  }

  const loading = !scaffold && !loadError;

  const headerAction = (
    <div className="bp-editor__actions">
      <BlueprintHostPicker
        hosts={hosts} selectedId={hostId} onSelect={setSelectedHostId}
        title="Which host to create it on" />
    </div>
  );

  const cardBody = (
    <div className="bp-editor bp-create">
      {/* The expand toggle lives in the BODY, not the card header — the same place the file
          browser and the console keep theirs — so it travels into the pop-out and is the way
          back out of it. A control left in the header stays behind in the inline slot, and the
          modal ends up with no visible way to close. */}
      <div className="fb-editor__bar">
        <Icon name="file-code" size={14} />
        <span className="fb-editor__path"><b>{(trimmedName || "new") + ".bp.yaml"}</b></span>
        <span className="fb-editor__spacer" />
        <button type="button" className="fb-editor__expand" onClick={() => setExpanded(v => !v)}
          title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
          aria-label={expanded ? "Exit full screen" : "Expand to full screen"}>
          <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
        </button>
      </div>

      {/* Operators can't POST — say so, and point at the path they DO have (§7.4). */}
      {!canWrite && (
        <div className="bp-create__banner">
          <Icon name="info" size={13} />
          <span>
            Operators create blueprints through the assistant. The editor below is read-only —
            {hasAssistant
              ? " use “Ask the assistant” to have it research, draft and test-install one."
              : " this host has no assistant, so ask an admin to author it."}
          </span>
        </div>
      )}

      {/* Name */}
      <div className="bp-create__name">
        <label className="bp-create__name-label" htmlFor="bp-create-name">Blueprint name</label>
        <input
          id="bp-create-name"
          className={"bp-create__name-input" + (nameError ? " bp-create__name-input--bad" : "")}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(null); }}
          placeholder="e.g. necesse"
          maxLength={NAME_MAX}
          spellCheck={false}
          autoComplete="off"
          disabled={!canWrite || saving} />
        <div className="bp-create__name-hint">
          {nameError
            ? <span className="bp-create__name-err">{nameError}</span>
            : <>Lowercase, digits, and <code>-</code>/<code>_</code>. This becomes <code>{(trimmedName || "‹name›") + ".bp.yaml"}</code>.</>}
        </div>
      </div>

      {/* Editor */}
      <div className="bp-editor__monaco-wrap">
        {loadError ? (
          <div className="fb-editor__empty">
            <Icon name="alert-triangle" size={16} />
            {errText(loadError, "Couldn’t load the blueprint template from this host.")}
          </div>
        ) : loading ? (
          <div className="fb-editor__empty"><span className="oauth-spinner" /> Loading template…</div>
        ) : (
          <React.Suspense fallback={<div className="fb-editor__empty"><span className="oauth-spinner" /> Loading editor…</div>}>
            <CodeEditor
              value={draft} onChange={setDraft}
              path={(trimmedName || "blueprint") + ".bp.yaml"}
              readOnly={!canWrite} />
          </React.Suspense>
        )}
      </div>

      {/* Validation errors — the engine's own messages, one per line */}
      {errors && errors.length > 0 && (
        <div className="bp-editor__errors">
          <Icon name="alert-triangle" size={13} />
          <span>The engine rejected this blueprint:</span>
          <ul className="bp-editor__errors-list">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="bp-editor__foot">
        <span className="fb-editor__spacer" />
        {hasAssistant && (
          <button
            className={"fb-editor__btn " + (canWrite ? "fb-editor__btn--ghost" : "")}
            type="button" onClick={ask} disabled={saving}
            title="Have the assistant research, draft and test-install a blueprint for this game">
            <Icon name="sparkles" size={14} /> Ask the assistant
          </button>
        )}
        {canWrite && (<>
          <button className="fb-editor__btn fb-editor__btn--secondary" type="button" onClick={reset}
            disabled={saving || !scaffold || draft === scaffold}>
            <Icon name="rotate-ccw" size={14} /> Reset
          </button>
          <button className="fb-editor__btn" type="button" onClick={save} disabled={saving || !scaffold}>
            {saving ? <><span className="oauth-spinner" /> Creating…</> : <><Icon name="check" size={14} strokeWidth={2.4} /> Create blueprint</>}
          </button>
        </>)}
      </div>

      <div className="bp-editor__note">
        Saving writes an engine-validated file — it does not boot-test the server. The assistant’s
        path does test-install and verify.
      </div>
    </div>
  );

  return (
    <>
      <div className="library-head">
        <div className="dash-head__row">
          <h1>New blueprint</h1>
          <button className="fb-editor__btn fb-editor__btn--secondary" onClick={onBrowse}>
            <Icon name="arrow-left" size={13} /> Back to the catalog
          </button>
        </div>
        <div className="library-head__sub">
          A blueprint is the complete definition of a game server — how it installs, launches, and
          is configured. It lands on {hostObj ? hostObj.name : "the selected host"}.
        </div>
      </div>

      <BriefCard icon="file-code" title="Blueprint file" action={headerAction} className="bp-briefcard">
        <ReversablePortal
          fullscreen={expanded}
          onClose={() => setExpanded(false)}
          scrimClassName="fb-modal-scrim"
          modalClassName="fb-modal"
          ariaLabel="New blueprint"
          placeholder={(
            <div className="fb-popped-placeholder">
              <Icon name="maximize-2" size={24} strokeWidth={1.6} />
              <div style={{ fontSize: 13 }}>Editing in full screen.</div>
              <button type="button" className="fb-editor__btn fb-editor__btn--secondary fb-editor__btn--sm" onClick={() => setExpanded(false)}>
                <Icon name="minimize-2" size={13} /> Restore
              </button>
            </div>
          )}>
          {cardBody}
        </ReversablePortal>
      </BriefCard>
    </>
  );
}

export { LibraryCreatePage };
export default LibraryCreatePage;

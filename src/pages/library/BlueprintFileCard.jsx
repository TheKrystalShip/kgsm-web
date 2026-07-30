import React from "react";
import { createPortal } from "react-dom";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { ReversablePortal } from "../../components/ReversablePortal.jsx";
import { formatBytes } from "../../lib/formatting.js";
import { canOn, isAdmin } from "../../lib/persona.js";
import { useStore } from "../../lib/store.js";
import { blueprintFileStore, hostsStore } from "../../lib/stores.js";

// Monaco is heavy + worker-backed, lazy-loaded: the chunk downloads only when
// the editor is actually opened. Same module as FileBrowser — resolves to the
// same Rollup chunk, zero material bundle cost.
const CodeEditor = React.lazy(() => import("../../components/CodeEditor.jsx"));

// BlueprintFileCard — a BriefCard on the game detail page that lets admins
// view and edit a blueprint's raw .bp.yaml through Monaco. One card per game;
// the host is auto-selected when only one offering host exists, or picked from
// a dropdown when several do.
//
// §5.1: reuses CodeEditor (YAML highlighting via path), BriefCard (card shell),
// ReversablePortal (full-screen pop-out, same editor instance across the toggle),
// and the etag/412 handling pattern from FileBrowser.
// §5.2: host resolution via offeringHosts (passed from GamePage).
// §5.3: gating — Operator+ reads, Admin writes, non-readers see no card.

function BlueprintFileCard({ game, offeringHosts }) {
  const name = game && game.id;
  const hosts = React.useMemo(() => offeringHosts || [], [offeringHosts]);

  // ---- host selection (§5.2) -----------------------------------------------
  const allHosts = useStore(hostsStore, s => s.list);
  const [selectedHostId, setSelectedHostId] = React.useState(() => {
    if (hosts.length === 1) return hosts[0].id;
    return hosts.length > 0 ? hosts[0].id : null;
  });
  // Sync when offering hosts change (e.g. catalog refresh).
  React.useEffect(() => {
    if (hosts.length === 1) setSelectedHostId(hosts[0].id);
    else if (hosts.length > 0 && !hosts.some(h => h.id === selectedHostId)) setSelectedHostId(hosts[0].id);
  }, [hosts, selectedHostId]);

  const hostId = selectedHostId;
  const hostObj = hostId ? allHosts.find(h => h.id === hostId) || null : null;

  // ---- gating (§5.3) -------------------------------------------------------
  const canRead = hostId ? canOn("server.operate", hostId) : false;
  const canWrite = hostId ? isAdmin(hostId) : false;

  // ---- store data -----------------------------------------------------------
  const entry = useStore(blueprintFileStore, s => hostId && name ? s.byKey[hostId + "/" + name] || null : null);
  const status = entry ? entry.status : "idle";
  const content = entry ? entry.content : null;
  const etag = entry ? entry.etag : null;
  const tier = entry ? entry.tier : null;
  const overridesSystem = entry ? entry.overridesSystem : false;
  const canRevert = entry ? entry.canRevert : false;
  const apiReadOnly = entry ? entry.readOnly : true;
  const runtime = entry ? entry.runtime : null;
  const sizeBytes = entry ? entry.sizeBytes : null;

  // ---- local editor state ---------------------------------------------------
  const [draft, setDraft] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [reverting, setReverting] = React.useState(false);
  const [errors, setErrors] = React.useState(null);  // validation errors[]
  const [staleReload, setStaleReload] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [hostMenuOpen, setHostMenuOpen] = React.useState(false);
  const hostTriggerRef = React.useRef(null);
  const hostMenuRef = React.useRef(null);

  // Load on mount / host change / name change.
  React.useEffect(() => {
    if (!hostId || !name || !canRead) return;
    setDraft(""); setDirty(false); setErrors(null); setStaleReload(false);
    blueprintFileStore.load(hostId, name).then(
      (e) => { if (e) setDraft(e.content || ""); },
      () => {},
    );
  }, [hostId, name, canRead]);

  // Track dirty against the last-loaded content.
  React.useEffect(() => {
    setDirty(!!content && draft !== content);
  }, [draft, content]);

  // ---- actions --------------------------------------------------------------
  const errText = (e, fallback) => (e && (e.userMessage || e.message)) || fallback;

  const save = () => {
    if (!hostId || !name || saving || !dirty) return;
    setSaving(true); setErrors(null); setStaleReload(false);
    blueprintFileStore.save(hostId, name, draft, etag).then(
      () => { setSaving(false); },
      (e) => {
        setSaving(false);
        if (e && (e.code === 412 || e.envCode === "precondition_failed")) {
          setStaleReload(true);
        } else if (e && e.envCode === "blueprint_invalid" && e.details && e.details.errors) {
          setErrors(e.details.errors);
        } else {
          setErrors([errText(e, "Couldn\u2019t save.")]);
        }
      },
    );
  };

  const reset = () => {
    if (content != null) setDraft(content);
    setErrors(null); setStaleReload(false);
  };

  const reload = () => {
    if (!hostId || !name) return;
    setErrors(null); setStaleReload(false);
    blueprintFileStore.load(hostId, name).then(
      (e) => { if (e) setDraft(e.content || ""); },
      () => {},
    );
  };

  const revert = () => {
    if (!hostId || !name || reverting) return;
    if (!window.confirm("Revert to the shipped blueprint? This removes your local override.")) return;
    setReverting(true); setErrors(null);
    blueprintFileStore.revert(hostId, name).then(
      (e) => { setReverting(false); if (e) setDraft(e.content || ""); },
      () => { setReverting(false); },
    );
  };

  // ---- host picker (§5.2) ---------------------------------------------------
  // Close on outside click.
  React.useEffect(() => {
    if (!hostMenuOpen) return;
    const h = (e) => {
      if (hostTriggerRef.current && hostTriggerRef.current.contains(e.target)) return;
      if (hostMenuRef.current && hostMenuRef.current.contains(e.target)) return;
      setHostMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [hostMenuOpen]);

  // ---- early exits ----------------------------------------------------------
  if (!canRead || !name || hosts.length === 0) return null;

  const loading = status === "loading" || status === "idle";
  const readOnly = apiReadOnly || !canWrite;
  const manyHosts = hosts.length > 1;

  // ---- header action slot ---------------------------------------------------
  const tierLabel = tier === "user" ? "Custom" : tier === "system" ? "Shipped" : null;
  const metaParts = [];
  if (runtime) metaParts.push(runtime);
  if (tierLabel) metaParts.push(tierLabel);

  const headerAction = (
    <div className="bp-editor__actions">
      {manyHosts && (
        <div className="bp-editor__host" ref={hostTriggerRef}>
          <button
            className={"bp-editor__host-trigger" + (hostMenuOpen ? " bp-editor__host-trigger--open" : "")}
            onClick={() => setHostMenuOpen(o => !o)}
            title="Which host to edit"
            aria-haspopup="listbox"
            aria-expanded={hostMenuOpen}>
            <span className="bp-editor__host-name">{hostObj ? hostObj.name : "Select host"}</span>
            <Icon name="chevrons-up-down" size={13} />
          </button>
          {hostMenuOpen && createPortal(
            <div className="bp-editor__host-menu" role="listbox" ref={hostMenuRef}
              style={{ position: "fixed", top: "var(--bp-host-top, 0)", right: 16, zIndex: 1000 }}>
              {hosts.map(h => {
                const active = h.id === hostId;
                return (
                  <button key={h.id}
                    className={"bp-editor__host-opt" + (active ? " bp-editor__host-opt--active" : "")}
                    onClick={() => { setHostMenuOpen(false); if (!active) setSelectedHostId(h.id); }}
                    role="option" aria-selected={active}>
                    <span>{h.name}</span>
                    {active && <Icon name="check" size={14} />}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
        </div>
      )}
      <button className="fb-editor__expand" onClick={() => setExpanded(v => !v)}
        title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}>
        <Icon name={expanded ? "minimize-2" : "maximize-2"} size={14} />
      </button>
    </div>
  );

  // ---- the editor body (projected inline OR in the full-screen modal via
  //      ReversablePortal — the same Monaco instance/model moves across slots,
  //      so edits in full screen stay bound to `draft` and are never lost) -----
  const cardBody = (
    <div className="bp-editor">
      {/* Override badge + meta strip */}
      {overridesSystem && (
        <div className="bp-editor__override">
          <Icon name="alert-triangle" size={13} />
          <span>Overridden</span>
          <span className="bp-editor__override-note">
            A local copy is shadowing the shipped blueprint. It will not receive upstream updates.
          </span>
        </div>
      )}

      {/* Editor */}
      <div className="bp-editor__monaco-wrap">
        {loading ? (
          <div className="fb-editor__empty"><span className="oauth-spinner" /> Loading blueprint…</div>
        ) : (
          <React.Suspense fallback={<div className="fb-editor__empty"><span className="oauth-spinner" /> Loading editor…</div>}>
            <CodeEditor value={draft} onChange={setDraft} path={name + ".bp.yaml"} readOnly={readOnly} />
          </React.Suspense>
        )}
      </div>

      {/* Validation errors */}
      {errors && errors.length > 0 && (
        <div className="bp-editor__errors">
          <Icon name="alert-triangle" size={13} />
          <span>The engine rejected this blueprint:</span>
          <ul className="bp-editor__errors-list">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Stale etag banner */}
      {staleReload && (
        <div className="bp-editor__stale">
          <Icon name="alert-triangle" size={13} /> This blueprint changed on disk since you loaded it.
          <button className="fb-editor__btn fb-editor__btn--secondary fb-editor__btn--sm" onClick={reload} style={{ marginLeft: 8 }}>
            Reload
          </button>
        </div>
      )}

      {/* Footer bar */}
      {!readOnly && (
        <div className="bp-editor__foot">
          {dirty && <span className="fb-editor__dirty"><span className="dot" /> unsaved changes</span>}
          <span className="fb-editor__spacer" />
          <span style={{ color: "var(--fg-4)", fontSize: 11 }}>{formatBytes(sizeBytes)}</span>
          <button className="fb-editor__btn fb-editor__btn--secondary" type="button" onClick={reset} disabled={!dirty || saving || reverting}>
            <Icon name="rotate-ccw" size={14} /> Reset
          </button>
          {canRevert && (
            <button className="fb-editor__btn fb-editor__btn--ghost" type="button" onClick={revert} disabled={saving || reverting}
              title="Remove your local override and restore the shipped blueprint">
              {reverting ? <><span className="oauth-spinner" /> Reverting…</> : <><Icon name="undo-2" size={14} /> Revert to original</>}
            </button>
          )}
          <button className="fb-editor__btn" type="button" onClick={save} disabled={!dirty || saving || reverting}>
            {saving ? <><span className="oauth-spinner" /> Saving…</> : <><Icon name="check" size={14} strokeWidth={2.4} /> Save</>}
          </button>
        </div>
      )}

      {/* Note about installed instances */}
      <div className="bp-editor__note">
        Editing a blueprint does not retroactively change already-installed instances.
      </div>
    </div>
  );

  // ---- render ---------------------------------------------------------------
  return (
    <BriefCard icon="file-code" title="Blueprint file" action={headerAction} className="bp-briefcard">
      {metaParts.length > 0 && (
        <div className="bp-editor__meta">
          {metaParts.map((m, i) => <span key={i} className="bp-editor__meta-chip">{m}</span>)}
        </div>
      )}
      <ReversablePortal
        fullscreen={expanded}
        onClose={() => setExpanded(false)}
        scrimClassName="fb-modal-scrim"
        modalClassName="fb-modal"
        ariaLabel={"Blueprint file \u2014 " + name}
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
  );
}

export { BlueprintFileCard };
export default BlueprintFileCard;

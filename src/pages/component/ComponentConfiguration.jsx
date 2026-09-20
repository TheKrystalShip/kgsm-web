// ComponentConfiguration — every setting a component declares, with where its value comes from, what
// changing it risks, and one apply that batches every edit into a single restart.
//
// One body for every component, whether a node relays to it or it answers at its own address: it is
// handed a surface and cannot tell which. That is the whole point — the descriptor, the provenance
// tiers, the risk badges and the reset mean the same thing wherever the component runs, and a second
// rendering of them would be free to disagree with this one about what a value is.
//
// Applying restarts the component. There is no canary and no rollback on a component that serves its
// own surface, and that is a property of the situation rather than a missing feature: the process
// that would watch the restart and put the old values back is the process being restarted. So the
// review names what is about to happen, and the component's own log names the file to remove if it
// does not come back.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import {
  Toolbar, ToolbarButton, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer,
} from "../../components/Toolbar.jsx";
import { copyText } from "../../lib/clipboard.js";
import { ComponentConfigRow } from "./ComponentConfigRow.jsx";
import { ComponentConfigReview } from "./ComponentConfigReview.jsx";
import {
  buildPayload, dirtyFields, filterFields, groupFields, isDirty, isOverridden,
} from "./componentConfigHelpers.js";

const FILTER_LABEL = { all: "All", modified: "Modified", risky: "Risky", unknown: "Unknown" };

// The apply outcomes, rendered honestly. A rollback is not a success, `applied_unreachable` is not a
// failure — the change IS live, the panel just cannot see the component any more — and
// `written_not_applied` is neither: the change is on disk and is NOT in force, which reads nothing
// like a change being applied and must not be shown as one.
const OUTCOME = {
  applied: { tone: "ok", icon: "circle-check", title: "Applied" },
  unchanged: { tone: "info", icon: "info", title: "Nothing to apply" },
  rolled_back: { tone: "warn", icon: "triangle-alert", title: "Rolled back" },
  applied_unreachable: { tone: "warn", icon: "triangle-alert", title: "Applied — but unreachable" },
  written_not_applied: { tone: "warn", icon: "triangle-alert", title: "Written, not in force" },
};

// What each outcome means, where the component itself said nothing. A component's own message wins
// over every one of these.
const OUTCOME_SAID = {
  applied: "The component restarted and reports healthy.",
  written_not_applied:
    "The change is on disk, but the restart that would pick it up was refused — so the component is "
    + "still running the values it had.",
};

/**
 * @param surface        what reaches this component — `lib/componentSurface.js`.
 * @param onConfigChange told what came back, so a page can name facts about it in its own header.
 * @param onApplied      told an apply landed, for whatever the page keeps that this changes.
 * @param restartWarning what this particular component going down costs, named in the review.
 */
function ComponentConfiguration({ surface, onConfigChange, onApplied, restartWarning }) {
  const [config, setConfig] = React.useState(null);
  const [loadState, setLoadState] = React.useState("loading");   // loading | ready | none | error
  const [loadErr, setLoadErr] = React.useState(null);
  const [drafts, setDrafts] = React.useState({});
  const [resets, setResets] = React.useState(() => new Set());
  const [shut, setShut] = React.useState(() => new Set());
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [reviewing, setReviewing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [copyState, setCopyState] = React.useState(null);   // { key, ok } | null

  const surfaceKey = surface ? surface.key : null;
  const label = (surface && surface.label) || "This component";

  // Held in a ref so the load effect depends on the surface's IDENTITY rather than on the object,
  // which a parent rebuilds on every render. Keyed by that identity, a re-render re-reads nothing
  // and a genuine change re-reads everything.
  const surfaceRef = React.useRef(surface);
  surfaceRef.current = surface;

  const changed = React.useRef(onConfigChange);
  changed.current = onConfigChange;

  const hydrate = React.useCallback((cfg) => {
    setConfig(cfg);
    setDrafts({});
    setResets(new Set());
    if (changed.current) changed.current(cfg);
  }, []);

  React.useEffect(() => {
    if (!surfaceKey) { setLoadState("error"); setLoadErr(null); return undefined; }

    let cancelled = false;
    setLoadState("loading"); setLoadErr(null); setResult(null);
    setQuery(""); setFilter("all"); setShut(new Set());

    Promise.resolve(surfaceRef.current.readConfig()).then(
      (cfg) => {
        if (cancelled) return;
        // A surface that answered with nothing is not a surface with no settings, and the two must
        // not read alike.
        if (cfg) { hydrate(cfg); setLoadState("ready"); } else { setLoadState("error"); }
      },
      (e) => {
        if (cancelled) return;
        setLoadErr(e);
        // 404 is the ordinary answer for a component that ships no descriptor, and it is a different
        // thing from a failure to ask.
        setLoadState(e && e.status === 404 ? "none" : "error");
      },
    );

    return () => { cancelled = true; };
  }, [surfaceKey, hydrate]);

  const fields = (config && config.fields) || [];
  const editable = !!(config && config.editable);
  const staged = dirtyFields(fields, drafts, resets);

  const setField = React.useCallback((key, val) => {
    setDrafts(d => {
      const next = { ...d };
      if (val === undefined) delete next[key]; else next[key] = val;
      return next;
    });
  }, []);

  // Reset and edit are mutually exclusive on one key: staging a reset clears any draft, so the
  // payload can never carry both for the same field.
  const toggleReset = React.useCallback((key) => {
    setResets(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else { n.add(key); setField(key, undefined); }
      return n;
    });
  }, [setField]);

  // Reports the outcome, never the intent: a refused clipboard is worth knowing about here, since
  // the whole point of the button is to paste the line into a unit file or a shell.
  const copyEnv = (f) => {
    const line = f.envName + "=" + (f.effective == null ? "" : f.effective);
    copyText(line).then(ok => {
      setCopyState({ key: f.key, ok });
      setTimeout(() => setCopyState(c => (c && c.key === f.key ? null : c)), ok ? 1200 : 2600);
    });
  };

  const discard = () => { setDrafts({}); setResets(new Set()); };

  const apply = () => {
    if (busy || !config || !staged.length || !surfaceRef.current) return;
    setBusy(true); setResult(null);
    Promise.resolve(surfaceRef.current.applyConfig(buildPayload(fields, drafts, resets))).then(
      (res) => {
        setResult(res);
        if (res && res.config) hydrate(res.config);
        else { setDrafts({}); setResets(new Set()); }
        if (onApplied) onApplied(res);
      },
      (e) => setResult({
        outcome: "rolled_back", health: null, config: null,
        message: (e && (e.userMessage || e.message)) || "The change could not be applied.",
      }),
    ).finally(() => { setBusy(false); setReviewing(false); });
  };

  if (loadState === "loading") {
    return (
      <div className="lcf-state"><Icon name="loader" size={20} className="act-spin" />
        <span>Reading {label} configuration…</span></div>
    );
  }

  if (loadState === "none") {
    return (
      <div className="lcf-state"><Icon name="info" size={20} />
        <span>{label} publishes no configuration surface, so there is nothing to configure here.</span></div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="lcf-state lcf-state--error"><Icon name="triangle-alert" size={20} />
        <span>
          Couldn’t read {label}’s configuration
          {loadErr && (loadErr.userMessage || loadErr.message)
            ? " — " + (loadErr.userMessage || loadErr.message) : "."}
        </span></div>
    );
  }

  const visible = filterFields(fields, { query, filter, drafts, resets });
  const groups = groupFields(config, visible);
  const allShut = groups.length > 0 && groups.every(g => shut.has(g.id));

  const counts = {
    all: fields.length,
    modified: fields.filter(f => isDirty(f, drafts, resets) || isOverridden(f)).length,
    risky: fields.filter(f => f.risk !== "safe").length,
    unknown: fields.filter(f => f.source === "unknown").length,
  };

  const shape = result ? (OUTCOME[result.outcome] || OUTCOME.unchanged) : null;

  return (
    <>
      {result && (
        <div className={"lcf-note lcf-note--" + shape.tone}>
          <Icon name={shape.icon} size={15} />
          <span>
            <b>{shape.title}.</b>{" "}
            {result.message || OUTCOME_SAID[result.outcome] || ""}
            {result.health && result.health.message && result.health.message !== result.message
              ? " " + result.health.message : ""}
          </span>
          <button className="lcf-iconbtn" onClick={() => setResult(null)} aria-label="Dismiss">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {config && !editable && config.editableReason && (
        <div className="lcf-note lcf-note--lock">
          <Icon name="lock" size={15} />
          <span><b>Read-only.</b> {config.editableReason}</span>
        </div>
      )}

      {config && !config.fromDescriptor && (
        <div className="lcf-note lcf-note--info">
          <Icon name="info" size={15} />
          <span>
            No configuration descriptor was found for this component, so only the settings already
            known by name are listed — not necessarily the whole surface.
          </span>
        </div>
      )}

      {fields.length > 0 && (
        <>
          <Toolbar className="lcf-toolbar">
            <ToolbarSearch value={query} onChange={setQuery}
              placeholder={"Search " + fields.length + " settings, keys or descriptions…"} />
            <ToolbarFilters fields={[{
              id: "show", label: "Show", value: filter, onChange: setFilter, default: "all",
              options: Object.keys(FILTER_LABEL)
                .filter(k => k === "all" || counts[k] > 0)
                .map(k => ({ value: k, label: FILTER_LABEL[k], count: counts[k] })),
            }]} />
            <ToolbarSpacer />
            <ToolbarCount shown={visible.length} total={fields.length} unit="settings" />
            {groups.length > 1 && (
              <ToolbarButton icon={allShut ? "plus" : "minus"}
                onClick={() => setShut(allShut ? new Set() : new Set(groups.map(g => g.id)))}>
                {allShut ? "Expand all" : "Collapse all"}
              </ToolbarButton>
            )}
          </Toolbar>

          {groups.length === 0 ? (
            <div className="lcf-state">
              <Icon name="search" size={20} />
              <span>No setting matches {query ? <b>{query}</b> : "this filter"}.</span>
            </div>
          ) : (
            <div className="lcf-groups">
              {groups.map(g => {
                const edited = g.fields.filter(f => isDirty(f, drafts, resets)).length;
                return (
                  <BriefCard key={g.id} icon="layers" title={g.label} count={g.fields.length}
                    countTone="neutral" collapsible open={!shut.has(g.id)}
                    className={"lcf-group" + (edited ? " has-edits" : "")}
                    onToggle={() => setShut(s => {
                      const n = new Set(s);
                      if (n.has(g.id)) n.delete(g.id); else n.add(g.id);
                      return n;
                    })}
                    action={edited ? <span className="lcf-group__edits">{edited} edited</span> : null}>
                    <div className="lcf-group__body">
                      {g.fields.map(f => (
                        <ComponentConfigRow key={f.key} f={f} editable={editable}
                          drafts={drafts} resets={resets}
                          onChange={setField} onToggleReset={toggleReset}
                          onCopy={copyEnv} copyState={copyState} />
                      ))}
                    </div>
                  </BriefCard>
                );
              })}
            </div>
          )}
        </>
      )}

      {fields.length === 0 && (
        <div className="lcf-state"><Icon name="info" size={20} />
          <span>{label} declares no configurable settings.</span></div>
      )}

      {staged.length > 0 && (
        <div className="lcf-bar">
          <span className="lcf-bar__n"><b>{staged.length}</b> pending change{staged.length === 1 ? "" : "s"}</span>
          <span className="lcf-bar__sum">{staged.map(f => f.label).join(" · ")}</span>
          <button className="lcf-btn lcf-btn--ghost" onClick={discard}>Discard</button>
          <button className="lcf-btn lcf-btn--primary" onClick={() => setReviewing(true)}>
            <Icon name="check" size={13} strokeWidth={2.4} /> Review &amp; apply · one restart
          </button>
        </div>
      )}

      {reviewing && config && (
        <ComponentConfigReview config={config} staged={staged} drafts={drafts} resets={resets} busy={busy}
          warning={restartWarning}
          onCancel={() => setReviewing(false)} onApply={apply} />
      )}
    </>
  );
}

export { ComponentConfiguration };
export default ComponentConfiguration;

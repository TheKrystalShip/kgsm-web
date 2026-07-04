// LeafConfigModal — per-leaf runtime configuration form (admin-only).
// Reads the typed manifest, renders a control per field, and applies via PUT.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { fetchLeafConfig, applyLeafConfig } from "../../lib/stores.js";
import { ConfigFieldRow } from "./diagComponents.jsx";

function LeafConfigModal({ hostId, leaf, onClose }) {
  const [config, setConfig] = React.useState(null);
  const [loadState, setLoadState] = React.useState("loading");
  const [loadErr, setLoadErr] = React.useState(null);
  const [drafts, setDrafts] = React.useState({});
  const [secretDrafts, setSecretDrafts] = React.useState({});
  const [revealed, setRevealed] = React.useState(() => new Set());
  const [resetKeys, setResetKeys] = React.useState(() => new Set());
  const [saving, setSaving] = React.useState(false);
  const [result, setResult] = React.useState(null);

  const hydrate = React.useCallback((cfg) => {
    setConfig(cfg);
    const d = {};
    (cfg && cfg.fields ? cfg.fields : []).forEach((f) => {
      if (f.type === "secret") return;
      d[f.key] = f.value == null ? (f.type === "bool" ? false : "") : f.value;
    });
    setDrafts(d);
    setSecretDrafts({});
    setRevealed(new Set());
    setResetKeys(new Set());
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoadState("loading"); setLoadErr(null); setResult(null);
    fetchLeafConfig(hostId, leaf.id).then(
      (cfg) => { if (cancelled) return; if (cfg) { hydrate(cfg); setLoadState("ready"); } else { setLoadState("error"); } },
      (e) => { if (!cancelled) { setLoadErr(e); setLoadState("error"); } }
    );
    return () => { cancelled = true; };
  }, [hostId, leaf.id, hydrate]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setField = (key, val) => setDrafts((d) => ({ ...d, [key]: val }));
  const setSecret = (key, val) => setSecretDrafts((d) => ({ ...d, [key]: val }));
  const reveal = (key) => setRevealed((s) => { const n = new Set(s); n.add(key); return n; });
  const toggleReset = (key) => setResetKeys((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const buildPayload = () => {
    const values = {}; const reset = [];
    (config && config.fields ? config.fields : []).forEach((f) => {
      if (resetKeys.has(f.key)) { reset.push(f.key); return; }
      if (f.type === "secret") {
        const v = secretDrafts[f.key];
        if (revealed.has(f.key) && v != null && v !== "") values[f.key] = v;
        return;
      }
      const draft = drafts[f.key];
      const cur = f.value;
      if (f.type === "bool") { if (!!draft !== !!cur) values[f.key] = !!draft; return; }
      if (f.type === "int") {
        const n = (draft === "" || draft == null) ? null : Number(draft);
        if (n != null && Number.isFinite(n) && n !== cur) values[f.key] = n;
        return;
      }
      const ds = draft == null ? "" : String(draft);
      const cs = cur == null ? "" : String(cur);
      if (ds !== cs) values[f.key] = ds;
    });
    return { values, reset };
  };

  const payload = (loadState === "ready" && config) ? buildPayload() : { values: {}, reset: [] };
  const dirty = Object.keys(payload.values).length > 0 || payload.reset.length > 0;

  const save = () => {
    if (saving || !config || !dirty) return;
    setSaving(true); setResult(null);
    applyLeafConfig(hostId, leaf.id, payload).then(
      (res) => { setResult(res); if (res && res.config) hydrate(res.config); },
      (e) => setResult({ outcome: "error", health: null, message: (e && (e.userMessage || e.message)) || "Apply failed", config: null })
    ).finally(() => setSaving(false));
  };

  const fields = (config && config.fields) || [];
  const title = (config && config.displayName) || leaf.displayName || leaf.id;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal leaf-cfg" onClick={(e) => e.stopPropagation()}>
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name="sliders-horizontal" size={18} /></div>
          <div>
            <h2 className="host-editor__title">Configure {title}</h2>
            <p className="host-editor__sub">
              Runtime overrides layered on top of the deploy-floor config. Applying restarts the leaf and
              auto-rolls-back a value that fails its health check.{config && config.unit ? <> <code className="leaf-cfg__unit">{config.unit}</code></> : null}
            </p>
          </div>
          <button className="host-editor__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        <div className="host-editor__body leaf-cfg__body">
          {loadState === "loading" && (
            <div className="leaf-cfg__state"><Icon name="loader" size={20} className="act-spin" /><span>Reading {title} configuration\u2026</span></div>
          )}
          {loadState === "error" && (
            <div className="leaf-cfg__state leaf-cfg__state--error">
              <Icon name="triangle-alert" size={20} />
              <span>Couldn\u2019t read the leaf configuration{loadErr && (loadErr.userMessage || loadErr.message) ? " \u2014 " + (loadErr.userMessage || loadErr.message) : "."}</span>
            </div>
          )}
          {loadState === "ready" && fields.length === 0 && (
            <div className="leaf-cfg__state"><Icon name="info" size={20} /><span>This leaf exposes no runtime-configurable settings.</span></div>
          )}
          {loadState === "ready" && fields.length > 0 && (
            <>
              {result && (
                <div className={"leaf-cfg-result leaf-cfg-result--" + (result.outcome === "applied" ? "ok" : result.outcome === "unchanged" ? "neutral" : "warn")}>
                  <Icon name={result.outcome === "applied" ? "circle-check" : result.outcome === "unchanged" ? "info" : "triangle-alert"} size={14} strokeWidth={2.2} />
                  <span className="leaf-cfg-result__text">
                    {result.outcome === "applied" && <>Applied \u2014 the leaf restarted and is healthy.</>}
                    {result.outcome === "unchanged" && <>No changes to apply.</>}
                    {result.outcome === "rolled_back" && <>Rolled back \u2014 the value didn\u2019t stick. {result.message || "The leaf failed its health check and was restored to the previous configuration."}</>}
                    {result.outcome === "error" && <>{result.message || "The change could not be applied."}</>}
                    {result.health && result.health.message && (result.outcome === "applied") && <span className="leaf-cfg-result__sub"> {result.health.message}</span>}
                  </span>
                </div>
              )}
              <div className="leaf-cfg-fields">
                {fields.map((f) => (
                  <ConfigFieldRow key={f.key} f={f}
                    draft={drafts[f.key]} secretDraft={secretDrafts[f.key]}
                    revealed={revealed.has(f.key)} willReset={resetKeys.has(f.key)}
                    onChange={setField} onSecretChange={setSecret} onReveal={reveal} onToggleReset={toggleReset} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose}>Close</button>
          <button className="host-btn host-btn--primary" onClick={save} disabled={saving || loadState !== "ready" || !dirty}>
            {saving ? <Icon name="loader" size={14} className="act-spin" /> : <Icon name="check" size={14} strokeWidth={2.4} />}
            {saving ? "Applying\u2026" : "Apply & restart"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { LeafConfigModal };

// MonitorThresholds — the Monitor leaf's Thresholds tab: the lines this host's numbers are watched
// against, and the alerts that get raised when they are crossed.
//
// It lives on the Monitor leaf because kgsm-monitor is what evaluates these rules. It samples every
// second and decides for itself whether a value has been over its line long enough to count; the API
// only mirrors the verdict into the alert feed. So the policy is the monitor's state, administered
// where the service is — the same reasoning that puts accounts on the API leaf.
//
// Read straight from the API rather than through a store: a policy changes only when somebody changes
// it here, and a cached copy is a copy that can be stale about what the host is actually watching.
// Each save re-reads what the monitor echoed back, so what is on screen is what is running rather than
// what was typed.
//
// Whole-set save, because that is the contract underneath: the monitor validates and applies a policy
// as one thing, so a half-applied set is not a state that can exist. The page therefore edits a draft
// and sends all of it, and a refusal names the rule at fault.

import React from "react";

import { Icon } from "../../components/Icon.jsx";
import { SettingsSection, Toggle } from "../../components/settings-primitives.jsx";
import { api } from "../../lib/apiClient.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { LeafLoading, LeafNotice } from "./leafOverviewKit.jsx";

// What each metric measures, in the unit an operator types a threshold in. The monitor names the
// metric; how it reads to a person is this surface's business, which is why the labels are here and
// not on the wire.
const METRICS = {
  HostMemUsedPct: { label: "Host memory", unit: "%", scope: "host" },
  HostSwapUsedPct: { label: "Host swap", unit: "%", scope: "host" },
  HostDiskUsedPct: { label: "Disk usage", unit: "%", scope: "host", perTarget: "per mount" },
  HostLoadPerCore: { label: "Load average", unit: "×/core", scope: "host", step: 0.1 },
  HostTempC: { label: "Temperature", unit: "°C", scope: "host", perTarget: "per sensor" },
  ServerMemBytes: { label: "Server memory", unit: "bytes", scope: "server" },
  ServerCpuPctCore: { label: "Server CPU", unit: "% of a core", scope: "server" },
  ServerPids: { label: "Server processes", unit: "processes", scope: "server" },
};

const metricOf = (key) => METRICS[key] || { label: key, unit: "", scope: "host" };

function MonitorThresholds({ hostId }) {
  // The leaf page's gate is the aggregate one — admin anywhere reaches it — so the tier that decides
  // whether these are editable is the one held on THIS node. Reading is operator; changing what the
  // fleet alerts on is admin.
  const live = !!hostId && sessionStore.isLive(hostId);
  const tier = live ? sessionStore.tierOf(hostId) : null;
  const canEdit = tier === "admin";

  const [doc, setDoc] = React.useState(null);      // null = not loaded yet
  const [draft, setDraft] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const reload = React.useCallback(() => {
    if (!hostId) return Promise.resolve();
    setError(null);
    return api.host(hostId).get("/hosts/" + encodeURIComponent(hostId) + "/thresholds").then(
      (d) => { setDoc(d); setDraft(d && d.rules ? d.rules.map((r) => ({ ...r })) : []); },
      (e) => { setDoc(null); setDraft(null); setError(messageOf(e, "Couldn’t read this host’s thresholds.")); });
  }, [hostId]);

  React.useEffect(() => { reload(); }, [reload]);

  const dirty = React.useMemo(
    () => !!doc && !!draft && JSON.stringify(draft) !== JSON.stringify(doc.rules || []),
    [doc, draft]);

  const patch = (key, changes) =>
    setDraft((rules) => rules.map((r) => (r.key === key ? { ...r, ...changes } : r)));

  const save = () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    api.host(hostId).put("/hosts/" + encodeURIComponent(hostId) + "/thresholds", { rules: draft }).then(
      (applied) => {
        // Re-seed from what the monitor echoed rather than from the draft: the screen should show what
        // is running, and those are only the same thing if nothing was normalised on the way through.
        setDoc(applied);
        setDraft(applied && applied.rules ? applied.rules.map((r) => ({ ...r })) : []);
        setNotice("Thresholds applied. The monitor is watching against them from its next sample.");
      },
      (e) => setError(messageOf(e, "Couldn’t apply these thresholds.")),
    ).finally(() => setSaving(false));
  };

  const reset = () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    api.host(hostId).del("/hosts/" + encodeURIComponent(hostId) + "/thresholds").then(
      (applied) => {
        setDoc(applied);
        setDraft(applied && applied.rules ? applied.rules.map((r) => ({ ...r })) : []);
        setNotice("Back to the built-in defaults.");
      },
      (e) => setError(messageOf(e, "Couldn’t reset this host’s thresholds.")),
    ).finally(() => setSaving(false));
  };

  if (!live) return <LeafNotice title="Not signed in to this node">Sign in here to see what it’s watching.</LeafNotice>;
  if (error && !doc) return <LeafNotice title="Couldn’t read the thresholds" onRetry={reload}>{error}</LeafNotice>;
  if (!doc || !draft) return <LeafLoading what="Reading this host’s thresholds…" />;

  const hostRules = draft.filter((r) => metricOf(r.metric).scope === "host");
  const serverRules = draft.filter((r) => metricOf(r.metric).scope === "server");

  return (
    <div className="thr-tab">
      {error && <LeafNotice title="That didn’t apply">{error}</LeafNotice>}
      {notice && <div className="thr-notice thr-notice--ok">{notice}</div>}

      {!canEdit && (
        <div className="thr-notice">
          These are what this host alerts on. Changing them needs admin on this node
          {tier ? " — you’re " + tier + " here." : "."}
        </div>
      )}

      <SettingsSection
        icon="gauge"
        title="Host thresholds"
        meta={doc.source === "override"
          ? "This host runs its own thresholds" + (doc.appliedAtMs ? ", applied " + fmtWhen(doc.appliedAtMs) : "")
          : "This host runs the built-in defaults"}>
        {hostRules.map((rule) => (
          <RuleRow key={rule.key} rule={rule} canEdit={canEdit} onChange={patch} />
        ))}
      </SettingsSection>

      <SettingsSection
        icon="server"
        title="Per-server thresholds"
        meta="Absolute numbers, so they depend entirely on the game — off until you set one">
        {serverRules.map((rule) => (
          <RuleRow key={rule.key} rule={rule} canEdit={canEdit} onChange={patch} />
        ))}
      </SettingsSection>

      {canEdit && (
        <div className="thr-actions">
          <button type="button" className="lcf-btn lcf-btn--primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Applying…" : "Apply thresholds"}
          </button>
          <button type="button" className="lcf-btn lcf-btn--ghost" disabled={saving || !dirty} onClick={reload}>
            Discard changes
          </button>
          <button
            type="button"
            className="lcf-btn lcf-btn--ghost"
            disabled={saving || doc.source !== "override"}
            onClick={reset}
            title={doc.source === "override" ? "" : "This host is already on the defaults"}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

// One rule. The three numbers are shown together because they only make sense together: a value has to
// cross `warn`, stay there for `fireForSec`, and then fall `clearMargin` below it for `clearForSec`
// before the alert goes away. Splitting them across screens would let somebody set a clear margin that
// makes clearing impossible without seeing the threshold it is measured against.
function RuleRow({ rule, canEdit, onChange }) {
  const meta = metricOf(rule.metric);
  const num = (field) => (e) => {
    const raw = e.target.value;
    onChange(rule.key, { [field]: raw === "" ? null : Number(raw) });
  };

  return (
    <div className={"chat-brief__item chat-brief__item--static" + (rule.enabled ? "" : " thr-rule--off")}>
      <span className="chat-brief__icon"><Icon name="activity" size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title">
          <span className="chat-brief__titletext">{meta.label}</span>
          {meta.perTarget && <span className="thr-tag">{meta.perTarget}</span>}
        </span>
        <span className="chat-brief__detail" style={{ whiteSpace: "normal" }}>
          {describe(rule, meta)}
        </span>

        {rule.enabled && (
          <div className="thr-fields">
            <Field label="Warn at" unit={meta.unit} value={rule.warn} step={meta.step}
              disabled={!canEdit} onChange={num("warn")} />
            <Field label="Critical at" unit={meta.unit} value={rule.danger} step={meta.step}
              disabled={!canEdit} onChange={num("danger")} placeholder="none" />
            <Field label="After" unit="s" value={rule.fireForSec} disabled={!canEdit}
              onChange={num("fireForSec")} />
            <Field label="Clears below" unit={meta.unit} value={clearAt(rule)} disabled title="warn minus the clear margin" />
            <Field label="Margin" unit={meta.unit} value={rule.clearMargin} step={meta.step}
              disabled={!canEdit} onChange={num("clearMargin")} />
            <Field label="For" unit="s" value={rule.clearForSec} disabled={!canEdit}
              onChange={num("clearForSec")} />
          </div>
        )}
      </div>
      <div className="settings-row__controls">
        <Toggle on={!!rule.enabled} disabled={!canEdit} label={"Watch " + meta.label}
          onChange={(on) => onChange(rule.key, { enabled: on })} />
      </div>
    </div>
  );
}

function Field({ label, unit, value, step, disabled, onChange, placeholder, title }) {
  return (
    <label className="thr-field" title={title || ""}>
      <span className="thr-field__label">{label}</span>
      <span className="thr-field__input">
        <input
          type="number"
          step={step || "any"}
          value={value === null || value === undefined ? "" : value}
          placeholder={placeholder || ""}
          disabled={disabled}
          onChange={onChange || (() => {})} />
        {unit && <span className="thr-field__unit">{unit}</span>}
      </span>
    </label>
  );
}

// The rule in a sentence, so somebody can check what they have built without reading six boxes. A
// disabled rule says what it would do rather than what it is doing.
function describe(rule, meta) {
  if (!rule.enabled) return "Not watched.";
  const at = (n) => (n === null || n === undefined ? null : n + meta.unit);
  const parts = ["Warns above " + at(rule.warn)];
  if (rule.danger !== null && rule.danger !== undefined) parts.push("critical above " + at(rule.danger));
  parts.push("once it holds for " + secs(rule.fireForSec));
  parts.push("clears after " + secs(rule.clearForSec) + " below " + at(clearAt(rule)));
  return parts.join(", ") + ".";
}

// The value a reading has to fall under before it counts as recovered — the deadband made visible,
// because it is derived and somebody setting a margin is really setting this.
function clearAt(rule) {
  const warn = Number(rule.warn);
  const margin = Number(rule.clearMargin);
  if (!Number.isFinite(warn) || !Number.isFinite(margin)) return null;
  return Math.round((warn - margin) * 100) / 100;
}

function secs(n) {
  if (n === null || n === undefined) return "no time";
  if (n === 0) return "no time at all";
  if (n < 60) return n + "s";
  return n % 60 === 0 ? n / 60 + "m" : Math.floor(n / 60) + "m " + (n % 60) + "s";
}

function fmtWhen(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return "at an unknown time"; }
}

function messageOf(e, fallback) {
  const m = e && (e.message || (e.body && e.body.error && e.body.error.message));
  return m || fallback;
}

export { MonitorThresholds };

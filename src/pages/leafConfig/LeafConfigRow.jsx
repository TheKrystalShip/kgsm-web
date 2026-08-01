// LeafConfigRow — one setting: what it is, what it risks, where its value comes from, and the
// control that changes it. Rendered inside a group's BriefCard list, so it inherits the card
// family's surface and separators.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { Toggle } from "../../components/settings-primitives.jsx";
import { SOURCE_TITLE, draftOf, isBlank, isDirty, isOverridden, valueText } from "./leafConfigHelpers.js";

const RISK = {
  wiring: {
    icon: "triangle-alert",
    label: "wiring",
    title: "Changing this can sever the link between this leaf and something else. The leaf restarts "
      + "cleanly either way — the panel simply may not find it again.",
  },
  destructive: {
    icon: "database",
    label: "data",
    title: "Changing this can drop or orphan data that is already stored.",
  },
};

function RiskBadge({ risk }) {
  const r = RISK[risk];
  if (!r) return null;
  return (
    <span className={"lcf-risk lcf-risk--" + risk} title={r.title}>
      <Icon name={r.icon} size={10} strokeWidth={2.2} /> {r.label}
    </span>
  );
}

// The provenance chain on one line: override → floor → default, with the tier actually in effect
// lit. A leaf whose deploy file merely restates the coded default is the common case, so those two
// collapse into one entry instead of printing the same value twice.
function Chain({ f }) {
  if (f.isSecret) {
    return (
      <span className="lcf-chain">
        <span className={"lcf-chain__t" + (f.set ? " is-eff" : " is-null")}>{f.set ? "set" : "not set"}</span>
      </span>
    );
  }
  const tier = (name, val, key) => {
    if (val == null && key !== f.source) return null;
    const blank = val == null || val === "";
    return (
      <span key={key} className={"lcf-chain__t" + (key === f.source ? " is-eff" : "") + (blank ? " is-null" : "")}>
        {name} {blank ? (val === "" ? "empty" : "—") : val}
      </span>
    );
  };
  const same = f.floor != null && f.floor === f.default;
  const parts = (same
    ? [tier("override", f.overridden ? f.value : null, "override"),
       tier("floor = default", f.floor, f.source === "default" ? "default" : "floor")]
    : [tier("override", f.overridden ? f.value : null, "override"),
       tier("floor", f.floor, "floor"),
       tier("default", f.default, "default")]
  ).filter(Boolean);

  if (f.source === "unknown") {
    parts.unshift(
      <span key="unknown" className="lcf-chain__t is-eff" title={SOURCE_TITLE.unknown}>unknown</span>,
    );
  }
  return (
    <span className="lcf-chain">
      {parts.length
        ? parts.map((p, i) => (
          <React.Fragment key={i}>{i > 0 && <span className="lcf-chain__sep">·</span>}{p}</React.Fragment>
        ))
        : <span className="lcf-chain__t is-null">no value anywhere</span>}
    </span>
  );
}

// The control. On a leaf that cannot be edited here the value is TEXT with a copy-the-env-line
// affordance rather than a disabled input — a dead box invites a click that can never work.
// `draft` is the display value (falls back to what the leaf runs with); `rawDraft` is the staged
// entry itself, which is what tells a secret apart: undefined = masked, "" = the user opened the
// replace field but has not typed yet.
function Control({ f, editable, draft, rawDraft, willReset, onChange, onCopy, copied }) {
  if (!editable) {
    const t = valueText(f, f.effective);
    return (
      <div className="lcf-ro">
        <code className={"lcf-ro__v" + (isBlank(f, f.effective) ? " is-null" : "")}>{t == null ? "unset" : t}</code>
        {!f.isSecret && f.effective != null && (
          <button className="lcf-iconbtn" onClick={() => onCopy(f)} title="Copy the env line">
            <Icon name={copied ? "check" : "copy"} size={13} />
          </button>
        )}
      </div>
    );
  }

  if (f.isSecret) {
    const replacing = typeof rawDraft === "string";
    if (!replacing) {
      return (
        <div className="lcf-secret">
          <span className="lcf-secret__mask">
            {f.set
              ? <>•••••• set{f.fingerprint ? <span className="lcf-secret__fp"> ·…{f.fingerprint}</span> : null}</>
              : <span className="lcf-secret__unset">not set</span>}
          </span>
          <button className="lcf-btn lcf-btn--ghost" disabled={willReset} onClick={() => onChange(f.key, "")}>
            <Icon name="key" size={12} strokeWidth={2} /> {f.set ? "Replace" : "Set"}
          </button>
        </div>
      );
    }
    return (
      <div className="lcf-secret">
        <input type="password" className="lcf-input lcf-input--mono" autoFocus disabled={willReset}
          placeholder={f.set ? "Enter a new value to replace it" : "Enter a value"}
          value={rawDraft} onChange={(e) => onChange(f.key, e.target.value)}
          spellCheck="false" autoComplete="new-password" />
        <button className="lcf-iconbtn" title="Cancel" onClick={() => onChange(f.key, undefined)}>
          <Icon name="x" size={13} />
        </button>
      </div>
    );
  }

  if (f.type === "bool") {
    return (
      <div className="lcf-bool">
        <Toggle on={String(draft) === "true"} onChange={(on) => onChange(f.key, String(on))} />
        <span className="lcf-bool__txt">{String(draft) === "true" ? "Enabled" : "Disabled"}</span>
      </div>
    );
  }

  if (f.type === "enum" && Array.isArray(f.enum)) {
    return (
      <Select value={draft} disabled={willReset} onChange={(e) => onChange(f.key, e.target.value)}>
        {f.enum.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </Select>
    );
  }

  const numeric = f.type === "int" || f.type === "float" || f.type === "duration";
  const placeholder = f.effective == null
    ? (f.default == null ? "unset" : "unset · default " + f.default)
    : "";
  return (
    <input
      className={"lcf-input lcf-input--mono" + (numeric ? " lcf-input--num" : "")}
      type={numeric ? "number" : "text"}
      step={f.type === "float" ? "0.05" : undefined}
      min={f.min != null ? f.min : undefined}
      max={f.max != null ? f.max : undefined}
      value={draft}
      disabled={willReset}
      placeholder={placeholder}
      spellCheck="false"
      onChange={(e) => onChange(f.key, e.target.value)} />
  );
}

function LeafConfigRow({ f, editable, drafts, resets, onChange, onToggleReset, onCopy, copiedKey }) {
  const willReset = resets.has(f.key);
  const dirty = isDirty(f, drafts, resets);
  const cls = "lcf-row" + (willReset ? " is-reset" : dirty ? " is-dirty" : "");
  const sourceLabel = willReset ? "reset pending" : dirty ? "edited" : f.source;
  const sourceTone = willReset ? "pending" : dirty ? "pending" : f.source;

  return (
    <div className={cls}>
      <div className="lcf-row__l">
        <div className="lcf-row__top">
          <span className="lcf-row__label">{f.label}</span>
          <RiskBadge risk={f.risk} />
          <span className={"lcf-prov lcf-prov--" + sourceTone} title={SOURCE_TITLE[f.source] || ""}>
            {sourceLabel}
          </span>
          {f.dependsOn && <span className="lcf-row__dep">needs {f.dependsOn}</span>}
        </div>
        {f.description && <div className="lcf-row__desc">{f.description}</div>}
        {f.envName && <div className="lcf-row__env"><code>{f.envName}</code></div>}
      </div>
      <div className="lcf-row__r">
        <Control f={f} editable={editable} draft={draftOf(f, drafts)} rawDraft={drafts[f.key]} willReset={willReset}
          onChange={onChange} onCopy={onCopy} copied={copiedKey === f.key} />
        <div className="lcf-row__under">
          <Chain f={f} />
          {editable && isOverridden(f) && (
            <button className="lcf-reset" onClick={() => onToggleReset(f.key)}>
              <Icon name="rotate-ccw" size={11} strokeWidth={2} />
              {willReset ? "keep override" : "reset"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { LeafConfigRow, RiskBadge };

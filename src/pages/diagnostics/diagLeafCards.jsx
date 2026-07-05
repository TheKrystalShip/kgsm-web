// Leaf/service diagnostics cards — StatusLed, LeafProvisionControl, LeafCard,
// ConfigFieldRow, ServicesSummaryCard. Split out of diagComponents.jsx (#8);
// re-exported from there so consumers are unchanged. Pure render + narrow local state.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { servicesStore, setLeafProvisioned } from "../../lib/stores.js";
import { leafStatus, fmtBytes, uptimeShort } from "./diagHelpers.js";

function StatusLed({ live, label }) {
  return (
    <span className="led-group" title={live ? "Live" : "No signal"}>
      {label && <span className="led-group__age">{label}</span>}
      <span
        className={"status-led status-led--" + (live ? "live" : "down")}
        aria-label={live ? "Live" : "No signal"}
      ></span>
    </span>
  );
}

function LeafProvisionControl({ svc, hostId }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const connected = svc.provisioned === true;
  const toggle = () => {
    if (busy || !hostId) return;
    const want = !connected;
    setErr(null);
    setBusy(true);
    servicesStore.applyRow(hostId, { ...svc, provisioned: want });
    setLeafProvisioned(hostId, svc.id, want)
      .catch((e) => {
        servicesStore.applyRow(hostId, svc);
        setErr((e && (e.userMessage || e.message)) || "Couldn’t apply");
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button
        className={"svc-prov-btn svc-prov-btn--" + (connected ? "off" : "on")}
        onClick={toggle} disabled={busy}
        title={connected ? "Disconnect this leaf from the API" : "Connect this leaf to the API"}>
        {busy
          ? <Icon name="loader" size={12} className="act-spin" />
          : <Icon name={connected ? "unplug" : "plug"} size={12} strokeWidth={2.2} />}
        {connected ? "Disconnect" : "Connect"}
      </button>
      {err && <span className="svc-prov-err" title={err}><Icon name="triangle-alert" size={11} /> {err}</span>}
    </>
  );
}

function LeafCard({ svc, hostId, canManage, onConfigure }) {
  const s = leafStatus(svc);
  const mem = fmtBytes(svc.memoryBytes);
  const up = svc.since ? uptimeShort(svc.since) : null;
  const running = svc.state === "active";
  const provisionable = svc.provisioned != null;
  return (
    <div className={"svc-card svc-card--" + s.tone}>
      <div className="svc-card__head">
        <span className={"svc-dot svc-dot--" + s.tone}></span>
        <span className="svc-card__name">{svc.displayName}</span>
        <span className="svc-card__status">
          {s.label}{s.note ? <span className="svc-card__note"> · {s.note}</span> : null}
        </span>
      </div>
      <div className="svc-card__role">{svc.role}</div>
      <div className="svc-card__facts">
        <span className="svc-fact svc-fact--unit" title="systemd unit"><Icon name="box" size={12} /><code>{svc.unit}</code></span>
        {running && up && <span className="svc-fact" title="uptime"><Icon name="clock" size={12} />up {up}</span>}
        {running && mem && <span className="svc-fact" title="memory (systemd cgroup accounting)"><Icon name="memory-stick" size={12} />{mem}</span>}
        {running && svc.mainPid && <span className="svc-fact" title="main pid"><Icon name="hash" size={12} />{svc.mainPid}</span>}
        {svc.enabled != null && (
          <span className={"svc-fact svc-fact--boot" + (svc.enabled ? " is-on" : "")} title="starts on boot">
            <Icon name={svc.enabled ? "power" : "power-off"} size={12} />{svc.enabled ? "on boot" : "manual"}
          </span>
        )}
      </div>
      {provisionable && (
        <div className="svc-card__prov">
          <span className={"svc-prov-chip svc-prov-chip--" + (svc.provisioned ? "on" : "off")} title={svc.provisioned ? "Connected to the API" : "Not connected to the API"}>
            <Icon name={svc.provisioned ? "plug" : "unplug"} size={11} strokeWidth={2.2} />
            {svc.provisioned ? "Connected" : "Disconnected"}
          </span>
          {canManage && (
            <span className="svc-card__prov-actions">
              <LeafProvisionControl svc={svc} hostId={hostId} />
              <button className="svc-cfg-btn" onClick={onConfigure} title={"Configure " + svc.displayName}>
                <Icon name="sliders-horizontal" size={12} strokeWidth={2} /> Configure
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigFieldRow({ f, draft, secretDraft, revealed, willReset, onChange, onSecretChange, onReveal, onToggleReset }) {
  const disabled = willReset;
  const input = (() => {
    if (f.type === "secret") {
      if (!revealed) {
        return (
          <div className="leaf-cfg-secret">
            <span className="leaf-cfg-secret__mask">
              {f.set
                ? <>{"●●●●"} set{f.fingerprint ? <span className="leaf-cfg-secret__fp"> ·{"…"}{f.fingerprint}</span> : null}</>
                : <span className="leaf-cfg-secret__unset">not set</span>}
            </span>
            <button type="button" className="leaf-cfg-secret__replace" onClick={() => onReveal(f.key)} disabled={disabled}>
              <Icon name="key" size={11} strokeWidth={2} /> {f.set ? "Replace" : "Set"}
            </button>
          </div>
        );
      }
      return (
        <input type="password" className="host-field__input host-field__input--mono" autoFocus disabled={disabled}
          placeholder={f.set ? "Enter a new value to replace it" : "Enter a value"} value={secretDraft || ""}
          onChange={(e) => onSecretChange(f.key, e.target.value)} spellCheck="false" autoComplete="new-password" />
      );
    }
    if (f.type === "enum" && Array.isArray(f.enum)) {
      return (
        <Select value={draft == null ? "" : String(draft)} disabled={disabled}
          onChange={(e) => onChange(f.key, e.target.value)}>
          {f.enum.map((opt) => <option key={String(opt)} value={String(opt)}>{String(opt)}</option>)}
        </Select>
      );
    }
    if (f.type === "bool") {
      return (
        <label className="leaf-cfg-toggle">
          <input type="checkbox" checked={!!draft} disabled={disabled} onChange={(e) => onChange(f.key, e.target.checked)} />
          <span className="leaf-cfg-toggle__txt">{draft ? "Enabled" : "Disabled"}</span>
        </label>
      );
    }
    if (f.type === "int") {
      return (
        <input type="number" className="host-field__input host-field__input--mono" value={draft == null ? "" : draft} disabled={disabled}
          onChange={(e) => onChange(f.key, e.target.value)} spellCheck="false" />
      );
    }
    return (
      <input type="text" className="host-field__input host-field__input--mono" value={draft == null ? "" : draft} disabled={disabled}
        onChange={(e) => onChange(f.key, e.target.value)} spellCheck="false" />
    );
  })();

  return (
    <div className={"leaf-cfg-field" + (willReset ? " is-reset" : "")}>
      <div className="leaf-cfg-field__top">
        <span className="leaf-cfg-field__label">{f.label}</span>
        {f.overridden && (
          <span className={"leaf-cfg-prov" + (willReset ? " leaf-cfg-prov--reset" : "")}
            title={willReset ? "Will reset to the deploy default on save" : "Overrides the deploy-floor default"}>
            <span className="leaf-cfg-prov__dot"></span>{willReset ? "reset pending" : "override"}
          </span>
        )}
        {f.envName && <code className="leaf-cfg-field__env">{f.envName}</code>}
        <span style={{ flex: 1 }}></span>
        {f.overridden && (
          <button type="button" className="leaf-cfg-reset" onClick={() => onToggleReset(f.key)}>
            <Icon name="rotate-ccw" size={11} strokeWidth={2} />{willReset ? "Keep override" : "Reset to default"}
          </button>
        )}
      </div>
      {f.description && <div className="leaf-cfg-field__desc">{f.description}</div>}
      <div className="leaf-cfg-field__input">{input}</div>
      {f.type !== "secret" && f.default != null && (
        <div className="leaf-cfg-field__default">default <code>{String(f.default)}</code></div>
      )}
    </div>
  );
}

function ServicesSummaryCard({ services, status, ready, onViewAll }) {
  const rows = ready && Array.isArray(services) ? services : [];
  const running = rows.filter(r => r.state === "active").length;
  const unwell = rows.some(r => { const t = leafStatus(r).tone; return t === "down" || t === "warn"; });
  return (
    <BriefCard
      icon="server-cog"
      title="Services"
      count={rows.length ? running + "/" + rows.length : null}
      countTone={unwell ? undefined : "neutral"}
      onViewAll={rows.length ? onViewAll : undefined}
    >
      {rows.length > 0 ? (
        <div className="svc-rows">
          {rows.map(svc => {
            const s = leafStatus(svc);
            return (
              <button key={svc.id} className="svc-row" onClick={onViewAll} title={svc.role}>
                <span className="svc-row__id">
                  <span className={"svc-dot svc-dot--" + s.tone}></span>
                  <span className="svc-row__name">{svc.displayName}</span>
                </span>
                <span className="svc-row__status">
                  <span className={"svc-row__state svc-row__state--" + s.tone}>{s.label}</span>
                  {s.note ? <span className="svc-row__note">{s.note}</span> : null}
                </span>
                <span className="svc-row__end"><Icon name="chevron-right" size={16} className="svc-row__go" /></span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <Icon name="server-cog" size={20} />
          <span className="chat-brief__empty-title">{status === "error" ? "Services unavailable" : "Reading host services…"}</span>
          <span className="chat-brief__empty-sub">{status === "error" ? "Couldn’t read the host’s leaf-service state." : "This host’s KGSM leaf services will appear here."}</span>
        </div>
      )}
    </BriefCard>
  );
}

export { StatusLed, LeafProvisionControl, LeafCard, ConfigFieldRow, ServicesSummaryCard };

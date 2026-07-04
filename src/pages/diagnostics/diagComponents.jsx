// DiagnosticsPage shared leaf components — StatusLed, LeafProvisionControl,
// LeafCard, ConfigFieldRow, ServicesSummaryCard, HostMenu, FleetHostCard,
// HostEditorModal, RemoveHostDialog. Pure render + narrow local state.

import React from "react";
import { BriefCard } from "../../components/BriefCard.jsx";
import { alertsTone } from "../../components/ContextualAlerts.jsx";
import { HostConnection } from "../../components/ErrorBoundary.jsx";
import { HostMeters, hostHealth } from "../../components/HostCardBody.jsx";
import { HostAuthBadge } from "../../components/host-helpers.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { canOn } from "../../lib/persona.js";
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
        setErr((e && (e.userMessage || e.message)) || "Couldn\u2019t apply");
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
          {s.label}{s.note ? <span className="svc-card__note"> \u00b7 {s.note}</span> : null}
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
                ? <>{"\u25cf\u25cf\u25cf\u25cf"} set{f.fingerprint ? <span className="leaf-cfg-secret__fp"> \u00b7{"\u2026"}{f.fingerprint}</span> : null}</>
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
          <span className="chat-brief__empty-title">{status === "error" ? "Services unavailable" : "Reading host services\u2026"}</span>
          <span className="chat-brief__empty-sub">{status === "error" ? "Couldn\u2019t read the host\u2019s leaf-service state." : "This host\u2019s KGSM leaf services will appear here."}</span>
        </div>
      )}
    </BriefCard>
  );
}

function HostMenu({ host, isActive, onSetActive, onEdit, onToggle, onRemove }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const act = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(); };
  const canManage = canOn ? canOn("host.manage", host.id) : true;
  return (
    <div className="host-menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button className={"icon-btn" + (open ? " icon-btn--on" : "")} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} title="Manage host" aria-label="Manage host">
        <Icon name="ellipsis" size={15} />
      </button>
      {open && (
        <div className="host-menu__pop">
          <button className="host-menu__item" onClick={act(() => onSetActive(host.id))} disabled={isActive}>
            <Icon name="eye" size={14} />{isActive ? "Active scope" : "Set as active scope"}
          </button>
          {canManage && (
            <>
              <button className="host-menu__item" onClick={act(() => onEdit(host))}><Icon name="pencil" size={14} />Edit host</button>
              <button className="host-menu__item" onClick={act(() => onToggle(host))}>
                <Icon name={host.online ? "power-off" : "power"} size={14} />{host.online ? "Disconnect" : "Connect"}
              </button>
              <div className="host-menu__sep"></div>
              <button className="host-menu__item host-menu__item--danger" onClick={act(() => onRemove(host))}><Icon name="trash-2" size={14} />Remove host</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FleetHostCard({ host, serverCount, alerts, isActive, onInspect, menuProps }) {
  const { denied, metricsDown, hasTelemetry, meters, tone } = hostHealth(host);
  const alertTone = alerts.length ? alertsTone(alerts) : null;
  return (
    <div className={"fleet-card fleet-card--" + tone} onClick={() => onInspect(host.id)} role="button" tabIndex={0}>
      <div className="fleet-card__head">
        <span className={"fleet-card__dot fleet-card__dot--" + tone}></span>
        <span className="fleet-card__name">{host.name}</span>
        <span className="fleet-card__region">{host.region}</span>
        {isActive && <span className="fleet-card__active"><Icon name="circle-check" size={11} strokeWidth={2.4} />active</span>}
        <span style={{ flex: 1 }}></span>
        {alerts.length > 0 && (
          <span className={"fleet-card__alerts fleet-card__alerts--" + alertTone}><Icon name="triangle-alert" size={11} strokeWidth={2.4} />{alerts.length}</span>
        )}
        {denied && HostAuthBadge && <HostAuthBadge hostId={host.id} size="sm" />}
        {host.online && !denied && <HostConnection hostId={host.id} />}
        <HostMenu host={host} isActive={isActive} {...menuProps} />
      </div>
      <div className="fleet-card__hostname"><code>{host.hostname}</code></div>
      {denied ? (
        <div className="fleet-card__offline fleet-card__offline--denied"><Icon name="lock" size={13} /> No access \u2014 your Discord role isn\u2019t granted on this host</div>
      ) : metricsDown ? (
        <div className="fleet-card__offline"><Icon name="activity" size={13} /> Live metrics unavailable on this host</div>
      ) : hasTelemetry ? (
        <div className="fleet-card__meters">
          <HostMeters meters={meters} />
        </div>
      ) : (
        <div className="fleet-card__offline"><Icon name={host._pending ? "loader" : "moon"} size={13} /> {host._pending ? "Awaiting first agent check-in" : "Disconnected \u2014 no live telemetry"}</div>
      )}
      <div className="fleet-card__foot">
        <span><Icon name="box" size={12} />{serverCount + " server" + (serverCount === 1 ? "" : "s")}</span>
        <span><Icon name="cpu" size={12} />{(host.cpu.cores || "\u2014") + " cores"}</span>
        <span><Icon name="clock" size={12} />{host.online ? "up " + uptimeShort(host.boot_time) : "\u2014"}</span>
        <span className="fleet-card__open">Inspect <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
      </div>
    </div>
  );
}

function HostEditorModal({ host, onSave, onClose }) {
  const editing = !!host;
  const clean = (v) => (v && v !== "\u2014" ? v : "");
  const [name, setName] = React.useState(clean(host?.name));
  const [hostname, setHostname] = React.useState(clean(host?.hostname));
  const [region, setRegion] = React.useState(clean(host?.region));
  const canSave = editing ? !!name.trim() : (!!name.trim() && !!hostname.trim());
  const submit = () => {
    if (!canSave) return;
    if (editing) onSave({ label: name.trim(), region: region.trim() });
    else onSave({ name: name.trim(), hostname: hostname.trim(), region: region.trim() });
  };
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal host-editor" onClick={e => e.stopPropagation()}>
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name={editing ? "pencil" : "server-cog"} size={18} /></div>
          <div>
            <h2 className="host-editor__title">{editing ? "Edit host" : "Add a host"}</h2>
            <p className="host-editor__sub">{editing ? "Set how this machine appears across the panel \u2014 its label and region." : "Register a machine running the Krystal agent. It connects on first check-in."}</p>
          </div>
          <button className="host-editor__close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="host-editor__body">
          <label className="host-field">
            <span className="host-field__label">Display name</span>
            <input className="host-field__input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frankfurt box" autoFocus />
          </label>
          {!editing && (
            <label className="host-field">
              <span className="host-field__label">Hostname / address</span>
              <input className="host-field__input host-field__input--mono" value={hostname} onChange={e => setHostname(e.target.value)} placeholder="krystal-3.tks.example" spellCheck="false" />
            </label>
          )}
          <label className="host-field">
            <span className="host-field__label">Region <span className="host-field__opt">optional</span></span>
            <input className="host-field__input host-field__input--mono" value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. eu-west" spellCheck="false" />
          </label>
        </div>
        <div className="host-editor__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="host-btn host-btn--primary" onClick={submit} disabled={!canSave}>
            <Icon name={editing ? "check" : "plus"} size={14} strokeWidth={2.4} />
            {editing ? "Save changes" : "Add host"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoveHostDialog({ host, serverCount, onConfirm, onClose }) {
  const blocked = serverCount > 0;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal host-remove" onClick={e => e.stopPropagation()}>
        <div className={"host-remove__icon" + (blocked ? " host-remove__icon--warn" : " host-remove__icon--danger")}>
          <Icon name={blocked ? "shield-alert" : "trash-2"} size={20} />
        </div>
        <h2 className="host-remove__title">{blocked ? "Can\u2019t remove this host yet" : "Remove " + host.name + "?"}</h2>
        {blocked ? (
          <p className="host-remove__text">
            <b>{host.name}</b> still hosts <b>{serverCount} server{serverCount === 1 ? "" : "s"}</b>. Move or delete them first \u2014 removing the host would orphan their history and audit trail.
          </p>
        ) : (
          <p className="host-remove__text">
            This unregisters <b>{host.name}</b> ({host.hostname}) from the panel. Diagnostics and metrics for it stop being collected. This can\u2019t be undone.
          </p>
        )}
        <div className="host-remove__foot">
          <button className="host-btn host-btn--ghost" onClick={onClose}>{blocked ? "Close" : "Cancel"}</button>
          {!blocked && (
            <button className="host-btn host-btn--danger" onClick={onConfirm}>
              <Icon name="trash-2" size={14} /> Remove host
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export {
  StatusLed, LeafProvisionControl, LeafCard, ConfigFieldRow,
  ServicesSummaryCard, HostMenu, FleetHostCard, HostEditorModal, RemoveHostDialog,
};

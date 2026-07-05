// Host/fleet diagnostics cards — HostMenu, FleetHostCard, HostEditorModal,
// RemoveHostDialog. Split out of diagComponents.jsx (#8); re-exported from there
// so consumers are unchanged. Pure render + narrow local state.

import React from "react";
import { alertsTone } from "../../components/ContextualAlerts.jsx";
import { HostConnection } from "../../components/ErrorBoundary.jsx";
import { HostMeters, hostHealth } from "../../components/HostCardBody.jsx";
import { HostAuthBadge } from "../../components/host-helpers.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Modal } from "../../components/Modal.jsx";
import { canOn } from "../../lib/persona.js";
import { uptimeShort } from "./diagHelpers.js";

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
  const canManage = canOn("host.manage", host.id);
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
        {denied && <HostAuthBadge hostId={host.id} size="sm" />}
        {host.online && !denied && <HostConnection hostId={host.id} />}
        <HostMenu host={host} isActive={isActive} {...menuProps} />
      </div>
      <div className="fleet-card__hostname"><code>{host.hostname}</code></div>
      {denied ? (
        <div className="fleet-card__offline fleet-card__offline--denied"><Icon name="lock" size={13} /> No access — your Discord role isn’t granted on this host</div>
      ) : metricsDown ? (
        <div className="fleet-card__offline"><Icon name="activity" size={13} /> Live metrics unavailable on this host</div>
      ) : hasTelemetry ? (
        <div className="fleet-card__meters">
          <HostMeters meters={meters} />
        </div>
      ) : (
        <div className="fleet-card__offline"><Icon name={host._pending ? "loader" : "moon"} size={13} /> {host._pending ? "Awaiting first agent check-in" : "Disconnected — no live telemetry"}</div>
      )}
      <div className="fleet-card__foot">
        <span><Icon name="box" size={12} />{serverCount + " server" + (serverCount === 1 ? "" : "s")}</span>
        <span><Icon name="cpu" size={12} />{(host.cpu.cores || "—") + " cores"}</span>
        <span><Icon name="clock" size={12} />{host.online ? "up " + uptimeShort(host.boot_time) : "—"}</span>
        <span className="fleet-card__open">Inspect <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
      </div>
    </div>
  );
}

function HostEditorModal({ host, onSave, onClose }) {
  const editing = !!host;
  const clean = (v) => (v && v !== "—" ? v : "");
  const [name, setName] = React.useState(clean(host?.name));
  const [hostname, setHostname] = React.useState(clean(host?.hostname));
  const [region, setRegion] = React.useState(clean(host?.region));
  const canSave = editing ? !!name.trim() : (!!name.trim() && !!hostname.trim());
  const submit = () => {
    if (!canSave) return;
    if (editing) onSave({ label: name.trim(), region: region.trim() });
    else onSave({ name: name.trim(), hostname: hostname.trim(), region: region.trim() });
  };
  return (
    <Modal onClose={onClose}>
      <div className="modal host-editor">
        <div className="host-editor__head">
          <div className="host-editor__head-icon"><Icon name={editing ? "pencil" : "server-cog"} size={18} /></div>
          <div>
            <h2 className="host-editor__title">{editing ? "Edit host" : "Add a host"}</h2>
            <p className="host-editor__sub">{editing ? "Set how this machine appears across the panel — its label and region." : "Register a machine running the Krystal agent. It connects on first check-in."}</p>
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
    </Modal>
  );
}

function RemoveHostDialog({ host, serverCount, onConfirm, onClose }) {
  const blocked = serverCount > 0;
  return (
    <Modal onClose={onClose}>
      <div className="modal host-remove">
        <div className={"host-remove__icon" + (blocked ? " host-remove__icon--warn" : " host-remove__icon--danger")}>
          <Icon name={blocked ? "shield-alert" : "trash-2"} size={20} />
        </div>
        <h2 className="host-remove__title">{blocked ? "Can’t remove this host yet" : "Remove " + host.name + "?"}</h2>
        {blocked ? (
          <p className="host-remove__text">
            <b>{host.name}</b> still hosts <b>{serverCount} server{serverCount === 1 ? "" : "s"}</b>. Move or delete them first — removing the host would orphan their history and audit trail.
          </p>
        ) : (
          <p className="host-remove__text">
            This unregisters <b>{host.name}</b> ({host.hostname}) from the panel. Diagnostics and metrics for it stop being collected. This can’t be undone.
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
    </Modal>
  );
}

export { HostMenu, FleetHostCard, HostEditorModal, RemoveHostDialog };

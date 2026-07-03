import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { Select as KSelect } from "../components/Select.jsx";
import { serverCapUsable } from "../lib/capabilities.js";
import { fetchSettings, patchSettings, deleteServer } from "../lib/stores.js";
import { canOn } from "../lib/persona.js";

// Settings panel — for things that don't belong in raw config files.
// Autostart, scheduled restarts, crash recovery, update policy, resource caps,
// player notifications.
//
// Phase 0 wires the Updates auto-update toggle + delete-server end-to-end
// against GET/PATCH /servers/{id}/settings and DELETE /servers/{id}. The
// remaining sections (Startup & recovery, Scheduled tasks, Resources) show an
// honest per-section "Available in Phase N" placeholder until their primitives
// land.

function SettingsRow({ icon, title, sub, children }) {
  // Mirrors the NeedsAttention / RecentActivity entry line: a rounded icon
  // chip, a two-line title/detail body, and a trailing affordance — here the
  // setting's control(s) instead of an "Ask →" link. Non-clickable, so it uses
  // the --static modifier (no pointer cursor / hover wash).
  return (
    <div className="chat-brief__item chat-brief__item--static">
      <span className="chat-brief__icon"><Icon name={icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title"><span className="chat-brief__titletext">{title}</span></span>
        {sub && <span className="chat-brief__detail" style={{ whiteSpace: "normal" }}>{sub}</span>}
      </div>
      <div className="settings-row__controls" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 38, height: 22, borderRadius: 999,
      background: on ? "var(--krystal-teal)" : "var(--surface-3)",
      border: "1px solid " + (on ? "transparent" : "var(--border-subtle)"),
      position: "relative", cursor: "pointer", padding: 0,
      transition: "background 140ms",
    }} aria-pressed={on}>
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: 999,
        background: on ? "var(--fg-inverse)" : "var(--fg-2)",
        transition: "left 140ms",
      }}></span>
    </button>
  );
}

// Thin adapter over the shared <Select> so these settings rows keep their
// options-array / onChange(value) shape while adopting the app-wide styling.
function Select({ value, options, onChange }) {
  return (
    <KSelect value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </KSelect>
  );
}

function SettingsSection({ icon, title, action, children }) {
  // Reuses the shared BriefCard shell so each settings group reads as the same
  // card family as Alerts / Recent activity / Backups.
  return (
    <BriefCard icon={icon} title={title} action={action}>
      <div className="chat-brief__list">{children}</div>
    </BriefCard>
  );
}

function ServerSettings({ server, onDeleted }) {
  // watchdog capability check (unchanged — used by the watchdog-gated sections)
  const watchdogDown = serverCapUsable ? !serverCapUsable(server, "watchdog") : false;
  // scheduler capability — the kgsm-scheduler leaf may not be deployed on this host.
  const schedulerDown = serverCapUsable ? !serverCapUsable(server, "scheduler") : false;

  // ---- API-loaded settings state ----
  const [loadState, setLoadState] = React.useState("loading"); // "loading" | "ready" | "error"
  const [loadError, setLoadError] = React.useState(null);

  // ---- Form state (only Phase 0 live fields) ----
  const [autoUpdate, setAutoUpdate] = React.useState(null); // null = not loaded yet
  const [autostart, setAutostart] = React.useState(null); // null = not loaded or watchdog absent
  const [cpuPriority, setCpuPriority] = React.useState(null); // null = not loaded
  const [memoryCapMb, setMemoryCapMb] = React.useState(null); // null = not loaded (0 = uncapped is valid)
  const [scheduledRestart, setScheduledRestart] = React.useState(null); // null = not loaded
  const [restartTime, setRestartTime] = React.useState(null); // "HH:MM"
  const [restartDay, setRestartDay] = React.useState(null); // sun..sat
  const [timezone, setTimezone] = React.useState(null); // IANA string, "" = host-local
  const [nextFireUtc, setNextFireUtc] = React.useState(null); // read-only; null = scheduler absent/unknown
  const [autoBackupOnRestart, setAutoBackupOnRestart] = React.useState(false);
  const [backupRetention, setBackupRetention] = React.useState(5);
  const [lastBackupUtc, setLastBackupUtc] = React.useState(null); // read-only; from scheduler status
  const [lastBackupOk, setLastBackupOk] = React.useState(null); // read-only; null = unknown

  // ---- Save / Reset state ----
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState(null); // { ok, text }

  // ---- Delete state ----
  const [deletePhase, setDeletePhase] = React.useState("idle"); // "idle" | "confirm" | "deleting"
  const [deleteError, setDeleteError] = React.useState(null);

  // Load on mount
  React.useEffect(() => {
    if (!server || !server.id) return;
    setLoadState("loading");
    fetchSettings(server.hostId, server.id).then(
      (data) => {
        setAutoUpdate(!!data.autoUpdate);
        setAutostart(data.autostart != null ? !!data.autostart : null);
        setCpuPriority(data.cpuPriority ?? null);
        setMemoryCapMb(data.memoryCapMb ?? null);
        setScheduledRestart(data.scheduledRestart ?? "off");
        setRestartTime(data.restartTime ?? "04:00");
        setRestartDay(data.restartDay ?? "sun");
        setTimezone(data.timezone ?? "");
        setNextFireUtc(data.nextFireUtc ?? null);
        setAutoBackupOnRestart(data.autoBackupOnRestart ?? false);
        setBackupRetention(data.backupRetention ?? 5);
        setLastBackupUtc(data.lastBackupUtc ?? null);
        setLastBackupOk(data.lastBackupOk ?? null);
        setLoadState("ready");
      },
      (err) => {
        setLoadError(err && err.message ? err.message : "Failed to load settings");
        setLoadState("error");
      }
    );
  }, [server && server.id, server && server.hostId]);

  const handleSave = () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    patchSettings(server.hostId, server.id, {
      autoUpdate, autostart, cpuPriority, memoryCapMb,
      scheduledRestart, restartTime, restartDay, timezone,
      autoBackupOnRestart, backupRetention: Number(backupRetention),
      origin: "ui",
    }).then(
      (data) => {
        if (data && data.settings) {
          if (data.settings.autostart != null) setAutostart(!!data.settings.autostart);
          if (data.settings.cpuPriority !== undefined) setCpuPriority(data.settings.cpuPriority);
          if (data.settings.memoryCapMb !== undefined) setMemoryCapMb(data.settings.memoryCapMb);
          if (data.settings.scheduledRestart !== undefined) setScheduledRestart(data.settings.scheduledRestart ?? "off");
          if (data.settings.restartTime !== undefined) setRestartTime(data.settings.restartTime ?? "04:00");
          if (data.settings.restartDay !== undefined) setRestartDay(data.settings.restartDay ?? "sun");
          if (data.settings.timezone !== undefined) setTimezone(data.settings.timezone ?? "");
          if (data.settings.nextFireUtc !== undefined) setNextFireUtc(data.settings.nextFireUtc ?? null);
          if (data.settings.autoBackupOnRestart !== undefined) setAutoBackupOnRestart(data.settings.autoBackupOnRestart ?? false);
          if (data.settings.backupRetention !== undefined) setBackupRetention(data.settings.backupRetention ?? 5);
          if (data.settings.lastBackupUtc !== undefined) setLastBackupUtc(data.settings.lastBackupUtc ?? null);
          if (data.settings.lastBackupOk !== undefined) setLastBackupOk(data.settings.lastBackupOk ?? null);
        }
        setSaving(false);
        setSaveMsg({ ok: true, text: "Saved" });
        setTimeout(() => setSaveMsg(null), 3000);
      },
      (err) => {
        setSaving(false);
        setSaveMsg({ ok: false, text: (err && err.message) ? err.message : "Save failed" });
      }
    );
  };

  const handleReset = () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    // Reset: clear auto_update override by sending null
    patchSettings(server.hostId, server.id, {
      autoUpdate: null, autostart: null, cpuPriority: null, memoryCapMb: null,
      scheduledRestart: null, restartTime: null, restartDay: null, timezone: null,
      autoBackupOnRestart: null, backupRetention: null,
      origin: "ui",
    }).then(
      (data) => {
        if (data && data.settings) {
          setAutoUpdate(!!data.settings.autoUpdate);
          if (data.settings.autostart != null) setAutostart(!!data.settings.autostart);
          if (data.settings.cpuPriority !== undefined) setCpuPriority(data.settings.cpuPriority ?? null);
          if (data.settings.memoryCapMb !== undefined) setMemoryCapMb(data.settings.memoryCapMb ?? null);
          if (data.settings.scheduledRestart !== undefined) setScheduledRestart(data.settings.scheduledRestart ?? "off");
          if (data.settings.restartTime !== undefined) setRestartTime(data.settings.restartTime ?? "04:00");
          if (data.settings.restartDay !== undefined) setRestartDay(data.settings.restartDay ?? "sun");
          if (data.settings.timezone !== undefined) setTimezone(data.settings.timezone ?? "");
          if (data.settings.nextFireUtc !== undefined) setNextFireUtc(data.settings.nextFireUtc ?? null);
          if (data.settings.autoBackupOnRestart !== undefined) setAutoBackupOnRestart(data.settings.autoBackupOnRestart ?? false);
          if (data.settings.backupRetention !== undefined) setBackupRetention(data.settings.backupRetention ?? 5);
          if (data.settings.lastBackupUtc !== undefined) setLastBackupUtc(data.settings.lastBackupUtc ?? null);
          if (data.settings.lastBackupOk !== undefined) setLastBackupOk(data.settings.lastBackupOk ?? null);
        }
        setSaving(false);
        setSaveMsg({ ok: true, text: "Reset to defaults" });
        setTimeout(() => setSaveMsg(null), 3000);
      },
      () => {
        setSaving(false);
        setSaveMsg({ ok: false, text: "Reset failed" });
      }
    );
  };

  const handleDelete = () => {
    if (deletePhase === "idle") { setDeletePhase("confirm"); return; }
    if (deletePhase !== "confirm") return;
    setDeletePhase("deleting");
    setDeleteError(null);
    deleteServer(server.hostId, server.id, "ui").then(
      () => {
        // 202 accepted — the server is being removed. Navigate away.
        if (onDeleted) onDeleted();
      },
      (err) => {
        setDeletePhase("idle");
        setDeleteError((err && err.message) ? err.message : "Delete failed");
      }
    );
  };

  // Show full-tab loading / error states
  if (loadState === "loading") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="loader" size={22} strokeWidth={1.6} />
        <div style={{ marginTop: 10, fontSize: 13 }}>Loading settings…</div>
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="alert-circle" size={22} strokeWidth={1.6} />
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--fg-2)" }}>{loadError || "Failed to load settings"}</div>
      </div>
    );
  }

  // Per-card watchdog indicator (replaces the page banner): "Watchdog down ●".
  const watchdogLed = (
    <span className="led-group">
      <span className="led-group__age">Watchdog down</span>
      <span className="status-led status-led--down"></span>
    </span>
  );
  const schedulerLed = (
    <span className="led-group">
      <span className="led-group__age">Scheduler down</span>
      <span className="status-led status-led--down"></span>
    </span>
  );

  // Shared inline style for the free-text / time inputs in the schedule card,
  // mirroring the Memory cap number input below.
  const schedInputStyle = {
    background: "var(--surface-3)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    color: "var(--fg-1)",
    fontSize: 13,
    padding: "3px 7px",
  };

  const cadence = scheduledRestart ?? "off";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Startup & recovery — Phase 1 */}
      <SettingsSection icon="power" title="Startup & recovery" action={watchdogDown ? watchdogLed : null}>
        {watchdogDown ? (
          <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
            <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
            Watchdog offline — autostart unavailable
          </div>
        ) : (
          <SettingsRow icon="power" title="Autostart on boot"
            sub="Automatically start this server when the host boots.">
            {autostart === null ? (
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>—</span>
            ) : (
              <Toggle on={!!autostart} onChange={setAutostart} />
            )}
          </SettingsRow>
        )}
      </SettingsSection>

      {/* Scheduled tasks — Phase 3 (scheduler-leaf gated) */}
      <SettingsSection icon="calendar-clock" title="Scheduled tasks" action={schedulerDown ? schedulerLed : null}>
        {schedulerDown ? (
          <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
            <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
            Scheduler leaf not deployed — scheduled restarts unavailable
          </div>
        ) : (
          <>
            <SettingsRow icon="calendar-clock" title="Restart cadence"
              sub="Automatically restart this server on a schedule.">
              <Select
                value={cadence}
                options={[
                  { value: "off",    label: "Off" },
                  { value: "daily",  label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "6h",     label: "Every 6 hours" },
                ]}
                onChange={setScheduledRestart}
              />
            </SettingsRow>

            {cadence !== "off" && (
              <>
                <SettingsRow icon="clock" title="Restart time"
                  sub="Time of day the restart runs.">
                  <input
                    type="time"
                    value={restartTime ?? "04:00"}
                    onChange={e => setRestartTime(e.target.value)}
                    style={schedInputStyle}
                  />
                </SettingsRow>

                {cadence === "weekly" && (
                  <SettingsRow icon="calendar" title="Day of week"
                    sub="Which day the weekly restart runs.">
                    <Select
                      value={restartDay ?? "sun"}
                      options={[
                        { value: "sun", label: "Sunday" },
                        { value: "mon", label: "Monday" },
                        { value: "tue", label: "Tuesday" },
                        { value: "wed", label: "Wednesday" },
                        { value: "thu", label: "Thursday" },
                        { value: "fri", label: "Friday" },
                        { value: "sat", label: "Saturday" },
                      ]}
                      onChange={setRestartDay}
                    />
                  </SettingsRow>
                )}

                <SettingsRow icon="globe" title="Timezone"
                  sub="IANA timezone for the schedule (empty = host-local).">
                  <input
                    type="text"
                    value={timezone ?? ""}
                    placeholder="e.g. Europe/Madrid"
                    onChange={e => setTimezone(e.target.value)}
                    style={{ ...schedInputStyle, width: 150 }}
                  />
                </SettingsRow>

                <SettingsRow icon="archive" title="Back up before restart"
                  sub="Take a backup each time the scheduled restart runs.">
                  <Toggle on={!!autoBackupOnRestart} onChange={setAutoBackupOnRestart} />
                </SettingsRow>

                {autoBackupOnRestart && (
                  <SettingsRow icon="layers" title="Keep backups"
                    sub="How many recent backups to retain (older ones are pruned).">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={backupRetention ?? 5}
                      onChange={e => setBackupRetention(Number(e.target.value))}
                      style={{ ...schedInputStyle, width: 70, textAlign: "right" }}
                    />
                  </SettingsRow>
                )}

                {lastBackupUtc && (
                  <SettingsRow icon="history" title="Last backup"
                    sub="Most recent backup taken by the scheduler.">
                    <span style={{ fontSize: 12.5, color: lastBackupOk === false ? "var(--danger, #e55)" : "var(--fg-2)" }}>
                      {new Date(lastBackupUtc).toLocaleString()}{lastBackupOk === false ? " (failed)" : ""}
                    </span>
                  </SettingsRow>
                )}

                {nextFireUtc && (
                  <SettingsRow icon="alarm-clock" title="Next restart"
                    sub="Scheduled by the kgsm-scheduler leaf.">
                    <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                      {new Date(nextFireUtc).toLocaleString()}
                    </span>
                  </SettingsRow>
                )}
              </>
            )}
          </>
        )}
      </SettingsSection>

      {/* Updates — LIVE in Phase 0 */}
      <SettingsSection icon="download" title="Updates">
        <SettingsRow icon="download" title="Auto-update"
          sub="Apply the latest version on next restart (when available).">
          <Toggle on={!!autoUpdate} onChange={setAutoUpdate} />
        </SettingsRow>
      </SettingsSection>

      {/* Resources — LIVE in Phase 2 */}
      <SettingsSection icon="cpu" title="Resources" action={watchdogDown ? watchdogLed : null}>
        {watchdogDown ? (
          <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
            <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
            Watchdog offline — resource caps unavailable
          </div>
        ) : (
          <>
            <SettingsRow icon="cpu" title="CPU priority"
              sub="Scheduling weight for this server's cgroup (low=50, normal=100, high=400).">
              <Select
                value={cpuPriority ?? "normal"}
                options={[
                  { value: "low",    label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "high",   label: "High" },
                ]}
                onChange={setCpuPriority}
              />
            </SettingsRow>
            <SettingsRow icon="database" title="Memory cap"
              sub="Maximum RAM for this server (0 = uncapped). Takes effect at next restart.">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  min={0}
                  step={256}
                  value={memoryCapMb ?? 0}
                  onChange={e => setMemoryCapMb(Number(e.target.value))}
                  style={{
                    width: 80,
                    background: "var(--surface-3)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    color: "var(--fg-1)",
                    fontSize: 13,
                    padding: "3px 7px",
                    textAlign: "right",
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>MiB</span>
              </div>
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      {/* Button row */}
      <div style={{ display: "flex", gap: 10, padding: "8px 0", alignItems: "center", flexWrap: "wrap" }}>
        {deletePhase === "idle" && (
          <button className="icon-btn icon-btn--danger"
            style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}
            onClick={handleDelete}>
            <Icon name="trash-2" size={14} />&nbsp;Delete server
          </button>
        )}
        {deletePhase === "confirm" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Permanently delete? This cannot be undone.</span>
            <button className="icon-btn icon-btn--danger"
              style={{ width: "auto", padding: "0 12px", fontSize: 13 }}
              onClick={handleDelete}>Confirm delete</button>
            <button className="icon-btn"
              style={{ width: "auto", padding: "0 12px", fontSize: 13 }}
              onClick={() => setDeletePhase("idle")}>Cancel</button>
          </div>
        )}
        {deletePhase === "deleting" && (
          <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Deleting…</span>
        )}
        {deleteError && (
          <span style={{ fontSize: 12.5, color: "var(--danger, #e55)" }}>{deleteError}</span>
        )}
        <span style={{ flex: 1 }}></span>
        {saveMsg && (
          <span style={{ fontSize: 12.5, color: saveMsg.ok ? "var(--krystal-teal)" : "var(--danger, #e55)", marginRight: 4 }}>
            {saveMsg.text}
          </span>
        )}
        <button className="icon-btn" disabled={saving}
          style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}
          onClick={handleReset}>Reset to defaults</button>
        <button className="fb-editor__btn" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export { Select, ServerSettings, SettingsRow, SettingsSection, Toggle };

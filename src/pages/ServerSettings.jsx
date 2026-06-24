import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { serverCapUsable } from "../lib/capabilities.js";

// Settings panel — for things that don't belong in raw config files.
// Autostart, scheduled restarts, crash recovery, update policy, resource caps,
// player notifications.
//
// NOT WIRED YET: the editable-config backend isn't here, so the controls below
// have no honest source to read or persist to. The tab renders a work-in-
// progress state rather than showing fabricated toggle positions. The full form
// UI is kept ready — flip SETTINGS_WIRED to true and read/write the settings
// endpoint when it lands.
const SETTINGS_WIRED = false;

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

function Select({ value, options, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: "var(--surface-3)", border: "1px solid var(--border-subtle)",
      borderRadius: "var(--r-md)", height: 32, padding: "0 10px",
      color: "var(--fg-1)", fontFamily: "var(--font-ui)", fontSize: 13,
      outline: "none", cursor: "pointer",
    }}>
      {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
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

function ServerSettings({ server }) {
  const watchdogDown = serverCapUsable ? !serverCapUsable(server, "watchdog") : false;
  const [s, setS] = React.useState({
    autostart: true,
    restartOnCrash: true,
    maxCrashes: 3,
    scheduledRestart: "daily",
    restartTime: "04:00",
    warnPlayers: true,
    warnLeadMin: 5,
    autoUpdate: "stable",
    autoBackup: "6h",
    retainBackups: 10,
    ramCap: server.ram.max,
    cpuPriority: "normal",
  });
  const set = (k, v) => setS(prev => ({ ...prev, [k]: v }));

  if (!SETTINGS_WIRED) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="settings" size={26} strokeWidth={1.6} />
        <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>Work in progress — not available yet</div>
        <div style={{ marginTop: 4, fontSize: 12.5 }}>The editable-settings backend isn't here yet — this panel lights up when it lands.</div>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SettingsSection icon="power" title="Startup & recovery" action={watchdogDown ? watchdogLed : null}>
        <div className={watchdogDown ? "cap-gated" : ""}>
        <SettingsRow icon="power" title="Autostart on boot"
          sub="Bring this server up automatically when the host machine starts.">
          <Toggle on={s.autostart} onChange={v => set("autostart", v)} />
        </SettingsRow>
        <SettingsRow icon="life-buoy" title="Restart on crash"
          sub="Auto-restart if the process dies unexpectedly.">
          <Toggle on={s.restartOnCrash} onChange={v => set("restartOnCrash", v)} />
        </SettingsRow>
        <SettingsRow icon="repeat" title="Max consecutive restarts"
          sub="If this many crash-restarts happen in a row, pause and alert.">
          <Select value={String(s.maxCrashes)} options={["1","2","3","5","10"]} onChange={v => set("maxCrashes", +v)} />
        </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection icon="calendar-clock" title="Scheduled tasks" action={watchdogDown ? watchdogLed : null}>
        <div className={watchdogDown ? "cap-gated" : ""}>
        <SettingsRow icon="alarm-clock" title="Scheduled restart"
          sub="Cycle the world to free memory and apply pending updates.">
          <Select value={s.scheduledRestart}
            options={[
              { value: "off",     label: "Never" },
              { value: "daily",   label: "Daily" },
              { value: "weekly",  label: "Weekly (Sun)" },
              { value: "hourly6", label: "Every 6h" },
            ]} onChange={v => set("scheduledRestart", v)} />
        </SettingsRow>
        <SettingsRow icon="clock" title="Restart time"
          sub="Local time the daily/weekly restart fires.">
          <input value={s.restartTime} onChange={e => set("restartTime", e.target.value)}
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)", height: 32, padding: "0 10px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 13, width: 90, outline: "none", textAlign: "center" }} />
        </SettingsRow>
        <SettingsRow icon="megaphone" title="Warn online players"
          sub="Broadcast in-game countdowns before the restart fires.">
          <Toggle on={s.warnPlayers} onChange={v => set("warnPlayers", v)} />
          <Select value={String(s.warnLeadMin)} options={["1","2","5","10","15"]} onChange={v => set("warnLeadMin", +v)} />
          <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>min</span>
        </SettingsRow>
        </div>
        <SettingsRow icon="database" title="Auto-backup"
          sub="Snapshot the world on this cadence. Retention rolls oldest off.">
          <Select value={s.autoBackup}
            options={[
              { value: "off", label: "Off" },
              { value: "1h",  label: "Every hour" },
              { value: "6h",  label: "Every 6h" },
              { value: "24h", label: "Daily" },
            ]} onChange={v => set("autoBackup", v)} />
          <Select value={String(s.retainBackups)} options={["5","10","20","50"]} onChange={v => set("retainBackups", +v)} />
          <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>retained</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon="download" title="Updates">
        <SettingsRow icon="download" title="Auto-update channel"
          sub="When a new build is detected, install it on the next scheduled restart.">
          <Select value={s.autoUpdate}
            options={[
              { value: "off",      label: "Manual only" },
              { value: "stable",   label: "Stable" },
              { value: "beta",     label: "Beta" },
              { value: "bleeding", label: "Bleeding edge" },
            ]} onChange={v => set("autoUpdate", v)} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon="cpu" title="Resources">
        <SettingsRow icon="cpu" title="CPU priority"
          sub="How aggressively the OS schedules this server vs other processes.">
          <Select value={s.cpuPriority}
            options={[
              { value: "low",    label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "high",   label: "High" },
            ]} onChange={v => set("cpuPriority", v)} />
        </SettingsRow>
        <SettingsRow icon="hard-drive" title="Memory cap"
          sub="Hard ceiling on RAM. Server is killed if exceeded.">
          <input type="number" value={s.ramCap} onChange={e => set("ramCap", +e.target.value)}
            style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--r-md)", height: 32, padding: "0 10px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 13, width: 70, outline: "none", textAlign: "center" }} />
          <span style={{ color: "var(--fg-3)", fontSize: 12.5 }}>GB</span>
        </SettingsRow>
      </SettingsSection>

      <div style={{
        display: "flex", gap: 10, padding: "8px 0",
      }}>
        <button className="icon-btn icon-btn--danger" style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}>
          <Icon name="trash-2" size={14} />&nbsp;Delete server
        </button>
        <span style={{ flex: 1 }}></span>
        <button className="icon-btn" style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600 }}>Reset to defaults</button>
        <button className="fb-editor__btn">Save changes</button>
      </div>
    </div>
  );
}

export { Select, ServerSettings, SettingsRow, SettingsSection, Toggle };

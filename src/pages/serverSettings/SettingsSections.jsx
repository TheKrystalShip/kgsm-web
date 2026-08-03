// ServerSettings section components — the three gated setting groups (Startup &
// recovery, Scheduled tasks, Resources), extracted from ServerSettings.jsx (#8).
// Presentational: all form state + the save/reset/delete handlers stay in the
// parent; each section receives its slice + setters. Hook-less, so no React import
// (automatic JSX runtime).

import { Icon } from "../../components/Icon.jsx";
import { Select } from "../../components/Select.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../../components/settings-primitives.jsx";

// Shared inline style for the free-text / time inputs in the schedule card,
// mirroring the Memory cap number input in ResourcesSection.
const schedInputStyle = {
  background: "var(--surface-3)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 6,
  color: "var(--fg-1)",
  fontSize: 13,
  padding: "3px 7px",
};

function StartupSection({ watchdogDown, watchdogLed, autostart, setAutostart, crashRestart, setCrashRestart, crashMaxRestarts, setCrashMaxRestarts }) {
  return (
    <SettingsSection icon="power" title="Startup & recovery" action={watchdogDown ? watchdogLed : null}>
      {watchdogDown ? (
        <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
          <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Watchdog offline — autostart unavailable
        </div>
      ) : (
        <>
          <SettingsRow icon="power" title="Autostart on boot"
            sub="Automatically start this server when the host boots.">
            {autostart === null ? (
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>—</span>
            ) : (
              <Toggle on={!!autostart} onChange={setAutostart} />
            )}
          </SettingsRow>

          <SettingsRow icon="refresh-cw" title="Restart on crash"
            sub="Automatically restart if the server exits unexpectedly.">
            <Toggle on={crashRestart} onChange={setCrashRestart} />
          </SettingsRow>

          {crashRestart && (
            <SettingsRow icon="alert-triangle" title="Max consecutive restarts"
              sub="Give up and alert after this many crashes in a row without reaching stability.">
              <Select
                value={String(crashMaxRestarts)}
                options={[
                  { value: "1", label: "1" },
                  { value: "2", label: "2" },
                  { value: "3", label: "3" },
                  { value: "5", label: "5" },
                  { value: "10", label: "10" },
                ]}
                onChange={e => setCrashMaxRestarts(Number(e.target.value))}
              />
            </SettingsRow>
          )}
        </>
      )}
    </SettingsSection>
  );
}

function ScheduleSection({
  schedulerDown, schedulerLed, scheduledRestart, setScheduledRestart,
  restartTime, setRestartTime, restartDay, setRestartDay, timezone, setTimezone,
  backupSchedule, setBackupSchedule, backupTime, setBackupTime, backupDay, setBackupDay,
  backupRetention, setBackupRetention,
  lastBackupUtc, lastBackupOk, nextFireUtc, nextBackupUtc,
}) {
  const cadence = scheduledRestart ?? "off";
  const backupCadence = backupSchedule ?? "off";
  // The timezone is shared by both schedules, so it is offered as soon as either one is on.
  const anySchedule = cadence !== "off" || backupCadence !== "off";
  const cadenceOptions = [
    { value: "off",    label: "Off" },
    { value: "daily",  label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "6h",     label: "Every 6 hours" },
  ];
  return (
    <SettingsSection icon="calendar-clock" title="Scheduled tasks" action={schedulerDown ? schedulerLed : null}>
      {schedulerDown ? (
        <div style={{ padding: "10px 0 4px", color: "var(--fg-3)", fontSize: 12.5, textAlign: "center" }}>
          <Icon name="alert-circle" size={13} strokeWidth={1.8} style={{ verticalAlign: "middle", marginRight: 5 }} />
          Scheduler leaf not deployed — scheduled restarts and backups unavailable
        </div>
      ) : (
        <>
          <SettingsRow icon="calendar-clock" title="Restart cadence"
            sub="Automatically restart this server on a schedule.">
            <Select value={cadence} options={cadenceOptions} onChange={e => setScheduledRestart(e.target.value)} />
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
                <SettingsRow icon="calendar" title="Restart day"
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
                    onChange={e => setRestartDay(e.target.value)}
                  />
                </SettingsRow>
              )}
            </>
          )}

          {/* Backups run against the server as it is, so this schedule stands on its own — it
              needs no restart cadence and is not nested under one. */}
          <SettingsRow icon="archive" title="Backup cadence"
            sub="Automatically back this server up on a schedule, running or not.">
            <Select value={backupCadence} options={cadenceOptions} onChange={e => setBackupSchedule(e.target.value)} />
          </SettingsRow>

          {backupCadence !== "off" && (
            <>
              {backupCadence !== "6h" && (
                <SettingsRow icon="clock" title="Backup time"
                  sub="Time of day the backup runs.">
                  <input
                    type="time"
                    value={backupTime ?? "05:00"}
                    onChange={e => setBackupTime(e.target.value)}
                    style={schedInputStyle}
                  />
                </SettingsRow>
              )}

              {backupCadence === "weekly" && (
                <SettingsRow icon="calendar" title="Backup day"
                  sub="Which day the weekly backup runs.">
                  <Select
                    value={backupDay ?? "sun"}
                    options={[
                      { value: "sun", label: "Sunday" },
                      { value: "mon", label: "Monday" },
                      { value: "tue", label: "Tuesday" },
                      { value: "wed", label: "Wednesday" },
                      { value: "thu", label: "Thursday" },
                      { value: "fri", label: "Friday" },
                      { value: "sat", label: "Saturday" },
                    ]}
                    onChange={e => setBackupDay(e.target.value)}
                  />
                </SettingsRow>
              )}

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
            </>
          )}

          {anySchedule && (
            <SettingsRow icon="globe" title="Timezone"
              sub="IANA timezone for both schedules (empty = host-local).">
              <input
                type="text"
                value={timezone ?? ""}
                placeholder="e.g. Europe/Madrid"
                onChange={e => setTimezone(e.target.value)}
                style={{ ...schedInputStyle, width: 150 }}
              />
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

          {nextBackupUtc && (
            <SettingsRow icon="alarm-clock" title="Next backup"
              sub="Scheduled by the kgsm-scheduler leaf.">
              <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                {new Date(nextBackupUtc).toLocaleString()}
              </span>
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
        </>
      )}
    </SettingsSection>
  );
}

function ResourcesSection({ watchdogDown, watchdogLed, cpuPriority, setCpuPriority, memoryCapMb, setMemoryCapMb }) {
  return (
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
              onChange={e => setCpuPriority(e.target.value)}
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
  );
}

export { StartupSection, ScheduleSection, ResourcesSection };

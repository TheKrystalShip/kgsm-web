// DiagnosticsPage pure helpers — service state, formatting, host utilities.
// No React, no component deps.

const SVC_STATE = {
  active:          { tone: "up",   label: "Running" },
  activating:      { tone: "warn", label: "Starting" },
  deactivating:    { tone: "warn", label: "Stopping" },
  reloading:       { tone: "warn", label: "Reloading" },
  maintenance:     { tone: "warn", label: "Maintenance" },
  failed:          { tone: "down", label: "Failed" },
  inactive:        { tone: "off",  label: "Stopped" },
  "not-installed": { tone: "off",  label: "Not installed" },
  masked:          { tone: "off",  label: "Masked" },
  unknown:         { tone: "off",  label: "Unknown" },
};

function leafStatus(svc) {
  if (svc.state === "inactive" && svc.onDemand) return { tone: "idle", label: "Idle", note: "on-demand" };
  if (svc.state === "active" && svc.health && svc.health.status === "down")
    return { tone: "warn", label: "Running", note: "health check failing" };
  if (svc.state === "active" && svc.health && svc.health.status === "unknown")
    return { tone: "up", label: "Running", note: "health unknown" };
  return SVC_STATE[svc.state] || SVC_STATE.unknown;
}

function fmtBytes(n) {
  if (n == null) return null;
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (n >= 1024 * 1024) return Math.round(n / (1024 * 1024)) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

function uptimeShort(bootTime) {
  const ms = Date.now() - new Date(bootTime).getTime();
  if (ms < 0 || !isFinite(ms)) return "\u2014";
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return d + "d " + h + "h";
  if (h > 0) return h + "h " + m + "m";
  return m + "m";
}

const LOG_SOURCE_META = {
  api:       { label: "Backend API", hint: "REST \u00b7 WS \u00b7 SSE" },
  assistant: { label: "Assistant" },
  watchdog:  { label: "Watchdog", hint: "supervisor" },
  monitor:   { label: "Monitor", hint: "metrics daemon" },
  firewall:  { label: "Firewall", hint: "host ports" },
  bot:       { label: "Discord bot" },
  kernel:    { label: "Kernel" },
  auth:      { label: "Auth" },
};

export { SVC_STATE, leafStatus, fmtBytes, uptimeShort, LOG_SOURCE_META };

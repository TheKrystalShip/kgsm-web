// DiagnosticsPage pure helpers — the log-source vocabulary. No React, no component deps.
// The leaf run-state vocabulary is `lib/leaves.js` and the formatters are `lib/formatting.js`,
// because the leaf page and the leaf config page read them too.

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

export { LOG_SOURCE_META };

// chat constants — command metadata, API-backed verbs, and tool labels.
// Separated from chatUtils.js so components can import constants without
// pulling in the heavier pure functions.

const API_COMMAND_VERBS = new Set(["start", "stop", "restart", "open_ports"]);
const COMMAND_META = {
  start:      { label: "Start",         icon: "play",      tone: "success" },
  stop:       { label: "Stop",          icon: "square",    tone: "danger" },
  restart:    { label: "Restart",       icon: "rotate-cw", tone: "update" },
  open_ports: { label: "Open ports",    icon: "network",   tone: "info" },
  update:     { label: "Update",        icon: "download",  tone: "info" },
  install:    { label: "Install",       icon: "download",  tone: "success" },
  uninstall:  { label: "Uninstall",     icon: "trash-2",   tone: "danger" },
  backup:     { label: "Back up",       icon: "database",  tone: "info" },
  set_config: { label: "Update config", icon: "settings",  tone: "info" },
};
function commandMeta(verb) {
  return COMMAND_META[verb] || { label: (verb || "Run").replace(/_/g, " "), icon: "zap", tone: "info" };
}

export { API_COMMAND_VERBS, COMMAND_META, commandMeta };

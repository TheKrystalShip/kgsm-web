// formatting.js — shared formatting helpers extracted from page files.
//
// These were previously co-located in AuditLogPage.jsx, DiagnosticsPage.jsx,
// and LibraryPage.jsx. They are pure functions / data maps with no React
// dependencies — consumed across pages and components.

// ---------- Time helpers ----------

function parseTs(ts) { return new Date(ts.replace(" ", "T")); }

function fmtRelative(date, now = new Date()) {
  const diff = (now - date) / 1000;
  if (diff < 60)    return Math.max(0, Math.floor(diff)) + "s ago";
  if (diff < 3600)  return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

// How long until something happens — the forward twin of fmtRelative, for a scheduled job rather than a
// recorded event. A time that has already passed reads "due" rather than a negative duration: the
// scheduler computes next-fire on its own cadence, so a moment either side of the boundary is normal and
// "-4s" would look like a fault. Null in → null out, so the caller renders its own honest gap.
function fmtUntil(date, now = new Date()) {
  if (!date || isNaN(date.getTime())) return null;
  const diff = (date - now) / 1000;
  if (diff <= 0)    return "due";
  if (diff < 60)    return "in " + Math.ceil(diff) + "s";
  if (diff < 3600)  return "in " + Math.round(diff / 60) + "m";
  if (diff < 86400) return "in " + Math.round(diff / 3600) + "h";
  return "in " + Math.round(diff / 86400) + "d";
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtTimeFull(ts) {
  const d = new Date(ts.replace(" ", "T"));
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Choose a traffic-light tone (success/warn/danger) for a numeric value
// against amber/red thresholds.
function statusTone(value, amber, red) {
  if (value >= red) return "danger";
  if (value >= amber) return "warn";
  return "success";
}

// ---------- Uptime ----------

// How long something has been up, in the two coarsest units that say anything —
// a host's boot time or a leaf unit's activation stamp. A stamp in the future or
// an unparseable one is an em-dash, never a negative duration.
function uptimeShort(bootTime) {
  const ms = Date.now() - new Date(bootTime).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------- Action metadata ----------

const ACTION_META = {
  "server.install":        { label: "Server installed",   icon: "package-plus",  tone: "success" },
  "server.start":          { label: "Server started",     icon: "play",          tone: "success" },
  "server.stop":           { label: "Server stopped",     icon: "square",        tone: "danger"  },
  "server.restart":        { label: "Server restarted",   icon: "rotate-cw",     tone: "update"  },
  "server.update":         { label: "Server updated",     icon: "download",      tone: "info"    },
  "server.crash":          { label: "Server crashed",     icon: "alert-triangle",tone: "danger"  },
  "server.rename":         { label: "Server renamed",     icon: "pencil",        tone: "info"    },
  "server.delete":         { label: "Server deleted",     icon: "trash-2",       tone: "danger"  },
  "player.join":           { label: "Player joined",      icon: "log-in",        tone: "info"    },
  "player.leave":          { label: "Player left",        icon: "log-out",       tone: "info"    },
  "player.kick":           { label: "Player kicked",      icon: "user-x",        tone: "warn"    },
  "player.ban":            { label: "Player banned",      icon: "shield-off",    tone: "danger"  },
  "player.unban":          { label: "Player unbanned",    icon: "shield-check",  tone: "info"    },
  "player.allow.add":      { label: "Allowlist updated",  icon: "user-check",    tone: "info"    },
  "player.allow.remove":   { label: "Allowlist updated",  icon: "user-x",        tone: "warn"    },
  "backup.create":         { label: "Backup created",     icon: "database",      tone: "success" },
  "backup.restore":        { label: "Backup restored",    icon: "rotate-ccw",    tone: "warn"    },
  "backup.delete":         { label: "Backup deleted",     icon: "trash-2",       tone: "danger"  },
  "backup.download":       { label: "Backup downloaded",  icon: "download",      tone: "info"    },
  "file.edit":             { label: "File edited",        icon: "file-pen",      tone: "info"    },
  "file.upload":           { label: "File uploaded",      icon: "upload",        tone: "info"    },
  "file.delete":           { label: "File deleted",       icon: "trash-2",       tone: "danger"  },
  "settings.change":       { label: "Settings changed",   icon: "settings",      tone: "info"    },
  "host.connect":          { label: "Host connected",     icon: "power",         tone: "success" },
  "host.disconnect":       { label: "Host disconnected",  icon: "power-off",     tone: "warn"    },
  "host.update":           { label: "Host updated",       icon: "package",       tone: "info"    },
  "host.add":              { label: "Host added",         icon: "server-cog",    tone: "success" },
  "host.remove":           { label: "Host removed",       icon: "trash-2",       tone: "danger"  },
  "auth.login":            { label: "Signed in",          icon: "log-in",        tone: "info"    },
  "auth.logout":           { label: "Signed out",         icon: "log-out",       tone: "info"    },
  "auth.token.create":     { label: "API token created",  icon: "key",           tone: "info"    },
  "discord.webhook.update":{ label: "Discord updated",    icon: "message-circle",tone: "info"    },
};

function actionCategory(action) {
  return action.split(".")[0];
}

const CATEGORY_LABEL = {
  server:   "Server",
  player:   "Players",
  backup:   "Backups",
  file:     "Files",
  settings: "Settings",
  auth:     "Auth",
  discord:  "Discord",
  host:     "Hosts",
};

// ---------- Byte & rate formatting ----------

// Binary units for live resource readouts. Null / non-finite → an em-dash;
// callers that want a distinct "not measured" treatment check for null first
// and never let these coerce a missing metric into "0 B".
const KIB = 1024, MIB = 1024 * 1024, GIB = 1024 * 1024 * 1024;

function formatBytes(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= GIB) return (n / GIB).toFixed(2) + " GiB";
  if (n >= MIB) return (n / MIB).toFixed(1) + " MiB";
  if (n >= KIB) return (n / KIB).toFixed(0) + " KiB";
  return Math.round(n) + " B";
}

// The compact form the leaf/services surfaces read in: binary-scaled like the above but
// labelled in the units an operator says out loud ("52 MB"), and null-in / null-out so a
// caller can tell "not measured" from a reading and render its own em-dash.
function fmtBytes(n) {
  if (n == null) return null;
  if (n >= GIB) return (n / GIB).toFixed(1) + " GB";
  if (n >= MIB) return Math.round(n / MIB) + " MB";
  if (n >= KIB) return Math.round(n / KIB) + " KB";
  return n + " B";
}

function formatBps(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= MIB) return (n / MIB).toFixed(1) + " MiB/s";
  if (n >= KIB) return (n / KIB).toFixed(0) + " KiB/s";
  return Math.round(n) + " B/s";
}

// ---------- Footprint ----------

function fmtFootprintMb(mb) {
  if (mb == null || !Number.isFinite(mb)) return "\u2014";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10) + " GB";
  }
  return Math.round(mb) + " MB";
}

export {
  ACTION_META,
  CATEGORY_LABEL,
  actionCategory,
  formatBytes,
  formatBps,
  fmtBytes,
  fmtFootprintMb,
  fmtRelative,
  fmtTime,
  fmtTimeFull,
  fmtUntil,
  parseTs,
  statusTone,
  uptimeShort,
};

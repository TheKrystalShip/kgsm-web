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

function uptimeFrom(bootTime) {
  const boot = new Date(bootTime);
  const ms = Date.now() - boot.getTime();
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
  fmtFootprintMb,
  fmtRelative,
  fmtTime,
  fmtTimeFull,
  parseTs,
  statusTone,
  uptimeFrom,
};

import { useEffect, useState } from "react";
import { KPI } from "./KPI.jsx";
import { parseTs, formatBytes } from "../lib/formatting.js";

// StatTiles — the server-detail overview KPIs. Renders the shared KPI card
// (KPI) so the overview matches the dashboard summary and host
// diagnostics. Live system load (CPU / RAM / Disk / Network) lives on the
// Performance tab; this strip answers the operational at-a-glance questions:
// who's on, what build, is an update waiting, and how fresh is the last backup.
//
// Every relative duration here is measured against wall-clock. How old a backup
// is is a fact about the world, not about the event feed — anchoring it to the
// newest audit event would subtract the host's idle time from the age and read an
// overdue backup as fresh. The tick timer below keeps those durations live.

function StatTiles({ server, playerCounts }) {
  const now = Date.now();

  // Force a re-render every 30s so wall-clock-relative subtitles (e.g.
  // "Checked 2m ago") update live without waiting for a new audit event.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick; // used only to trigger re-render

  const HOUR = 3600000;
  const fmtDur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  };

  // Player count — sourced from the roster hook (playerCounts prop) when
  // available, falling back to server.players for backward compat.
  const hasPlayers = playerCounts != null;
  const playerSub = hasPlayers
    ? (playerCounts.offline > 0
        ? playerCounts.offline + " offline" + (playerCounts.total > 0 ? " · " + playerCounts.total + " total" : "")
        : playerCounts.total + " total")
    : null;

  // Update available — server.update_available holds the target version string
  // when one is waiting, and is absent when up to date. The subtitle shows
  // "Checked X ago" when the cache has a timestamp, or "Checking for updates…"
  // when the first slow probe hasn't landed yet.
  const hasUpdate = !!server.update_available;
  const updateSub = hasUpdate
    ? "→ " + server.update_available
    : server.update_checked_at
      ? "Checked " + fmtDur(now - parseTs(server.update_checked_at)) + " ago"
      : "Checking for updates…";

  // Time since last backup — same concept as the dashboard's backup KPI:
  // fresh = ok, getting stale = warn, overdue (>24h) = danger.
  //
  // server.last_backup is the newest backup's own manifest record. Everything shown here is read off
  // that manifest; nothing is inferred. A manifest field the engine didn't record is simply omitted
  // rather than guessed — in particular there is no source for HOW a backup was triggered, so the
  // subtitle never characterizes it (it describes what the snapshot IS: size, what it captured, which
  // build). The count separates "scanned, none exist" from "not scanned yet"; only the first may say
  // "No backups yet", the second is an honest unknown.
  const backup = server.last_backup;
  const backupMs = backup?.createdAt ? (now - parseTs(backup.createdAt)) : null;
  const backupTone = backupMs == null ? "muted" : backupMs > 24 * HOUR ? "danger" : backupMs > 12 * HOUR ? "warn" : "ok";

  const backupSub = (() => {
    if (!backup) return server.backup_count === 0 ? "No backups yet" : "Not scanned yet";
    // Built only from fields the manifest actually carried, joined in the order that reads best:
    // how big it is, what it captured, which build it holds.
    const parts = [];
    if (backup.sizeBytes != null) parts.push(formatBytes(backup.sizeBytes));
    if (backup.sources?.length) parts.push(backup.sources.join(" + "));
    if (backup.version) parts.push("v" + backup.version);
    // A backup with no createdAt still exists and is still described — say so rather than showing a
    // detail line with no anchor.
    if (!parts.length) return backup.createdAt ? null : "Captured (no timestamp recorded)";
    return parts.join(" · ");
  })();

  return (
    <div className="stats">
      <KPI icon="users" label="Players" tone="info"
        value={hasPlayers ? playerCounts.current : "—"}
        sub={playerSub} />
      <KPI icon="tag" label="Version" tone="muted"
        value={server.version || "—"} />
      <KPI icon="circle-arrow-down" label="Update available"
        value={hasUpdate ? "Yes" : "No"}
        tone={hasUpdate ? "info" : "muted"}
        sub={updateSub} />
      <KPI icon="database-backup" label="Last backup"
        value={backupMs == null ? "—" : fmtDur(backupMs)}
        unit={backupMs == null ? null : "ago"}
        tone={backupTone}
        sub={backupSub} />
    </div>
  );
}

export { StatTiles };

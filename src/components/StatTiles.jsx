import { KPI } from "./KPI.jsx";
import { useStore } from "../lib/store.js";
import { auditStore } from "../lib/stores.js";
import { parseTs } from "../lib/formatting.js";

// StatTiles — the server-detail overview KPIs. Renders the shared KPI card
// (KPI) so the overview matches the dashboard summary and host
// diagnostics. Live system load (CPU / RAM / Disk / Network) lives on the
// Performance tab; this strip answers the operational at-a-glance questions:
// who's on, what build, is an update waiting, and how fresh is the last backup.
//
// "Now" is anchored to the most-recent audit event (like the dashboard's
// backup KPI) so the relative durations read sensibly against the freshest known
// event rather than drifting from wall-clock when the feed is quiet.

function StatTiles({ server, playerCounts }) {
  const auditList = useStore(auditStore, s => s.list);
  const now = auditList.length ? parseTs(auditList[0].ts) : new Date();

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
  // when one is waiting, and is absent when up to date.
  const hasUpdate = !!server.update_available;

  // Time since last backup — same concept as the dashboard's backup KPI:
  // fresh = ok, getting stale = warn, overdue (>24h) = danger.
  const backupMs = server.last_backup ? (now - parseTs(server.last_backup)) : null;
  const backupTone = backupMs == null ? "muted" : backupMs > 24 * HOUR ? "danger" : backupMs > 12 * HOUR ? "warn" : "ok";

  return (
    <div className="stats">
      <KPI icon="users" label="Players" tone="info"
        value={hasPlayers ? playerCounts.current : "—"}
        sub={playerSub} />
      <KPI icon="tag" label="Version" tone="muted"
        value={server.version || "—"} />
      <KPI icon="circle-arrow-up" label="Update available"
        value={hasUpdate ? "Yes" : "No"}
        tone={hasUpdate ? "info" : "muted"}
        sub={hasUpdate ? "→ " + server.update_available : "On the latest build"} />
      <KPI icon="database-backup" label="Last backup"
        value={backupMs == null ? "—" : fmtDur(backupMs)}
        unit={backupMs == null ? null : "ago"}
        tone={backupTone}
        sub={server.last_backup ? "Auto-snapshot" : "No backups yet"} />
    </div>
  );
}

export { StatTiles };

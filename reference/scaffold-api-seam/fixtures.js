// fixtures.js — bundled demo data (offline mode).
//
// This is a TRIMMED copy of the prototype's fixtures, kept only so the app
// renders with no backend. `api.js` returns these when VITE_API_BASE is unset.
// The shapes match the agreed backend contract (see api-contract.js) — when the
// real API lands, api.js swaps the source and these become dev-only seed data.
//
// The original prototype fixture (ui_kits/control-panel/src/lib/data.js) carries
// far more — per-server logs, metrics time-series, file trees, full host
// telemetry. Port the slices you need as you build each page.

/** @type {{ session: object, servers: import('./api-contract.js').Server[], hosts: import('./api-contract.js').Host[], catalog: import('./api-contract.js').CatalogGame[], auditLog: import('./api-contract.js').AuditEvent[] }} */
const KRYSTAL_DATA = {
  session: { ping_ms: 28, region: "fra1" },

  servers: [
    { id: "valheim", name: "MyValheimServer", game: "Valheim", status: "online", uptime: "0h 10m 58s", ip: "50.20.248.138:2456", players: { current: 4, max: 10 }, cpu: 38, ram: { used: 3.2, max: 4 }, version: "0.218.21", update_available: "0.219.4", last_backup: "2026-05-22T10:28:01", hostId: "primary", art: "linear-gradient(135deg,#1a3a4a 0%,#0e1a22 35%,transparent 65%),radial-gradient(circle at 80% 60%,#2a5566 0%,transparent 55%),#0B0F14" },
    { id: "ark", name: "Dino Survival #2", game: "ARK", status: "online", uptime: "2h 14m 03s", ip: "50.20.248.139:7777", players: { current: 8, max: 20 }, cpu: 62, ram: { used: 11.4, max: 16 }, version: "359.13", last_backup: "2026-05-21T05:21:08", hostId: "primary", art: "linear-gradient(135deg,#2a1f1a 0%,#1a1410 40%,transparent 70%),radial-gradient(circle at 75% 45%,#6b3d1f 0%,transparent 55%),#0B0F14" },
    { id: "mc", name: "Minecraft Survival", game: "Minecraft", status: "updating", uptime: "—", ip: "50.20.248.140:25565", players: { current: 0, max: 16 }, cpu: 12, ram: { used: 0.4, max: 8 }, version: "1.21.3 → 1.21.4", last_backup: "2026-05-22T08:14:32", hostId: "primary", art: "linear-gradient(135deg,#1a2a1a 0%,#0e1a10 40%,transparent 70%),radial-gradient(circle at 70% 50%,#2a5530 0%,transparent 55%),#0B0F14" },
    { id: "pal", name: "Palworld Friends", game: "Palworld", status: "offline", uptime: "—", ip: "50.20.248.141:8211", players: { current: 0, max: 32 }, cpu: 0, ram: { used: 0, max: 12 }, version: "0.3.5", last_backup: "2026-05-21T20:02:00", hostId: "primary", art: "linear-gradient(135deg,#1a1a2a 0%,#0e1018 40%,transparent 70%),radial-gradient(circle at 70% 50%,#3a3a66 0%,transparent 55%),#0B0F14" },
    { id: "rust", name: "Rusty Shores", game: "Rust", status: "online", uptime: "2d 4h 12m", ip: "203.0.113.20:28015", players: { current: 38, max: 100 }, cpu: 54, ram: { used: 6.8, max: 12 }, version: "2024.10.3", update_available: "2024.11.1", last_backup: "2026-05-22T10:41:30", hostId: "secondary", art: "linear-gradient(135deg,#2a1a14 0%,#1a0e0a 40%,transparent 70%),radial-gradient(circle at 70% 50%,#804a2a 0%,transparent 55%),#0B0F14" },
    { id: "enshrouded", name: "Embervale", game: "Enshrouded", status: "offline", uptime: "—", ip: "203.0.113.20:15637", players: { current: 0, max: 16 }, cpu: 0, ram: { used: 0, max: 8 }, version: "0.7.0.0", last_backup: "2026-05-21T22:14:00", hostId: "secondary", art: "linear-gradient(135deg,#1a1a2a 0%,#0e0e1a 40%,transparent 70%),radial-gradient(circle at 70% 50%,#6a4ab0 0%,transparent 55%),#0B0F14" },
  ],

  hosts: [
    { id: "primary", name: "Primary", hostname: "krystal-1.tks.example", region: "fra1", online: true, tier: "admin", panel_version: "0.14.2" },
    { id: "secondary", name: "Secondary", hostname: "krystal-2.tks.example", region: "syd1", online: true, tier: "operator", panel_version: "0.14.2" },
    { id: "community", name: "Community Box", hostname: "community.tks-fans.example", region: "iad1", online: true, tier: "none", authDenied: true, panel_version: "0.14.2" },
  ],

  catalog: [
    { id: "valheim", name: "Valheim", category: "Survival", players: "2–10", addedAt: "2025-11-02" },
    { id: "ark", name: "ARK: Survival Evolved", category: "Survival", players: "1–70", addedAt: "2026-01-15" },
    { id: "mc", name: "Minecraft", category: "Sandbox", players: "1–40", addedAt: "2025-12-20" },
    { id: "rust", name: "Rust", category: "Survival", players: "10–200", addedAt: "2026-06-10" },
    { id: "csgo", name: "Counter-Strike 2", category: "FPS", players: "5v5", addedAt: "2026-06-08" },
    { id: "factorio", name: "Factorio", category: "Sandbox", players: "1–65", addedAt: "2026-05-30" },
    { id: "enshrouded", name: "Enshrouded", category: "Survival", players: "1–16", addedAt: "2026-06-01" },
    { id: "satisfactory", name: "Satisfactory", category: "Sandbox", players: "1–4", addedAt: "2026-06-11" },
  ],

  auditLog: [
    { id: "evt_061", ts: "2026-05-22T10:41:30", actor: { name: "system", provider: "system" }, action: "backup.create", severity: "success", serverId: "rust", summary: "ran auto-backup on Rusty Shores" },
    { id: "evt_060", ts: "2026-05-22T10:38:05", actor: { name: "haru", provider: "discord" }, action: "server.start", severity: "success", serverId: "rust", summary: "started Rusty Shores" },
    { id: "evt_059", ts: "2026-05-22T10:35:12", actor: { name: "haru", provider: "discord" }, action: "server.stop", severity: "warn", serverId: "enshrouded", summary: "shut down Embervale" },
    { id: "evt_058", ts: "2026-05-22T10:32:14", actor: { name: "haru", provider: "discord" }, action: "server.start", severity: "success", serverId: "valheim", summary: "started MyValheimServer" },
    { id: "evt_054", ts: "2026-05-22T08:14:00", actor: { name: "system", provider: "system" }, action: "server.update", severity: "info", serverId: "mc", summary: "began updating Minecraft Survival" },
    { id: "evt_052b", ts: "2026-05-22T07:48:30", actor: { name: "system", provider: "system" }, action: "server.crash", severity: "danger", serverId: "mc", summary: "Minecraft Survival crashed — auto-restarted by watchdog" },
    { id: "evt_050", ts: "2026-05-22T06:18:42", actor: { name: "eskild_iron", provider: "discord" }, action: "file.edit", severity: "info", serverId: "valheim", summary: "edited config/server.cfg" },
    { id: "evt_049", ts: "2026-05-21T22:14:08", actor: { name: "haru", provider: "discord" }, action: "player.ban", severity: "danger", serverId: "valheim", summary: "banned spam_account9 from MyValheimServer" },
  ],
};

export default KRYSTAL_DATA;

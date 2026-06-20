// Lazy: only used in deferred demo setInterval flips (guarded). A static import
// would form a data<->capabilities<->stores init cycle.
let setHostCapability = null;
import("./capabilities.js").then((m) => { setHostCapability = m.setHostCapability; });

// Fake fixtures for the Krystal control panel demo.

// Shared UI labels — single source of truth for nav/section names that appear in
// more than one place. Rename here and every reference updates (sidebar nav, the
// dashboard "Recently added" band, breadcrumbs…), so the surfaces can't drift.
const KRYSTAL_LABELS = {
  catalog: "Catalog",
};

const KRYSTAL_DATA = {
  // Operator's live connection to the panel host — read by the dashboard "Ping"
  // KPI. Simulated here; a real backend measures round-trip to the agent.
  session: { ping_ms: 28, region: "fra1" },
  servers: [
    {
      id: "valheim", rawg_slug: "valheim",
      name: "MyValheimServer",
      game: "Valheim",
      notice: "Running the Valheim Plus mod \u2014 you don't need to install anything on your end, but heads-up: you'll see a custom splash screen when you log in. That's expected.\n\nMap wipes are announced a day ahead in #valheim on Discord. Stuck on connect? Ping @runeforge.",
      status: "online",
      uptime: "0h 10m 58s",
      ip: "50.20.248.138:2456",
      players: { current: 4, max: 10 },
      cpu: 38,
      ram: { used: 3.2, max: 4 },
      version: "0.218.21",
      update_available: "0.219.4",
      last_backup: "2026-05-22T10:28:01",
      hostId: "primary",
      config: { file: "config/server.cfg", name: "MyValheimServer", world: "Skogheim", port: 2456, max_players: 10, password: "(set)", difficulty: "normal", raid_freq: 1.0, crossplay: true, discord_webhook: "(set)" },
      // tinted teal-on-black gradient as a stand-in for game art
      art: "linear-gradient(135deg, #1a3a4a 0%, #0e1a22 35%, transparent 65%), radial-gradient(circle at 80% 60%, #2a5566 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "07:35:11", tag: "info", text: "Game server connected" },
        { ts: "07:35:11", tag: null,   text: "Loading world: \u00a7Skogheim\u00a7" },
        { ts: "07:35:12", tag: "ok",   text: "339 lines · 204703 objects loaded" },
        { ts: "07:35:12", tag: "warn", text: "shader DepthOfField unsupported on platform" },
        { ts: "07:35:14", tag: null,   text: "Player \u00a7runeforge_42\u00a7 joined from 81.4.10.22" },
        { ts: "07:35:22", tag: null,   text: "Generating locations…" },
        { ts: "07:35:31", tag: "ok",   text: "World saved" },
        { ts: "07:36:02", tag: null,   text: "Player \u00a7eskild_iron\u00a7 joined from 92.81.4.19" },
      ],
    },
    {
      id: "ark", rawg_slug: "ark-survival-evolved",
      name: "Dino Survival #2",
      game: "ARK",
      notice: "PvP is ON. Rates are 3\u00d7 harvest / 5\u00d7 taming / 2\u00d7 XP. Tribe limit is 200 \u2014 keep it civil in global chat, admins are watching.",
      status: "online",
      uptime: "2h 14m 03s",
      ip: "50.20.248.139:7777",
      players: { current: 8, max: 20 },
      cpu: 62,
      ram: { used: 11.4, max: 16 },
      version: "359.13",
      last_backup: "2026-05-21T05:21:08",
      hostId: "primary",
      config: { file: "config/GameUserSettings.ini", map: "TheIsland", port: 7777, max_players: 20, difficulty_offset: 1.0, pvp: true, harvest_mult: 3, taming_mult: 5, xp_mult: 2 },
      art: "linear-gradient(135deg, #2a1f1a 0%, #1a1410 40%, transparent 70%), radial-gradient(circle at 75% 45%, #6b3d1f 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "05:21:08", tag: "info", text: "Auto-save complete (saveark_2025.bak)" },
        { ts: "05:21:30", tag: null,   text: "Player \u00a7raptor_queen\u00a7 joined" },
        { ts: "05:22:10", tag: "warn", text: "Tribe limit reached (200/200)" },
        { ts: "05:22:45", tag: null,   text: "Day 142 — temperature falling" },
      ],
    },
    {
      id: "mc", rawg_slug: "minecraft",
      name: "Minecraft Survival",
      game: "Minecraft",
      status: "updating",
      uptime: "—",
      ip: "50.20.248.140:25565",
      players: { current: 0, max: 16 },
      cpu: 12,
      ram: { used: 0.4, max: 8 },
      version: "1.21.3 → 1.21.4",
      last_backup: "2026-05-22T08:14:32",
      hostId: "primary",
      config: { file: "server.properties", gamemode: "survival", difficulty: "normal", max_players: 16, online_mode: true, view_distance: 10, pvp: true, whitelist: false, spawn_protection: 16 },
      art: "linear-gradient(135deg, #1a2a1a 0%, #0e1a10 40%, transparent 70%), radial-gradient(circle at 70% 50%, #2a5530 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "08:14:00", tag: "info", text: "Downloading server-1.21.4.jar (38.4 MB)" },
        { ts: "08:14:22", tag: "info", text: "Verifying signature…" },
        { ts: "08:14:31", tag: "ok",   text: "Update verified · 5b9c…f042" },
        { ts: "08:14:32", tag: "info", text: "Backing up worlds…" },
      ],
    },
    {
      id: "pal", rawg_slug: "palworld",
      name: "Palworld Friends",
      game: "Palworld",
      status: "offline",
      uptime: "—",
      ip: "50.20.248.141:8211",
      players: { current: 0, max: 32 },
      cpu: 0,
      ram: { used: 0, max: 12 },
      version: "0.3.5",
      last_backup: "2026-05-21T20:02:00",
      hostId: "primary",
      config: { file: "PalWorldSettings.ini", difficulty: "normal", max_players: 32, pvp: false, death_penalty: "item", base_camp_max: 128, day_speed: 1.0 },
      art: "linear-gradient(135deg, #1a1a2a 0%, #0e1018 40%, transparent 70%), radial-gradient(circle at 70% 50%, #3a3a66 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "yesterday", tag: "info", text: "Server shutdown by user (haru)" },
      ],
    },
    {
      id: "rust", rawg_slug: "rust",
      name: "Rusty Shores",
      game: "Rust",
      status: "online",
      uptime: "2d 4h 12m",
      ip: "203.0.113.20:28015",
      players: { current: 38, max: 100 },
      cpu: 54,
      ram: { used: 6.8, max: 12 },
      version: "2024.10.3",
      update_available: "2024.11.1",
      last_backup: "2026-05-22T10:41:30",
      hostId: "secondary",
      config: { file: "server.cfg", port: 28015, query: 28017, max_players: 100, pvp: true, wipe_schedule: "weekly", decay_scale: 1.0 },
      art: "linear-gradient(135deg, #2a1a14 0%, #1a0e0a 40%, transparent 70%), radial-gradient(circle at 70% 50%, #804a2a 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "08:14:02", tag: "ok", text: "38 players connected" },
      ],
    },
    {
      id: "enshrouded", rawg_slug: "enshrouded",
      name: "Embervale",
      game: "Enshrouded",
      status: "offline",
      uptime: "—",
      ip: "203.0.113.20:15637",
      players: { current: 0, max: 16 },
      cpu: 0,
      ram: { used: 0, max: 8 },
      version: "0.7.0.0",
      last_backup: "2026-05-21T22:14:00",
      hostId: "secondary",
      config: { file: "enshrouded_server.json", port: 15637, query: 15638, max_players: 16, difficulty: "default" },
      art: "linear-gradient(135deg, #1a1a2a 0%, #0e0e1a 40%, transparent 70%), radial-gradient(circle at 70% 50%, #6a4ab0 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "yesterday", tag: "info", text: "Server stopped — idle for 6h" },
      ],
    },
    {
      id: "valheim-2", rawg_slug: "valheim",
      name: "Ashlands EU",
      game: "Valheim",
      status: "online",
      uptime: "1d 6h 41m",
      ip: "50.20.248.142:2457",
      players: { current: 7, max: 10 },
      cpu: 44,
      ram: { used: 3.6, max: 4 },
      version: "0.218.21",
      last_backup: "2026-05-22T09:02:14",
      hostId: "primary",
      config: { file: "config/server.cfg", name: "Ashlands EU", world: "Muspelheim", port: 2457, max_players: 10, password: "(set)", difficulty: "hard", raid_freq: 1.5, crossplay: true, discord_webhook: "(set)" },
      art: "linear-gradient(135deg, #1a3a4a 0%, #0e1a22 35%, transparent 65%), radial-gradient(circle at 80% 60%, #2a5566 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "06:41:02", tag: "ok", text: "7 players connected" },
      ],
    },
    {
      id: "ark-2", rawg_slug: "ark-survival-evolved",
      name: "Ragnarok Cluster",
      game: "ARK",
      status: "crashed",
      uptime: "—",
      ip: "50.20.248.143:7779",
      players: { current: 0, max: 20 },
      cpu: 0,
      ram: { used: 0, max: 16 },
      version: "359.13",
      last_backup: "2026-05-21T18:55:40",
      hostId: "secondary",
      config: { file: "config/GameUserSettings.ini", map: "Ragnarok", port: 7779, max_players: 20, difficulty_offset: 1.0, pvp: true, harvest_mult: 3, taming_mult: 5, xp_mult: 2 },
      art: "linear-gradient(135deg, #2a1f1a 0%, #1a1410 40%, transparent 70%), radial-gradient(circle at 75% 45%, #6b3d1f 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "18:55:40", tag: "err", text: "Fatal: out of memory — process exited (137)" },
      ],
    },
    {
      id: "mc-2", rawg_slug: "minecraft",
      name: "Creative Flat",
      game: "Minecraft",
      status: "online",
      uptime: "5h 02m",
      ip: "50.20.248.144:25566",
      players: { current: 3, max: 16 },
      cpu: 9,
      ram: { used: 2.2, max: 8 },
      version: "1.21.4",
      last_backup: "2026-05-22T07:30:00",
      hostId: "primary",
      config: { file: "server.properties", gamemode: "creative", difficulty: "peaceful", max_players: 16, online_mode: true, view_distance: 12, pvp: false, whitelist: true, spawn_protection: 0 },
      art: "linear-gradient(135deg, #1a2a1a 0%, #0e1a10 40%, transparent 70%), radial-gradient(circle at 70% 50%, #2a5530 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "07:30:00", tag: "ok", text: "World saved · creative_flat" },
      ],
    },
    {
      id: "mc-3", rawg_slug: "minecraft",
      name: "Hardcore S4",
      game: "Minecraft",
      status: "offline",
      uptime: "—",
      ip: "50.20.248.145:25567",
      players: { current: 0, max: 16 },
      cpu: 0,
      ram: { used: 0, max: 8 },
      version: "1.21.4",
      last_backup: "2026-05-20T23:11:09",
      hostId: "secondary",
      config: { file: "server.properties", gamemode: "survival", difficulty: "hard", hardcore: true, max_players: 16, online_mode: true, view_distance: 10, pvp: true, whitelist: true, spawn_protection: 16 },
      art: "linear-gradient(135deg, #1a2a1a 0%, #0e1a10 40%, transparent 70%), radial-gradient(circle at 70% 50%, #2a5530 0%, transparent 55%), #0B0F14",
      log: [
        { ts: "2 days ago", tag: "info", text: "Season 4 wipe scheduled" },
      ],
    },
  ],

  // ---- Game catalog (Library page) ----
  // The backend resolves cover art server-side (provider key stays off the
  // browser) and sends each entry a `cover` URL; the frontend renders it, or
  // falls back to the `art` gradient when absent. rawg_slug is the backend's
  // lookup hint, not used by the frontend. See architecture.html §3·i.
  // addedAt — when the game entry was added to this library (ISO date). The
  // dashboard "Recently added" card and the library's "Recently added" filter
  // read this. Reference "now" is derived from the newest addedAt so the card
  // always reads fresh regardless of wall-clock.
  // NOTE: there is deliberately no `installed` flag here. Whether a game is
  // "installed" is derived live from the `servers` list above (a game is
  // installed iff ≥1 server runs from it) — see gameIsInstalled() in Library.jsx.
  // A static flag drifts out of sync the moment a server is created or deleted.
  // hosts — which connected hosts OFFER this blueprint. Omitted = offered by
  // every host (the common case: identical catalogs across the fleet). A subset
  // means only those hosts can install it; the card and install modal reflect
  // that. A host that already runs an instance must always appear here.
  catalog: [
    { id: "valheim",   rawg_slug: "valheim",                   name: "Valheim",            category: "Survival",   players: "2–10",  addedAt: "2025-11-02", art: "linear-gradient(135deg, #1a3a4a 0%, #0e1a22 35%), radial-gradient(circle at 80% 60%, #2a5566 0%, transparent 55%), #0B0F14" },
    { id: "ark",       rawg_slug: "ark-survival-evolved",      name: "ARK: Survival Evolved", category: "Survival", players: "1–70", addedAt: "2026-01-15", art: "linear-gradient(135deg, #2a1f1a 0%, #1a1410 40%), radial-gradient(circle at 75% 45%, #6b3d1f 0%, transparent 55%), #0B0F14" },
    { id: "mc",        rawg_slug: "minecraft",                 name: "Minecraft",          category: "Sandbox",    players: "1–40",  addedAt: "2025-12-20", art: "linear-gradient(135deg, #1a2a1a 0%, #0e1a10 40%), radial-gradient(circle at 70% 50%, #2a5530 0%, transparent 55%), #0B0F14" },
    { id: "pal",       rawg_slug: "palworld",                  name: "Palworld",           category: "Survival",   players: "1–32",  addedAt: "2026-02-08", art: "linear-gradient(135deg, #1a1a2a 0%, #0e1018 40%), radial-gradient(circle at 70% 50%, #3a3a66 0%, transparent 55%), #0B0F14" },
    { id: "rust",      rawg_slug: "rust",                      name: "Rust",               category: "Survival",   players: "10–200", addedAt: "2026-06-10", art: "linear-gradient(135deg, #2a1a14 0%, #1a0e0a 40%), radial-gradient(circle at 70% 50%, #804a2a 0%, transparent 55%), #0B0F14" },
    { id: "csgo",      rawg_slug: "counter-strike-2",          name: "Counter-Strike 2",   category: "FPS",        players: "5v5",   addedAt: "2026-06-08", art: "linear-gradient(135deg, #2a241a 0%, #1a160e 40%), radial-gradient(circle at 70% 50%, #b08a3a 0%, transparent 55%), #0B0F14" },
    { id: "tf2",       rawg_slug: "team-fortress-2",           name: "Team Fortress 2",    category: "FPS",        players: "12v12", addedAt: "2026-05-28", art: "linear-gradient(135deg, #2a1a1a 0%, #1a0e0e 40%), radial-gradient(circle at 70% 50%, #c46a3a 0%, transparent 55%), #0B0F14" },
    { id: "garrysmod", rawg_slug: "garrys-mod",                name: "Garry's Mod",        category: "Sandbox",    players: "1–128", addedAt: "2026-06-04", art: "linear-gradient(135deg, #1a242a 0%, #0e161a 40%), radial-gradient(circle at 70% 50%, #3a7080 0%, transparent 55%), #0B0F14" },
    { id: "factorio",  rawg_slug: "factorio",                  name: "Factorio",           category: "Sandbox",    players: "1–65",  addedAt: "2026-05-30", art: "linear-gradient(135deg, #2a261a 0%, #1a170e 40%), radial-gradient(circle at 70% 50%, #b09848 0%, transparent 55%), #0B0F14" },
    { id: "tlauncher", rawg_slug: "terraria",                  name: "Terraria",           category: "Sandbox",    players: "1–8",   addedAt: "2026-03-12", art: "linear-gradient(135deg, #2a1a24 0%, #1a0e16 40%), radial-gradient(circle at 70% 50%, #a04875 0%, transparent 55%), #0B0F14" },
    { id: "satisfactory", rawg_slug: "satisfactory",           name: "Satisfactory",       category: "Sandbox",    players: "1–4",   hosts: ["secondary"], addedAt: "2026-06-11", art: "linear-gradient(135deg, #2a241a 0%, #1a170e 40%), radial-gradient(circle at 70% 50%, #d09038 0%, transparent 55%), #0B0F14" },
    { id: "enshrouded", rawg_slug: "enshrouded",               name: "Enshrouded",         category: "Survival",   players: "1–16",  addedAt: "2026-06-01", art: "linear-gradient(135deg, #1a1a2a 0%, #0e0e1a 40%), radial-gradient(circle at 70% 50%, #6a4ab0 0%, transparent 55%), #0B0F14" },
    { id: "lod",       rawg_slug: "left-4-dead-2",             name: "Left 4 Dead 2",      category: "Co-op",      players: "1–4",   addedAt: "2026-04-20", art: "linear-gradient(135deg, #1a1a14 0%, #0e0e0a 40%), radial-gradient(circle at 70% 50%, #c44848 0%, transparent 55%), #0B0F14" },
    { id: "projectzomboid", rawg_slug: "project-zomboid",      name: "Project Zomboid",    category: "Survival",   players: "1–32",  hosts: ["primary"], addedAt: "2026-05-22", art: "linear-gradient(135deg, #14181a 0%, #0a0e10 40%), radial-gradient(circle at 70% 50%, #4a8088 0%, transparent 55%), #0B0F14" },
  ],

  // ---- File tree for the active server ----
  files: [
    { type: "folder", name: "world/", children: [
      { type: "file", name: "Skogheim.fwl", size: "428 KB", lang: "binary" },
      { type: "file", name: "Skogheim.db",  size: "32.4 MB", lang: "binary" },
    ]},
    { type: "folder", name: "config/", open: true, children: [
      { type: "file", name: "server.cfg",       size: "2.1 KB", lang: "cfg",  active: true },
      { type: "file", name: "permissions.json", size: "412 B",  lang: "json" },
      { type: "file", name: "discord.toml",     size: "287 B",  lang: "toml" },
    ]},
    { type: "folder", name: "logs/", children: [
      { type: "file", name: "server.log",  size: "1.4 MB", lang: "log" },
      { type: "file", name: "crash.dump",  size: "—",       lang: "log" },
    ]},
    { type: "file", name: "README.md",   size: "612 B", lang: "md" },
    { type: "file", name: "start.sh",    size: "184 B", lang: "sh" },
  ],

  // sample file content for server.cfg
  fileContent: {
    path: "config/server.cfg",
    lang: "cfg",
    lines: [
      { c: "# Krystal Ship · server.cfg",     k: "c" },
      { c: "# Auto-generated. Edit & save to apply on next restart.", k: "c" },
      { c: "" },
      { c: "[server]" },
      { c: 'name        = "MyValheimServer"',  k: "s" },
      { c: 'world       = "Skogheim"',         k: "s" },
      { c: "port        = 2456",               k: "n" },
      { c: "max_players = 10",                 k: "n" },
      { c: 'password    = "***"',              k: "s" },
      { c: "" },
      { c: "[difficulty]" },
      { c: "preset      = normal" },
      { c: "raid_freq   = 1.0",                k: "n" },
      { c: "death_drop  = on_corpse" },
      { c: "" },
      { c: "[discord]" },
      { c: 'webhook     = "https://discord.com/api/webhooks/****"', k: "s" },
      { c: "notify_join = true" },
    ],
  },

  // ---- Backups for the active server ----
  backups: [
    { name: "Skogheim-2025-09-13-0735.bak", size: "32.4 MB", when: "Today, 07:35", type: "auto" },
    { name: "Skogheim-2025-09-13-0130.bak", size: "32.3 MB", when: "Today, 01:30", type: "auto" },
    { name: "Skogheim-pre-update.bak",      size: "31.9 MB", when: "Yesterday, 22:14", type: "manual" },
    { name: "Skogheim-2025-09-12-1930.bak", size: "31.8 MB", when: "Yesterday, 19:30", type: "auto" },
    { name: "Skogheim-clean-base.bak",      size: "28.2 MB", when: "Sep 10, 11:02",    type: "manual" },
  ],

  // ---- Players currently online per server ----
  // role: owner | admin | mod | player | guest
  // banned/allowlist filtered into one flat list, server-side would split it.
  playersByServer: {
    valheim: [
      { name: "runeforge_42",   role: "owner",   ping: 24,  joined: "07:35:14", playtime_min: 142, status: "online" },
      { name: "eskild_iron",    role: "admin",   ping: 38,  joined: "07:36:02", playtime_min: 138, status: "online" },
      { name: "frostbloom",     role: "player",  ping: 61,  joined: "08:01:50", playtime_min: 87,  status: "online" },
      { name: "halla_skadi",    role: "player",  ping: 19,  joined: "08:22:11", playtime_min: 47,  status: "online" },
      { name: "mossbeard",      role: "player",  ping: 88,  joined: "yesterday", playtime_min: 0,  status: "offline" },
      { name: "spam_account9",  role: "guest",   ping: null, joined: "—",        playtime_min: 0,  status: "banned",   banned_at: "Sep 11", reason: "exploit" },
      { name: "trusted_alt",    role: "admin",   ping: null, joined: "—",        playtime_min: 0,  status: "allowlist" },
    ],
    ark: [
      { name: "raptor_queen",   role: "owner",   ping: 32,  joined: "05:21:30", playtime_min: 220, status: "online" },
      { name: "primal_rex",     role: "player",  ping: 47,  joined: "05:45:11", playtime_min: 195, status: "online" },
      { name: "trike_pal",      role: "player",  ping: 71,  joined: "06:12:33", playtime_min: 164, status: "online" },
    ],
    mc: [],
    pal: [],
  },

  // ---- Metrics (time-series) per server ----
  // 48 points each — read as "last 24h, every 30 minutes" or "last hour, every
  // 75 seconds" depending on the active range. Real backend returns this shape
  // from GET /servers/{id}/metrics?range=24h.
  // Each point: { t: minutesAgo, cpu, ram_pct, players, disk_pct, net_in_kbps, net_out_kbps, tick_ms }
  metricsByServer: {
    valheim: (function () {
      // Deterministic pseudo-random walk so the demo doesn't reshuffle on each
      // mount (which would look like a JS bug).
      let s = 0.31; const r = () => { s = (s * 9301 + 49297) % 233280 / 233280; return s; };
      const out = [];
      let cpu = 32, ram = 75, players = 0, tick = 16, net_in = 120, net_out = 280, disk = 57;
      for (let i = 47; i >= 0; i--) {
        cpu = Math.max(8, Math.min(82, cpu + (r() - 0.5) * 12));
        ram = Math.max(60, Math.min(96, ram + (r() - 0.5) * 4));
        players = Math.max(0, Math.min(10, players + (r() < 0.4 ? (r() < 0.5 ? -1 : 1) : 0)));
        tick = Math.max(14.5, Math.min(28, tick + (r() - 0.5) * 1.6 + (cpu > 70 ? 0.4 : 0)));
        net_in = Math.max(20, net_in + (r() - 0.5) * 40);
        net_out = Math.max(40, net_out + (r() - 0.5) * 80);
        disk = Math.max(40, Math.min(95, disk + (r() - 0.4) * 1.1));
        out.push({ t: i, cpu: +cpu.toFixed(1), ram_pct: +ram.toFixed(1), players, tick_ms: +tick.toFixed(1), disk_pct: +disk.toFixed(1), net_in_kbps: Math.round(net_in), net_out_kbps: Math.round(net_out) });
      }
      // Ensure the most recent point matches the live "now" values in servers[].
      const last = out[out.length - 1];
      last.cpu = 38; last.ram_pct = 80; last.players = 4; last.disk_pct = 63;
      return out;
    })(),
    ark: (function () {
      let s = 0.71; const r = () => { s = (s * 9301 + 49297) % 233280 / 233280; return s; };
      const out = []; let cpu = 55, ram = 70, players = 0, tick = 22, net_in = 220, net_out = 480, disk = 49;
      for (let i = 47; i >= 0; i--) {
        cpu = Math.max(35, Math.min(90, cpu + (r() - 0.5) * 14));
        ram = Math.max(55, Math.min(95, ram + (r() - 0.5) * 3.5));
        players = Math.max(0, Math.min(20, players + (r() < 0.45 ? (r() < 0.5 ? -1 : 2) : 0)));
        tick = Math.max(18, Math.min(32, tick + (r() - 0.5) * 2));
        net_in = Math.max(60, net_in + (r() - 0.5) * 80);
        net_out = Math.max(120, net_out + (r() - 0.5) * 150);
        disk = Math.max(40, Math.min(95, disk + (r() - 0.4) * 1.2));
        out.push({ t: i, cpu: +cpu.toFixed(1), ram_pct: +ram.toFixed(1), players, tick_ms: +tick.toFixed(1), disk_pct: +disk.toFixed(1), net_in_kbps: Math.round(net_in), net_out_kbps: Math.round(net_out) });
      }
      const last = out[out.length - 1]; last.cpu = 62; last.ram_pct = 71; last.players = 8; last.disk_pct = 57;
      return out;
    })(),
    mc:  null,  // offline / updating — no recent series
    pal: null,
  },

  // ---- Audit log -----------------------------------------------
  // Single source of truth for "who did what, when" across the whole product.
  // - Dashboard "Recent activity" reads the most recent ~7 entries.
  // - The dedicated /audit page reads all of them with search + filters.
  //
  // Each entry:
  //   id        unique handle
  //   ts        ISO-ish timestamp ("2026-05-22T10:32:14")
  //   actor     { name, provider }  — provider="system" means automation
  //   action    dot-notation enum (see categories below)
  //   severity  "success" | "info" | "warn" | "danger"
  //   target    optional { kind, id, name }
  //   serverId  optional convenience id of the server the event belongs to
  //   summary   short past-tense human phrase (e.g. "started MyValheimServer")
  //   meta      any additional context (reason, size, source, etc.)
  //
  // Actions in use:
  //   server.{install, start, stop, restart, update, crash, rename, delete}
  //   player.{kick, ban, unban, allow.add, allow.remove, join, leave}
  //   backup.{create, restore, delete, download}
  //   file.{edit, upload, delete}
  //   settings.change
  //   auth.{login, logout, token.create}
  //   discord.{webhook.update}
  auditLog: [
    { id: "evt_063", ts: "2026-05-22T11:05:18", actor: { name: "system",       provider: "system"  }, action: "host.update",   severity: "info",    target: { kind: "host", id: "primary", name: "Primary" }, hostId: "primary", summary: "deployed krystal-panel 0.14.2 on Primary", meta: { version: "0.14.2", source: "auto" } },
    { id: "evt_062", ts: "2026-05-22T11:02:40", actor: { name: "haru",          provider: "discord" }, action: "host.connect",  severity: "success", target: { kind: "host", id: "secondary", name: "Secondary" }, hostId: "secondary", summary: "connected host Secondary", meta: { region: "syd1", hostname: "krystal-2.tks.example" } },
    { id: "evt_061", ts: "2026-05-22T10:41:30", actor: { name: "system",       provider: "system"  }, action: "backup.create",  severity: "success", target: { kind: "backup", id: "RustyShores-2026-05-22-1041.bak", name: "RustyShores-2026-05-22-1041.bak" }, serverId: "rust", summary: "ran auto-backup on Rusty Shores", meta: { size: "1.2 GB", source: "cron" } },
    { id: "evt_060", ts: "2026-05-22T10:38:05", actor: { name: "haru",         provider: "discord" }, action: "server.start",   severity: "success", target: { kind: "server", id: "rust", name: "Rusty Shores" }, serverId: "rust", summary: "started Rusty Shores", meta: { source: "web" } },
    { id: "evt_059", ts: "2026-05-22T10:35:12", actor: { name: "haru",         provider: "discord" }, action: "server.stop",    severity: "warn",    target: { kind: "server", id: "enshrouded", name: "Embervale" }, serverId: "enshrouded", summary: "shut down Embervale", meta: { reason: "idle", source: "web" } },
    { id: "evt_058", ts: "2026-05-22T10:32:14", actor: { name: "haru",         provider: "discord" }, action: "server.start",   severity: "success", target: { kind: "server", id: "valheim", name: "MyValheimServer" }, serverId: "valheim", summary: "started MyValheimServer",                meta: { source: "web" } },
    { id: "evt_057", ts: "2026-05-22T10:28:01", actor: { name: "system",       provider: "system"  }, action: "backup.create",  severity: "success", target: { kind: "backup", id: "Skogheim-2026-05-22-1028.bak", name: "Skogheim-2026-05-22-1028.bak" }, serverId: "valheim", summary: "ran auto-backup on MyValheimServer",     meta: { size: "32.4 MB", source: "cron" } },
    { id: "evt_056", ts: "2026-05-22T09:45:32", actor: { name: "haru",         provider: "discord" }, action: "server.install", severity: "success", target: { kind: "server", id: "pal", name: "Palworld Friends" }, serverId: "pal", summary: "installed Palworld",                    meta: { port: 8211, source: "web" } },
    { id: "evt_055", ts: "2026-05-22T08:22:18", actor: { name: "halla_skadi",  provider: "discord" }, action: "player.join",    severity: "info",    target: { kind: "player", name: "halla_skadi" }, serverId: "valheim", summary: "joined MyValheimServer",                 meta: { ip: "92.81.4.19" } },
    { id: "evt_054", ts: "2026-05-22T08:14:00", actor: { name: "system",       provider: "system"  }, action: "server.update",  severity: "info",    target: { kind: "server", id: "mc", name: "Minecraft Survival" }, serverId: "mc", summary: "began updating Minecraft Survival",      meta: { from: "1.21.3", to: "1.21.4" } },
    { id: "evt_053", ts: "2026-05-22T08:01:50", actor: { name: "frostbloom",   provider: "discord" }, action: "player.join",    severity: "info",    target: { kind: "player", name: "frostbloom" }, serverId: "valheim", summary: "joined MyValheimServer", meta: {} },
    { id: "evt_052b", ts: "2026-05-22T07:48:30", actor: { name: "system",       provider: "system"  }, action: "server.crash",   severity: "danger",  target: { kind: "server", id: "mc", name: "Minecraft Survival" }, serverId: "mc", summary: "Minecraft Survival crashed — auto-restarted by watchdog", meta: { exit_code: 139, restarted: true } },
    { id: "evt_052", ts: "2026-05-22T07:35:11", actor: { name: "system",       provider: "system"  }, action: "backup.create",  severity: "success", target: { kind: "backup", id: "Skogheim-2026-05-22-0735.bak", name: "Skogheim-2026-05-22-0735.bak" }, serverId: "valheim", summary: "ran auto-backup on MyValheimServer",     meta: { size: "32.4 MB", source: "cron" } },
    { id: "evt_051", ts: "2026-05-22T07:30:02", actor: { name: "system",       provider: "system"  }, action: "server.restart", severity: "info",    target: { kind: "server", id: "ark", name: "Dino Survival #2" }, serverId: "ark", summary: "restarted Dino Survival #2",            meta: { source: "schedule" } },
    { id: "evt_050", ts: "2026-05-22T06:18:42", actor: { name: "eskild_iron",  provider: "discord" }, action: "file.edit",      severity: "info",    target: { kind: "file", name: "config/server.cfg" }, serverId: "valheim", summary: "edited config/server.cfg",               meta: { lines_changed: 3 } },

    { id: "evt_049", ts: "2026-05-21T22:14:08", actor: { name: "haru",         provider: "discord" }, action: "player.ban",     severity: "danger",  target: { kind: "player", name: "spam_account9" }, serverId: "valheim", summary: "banned spam_account9 from MyValheimServer", meta: { reason: "exploit" } },
    { id: "evt_048", ts: "2026-05-21T20:02:11", actor: { name: "haru",         provider: "discord" }, action: "server.stop",    severity: "warn",    target: { kind: "server", id: "pal", name: "Palworld Friends" }, serverId: "pal", summary: "shut down Palworld Friends",             meta: { source: "web" } },
    { id: "evt_047", ts: "2026-05-21T18:44:55", actor: { name: "eskild_iron",  provider: "discord" }, action: "player.kick",    severity: "warn",    target: { kind: "player", name: "afk_zoltan" }, serverId: "valheim", summary: "kicked afk_zoltan from MyValheimServer", meta: { reason: "idle 30min" } },
    { id: "evt_046", ts: "2026-05-21T16:30:01", actor: { name: "haru",         provider: "discord" }, action: "settings.change",severity: "info",    target: { kind: "server", id: "valheim", name: "MyValheimServer" }, serverId: "valheim", summary: "updated MyValheimServer settings",     meta: { changed: "scheduled_restart: weekly → daily" } },
    { id: "evt_045", ts: "2026-05-21T14:11:22", actor: { name: "haru",         provider: "discord" }, action: "auth.token.create", severity: "info", target: { kind: "token", name: "deploy-bot" }, summary: "created API token \"deploy-bot\"",       meta: { scopes: "servers:read, servers:control" } },
    { id: "evt_044", ts: "2026-05-21T09:08:30", actor: { name: "haru",         provider: "discord" }, action: "discord.webhook.update", severity: "info", target: { kind: "integration", name: "#krystal-ops" }, summary: "updated Discord webhook",                meta: { channel: "#krystal-ops" } },
    { id: "evt_043", ts: "2026-05-21T03:14:09", actor: { name: "system",       provider: "system"  }, action: "server.crash",   severity: "danger",  target: { kind: "server", id: "mc", name: "Minecraft Survival" }, serverId: "mc", summary: "Minecraft Survival crashed",             meta: { exit_code: 139, restarted: true } },

    { id: "evt_042", ts: "2026-05-20T23:50:18", actor: { name: "eskild_iron",  provider: "discord" }, action: "backup.restore", severity: "warn",    target: { kind: "backup", name: "Skogheim-clean-base.bak" }, serverId: "valheim", summary: "restored MyValheimServer from Skogheim-clean-base.bak", meta: { server: "MyValheimServer" } },
    { id: "evt_041", ts: "2026-05-20T19:30:00", actor: { name: "system",       provider: "system"  }, action: "backup.create",  severity: "success", target: { kind: "backup", id: "Skogheim-2026-05-20-1930.bak", name: "Skogheim-2026-05-20-1930.bak" }, serverId: "valheim", summary: "ran auto-backup on MyValheimServer",     meta: { size: "31.8 MB", source: "cron" } },
    { id: "evt_040", ts: "2026-05-20T15:22:48", actor: { name: "haru",         provider: "discord" }, action: "server.rename",  severity: "info",    target: { kind: "server", id: "ark", name: "Dino Survival #2" }, serverId: "ark", summary: "renamed ARK server to \"Dino Survival #2\"", meta: { from: "ark-main", to: "Dino Survival #2" } },
    { id: "evt_039", ts: "2026-05-20T12:00:14", actor: { name: "haru",         provider: "discord" }, action: "auth.login",     severity: "info",    summary: "signed in via Discord",                  meta: { ip: "81.4.10.22", device: "MacBook · Safari" } },

    { id: "evt_038", ts: "2026-05-19T22:18:55", actor: { name: "eskild_iron",  provider: "discord" }, action: "auth.login",     severity: "info",    summary: "signed in via Discord",                  meta: { ip: "92.81.4.19", device: "iPhone · PWA" } },
    { id: "evt_037", ts: "2026-05-19T14:02:30", actor: { name: "haru",         provider: "discord" }, action: "player.allow.add", severity: "info", target: { kind: "player", name: "trusted_alt" }, serverId: "valheim", summary: "added trusted_alt to allowlist",      meta: {} },
    { id: "evt_036", ts: "2026-05-19T11:48:11", actor: { name: "haru",         provider: "discord" }, action: "file.upload",    severity: "info",    target: { kind: "file", name: "mods/BetterTorches.dll" }, serverId: "valheim", summary: "uploaded BetterTorches.dll",        meta: { size: "84 KB" } },
    { id: "evt_035", ts: "2026-05-18T17:05:02", actor: { name: "haru",         provider: "discord" }, action: "backup.delete",  severity: "danger",  target: { kind: "backup", name: "Skogheim-2026-05-10-0130.bak" }, serverId: "valheim", summary: "deleted backup Skogheim-2026-05-10-0130.bak", meta: { source: "manual" } },
  ],

  // ---- Hosts (machines running Krystal) -----------------------
  // Diagnostics surfaces this. Multi-host from day one — the UI auto-picks
  // when there's only one host configured.
  hosts: [
    {
      id: "primary",
      name: "Primary",
      hostname: "krystal-1.tks.example",
      region: "fra1",
      online: true,
      // Per-host role resolved by THIS host's Discord bot. Authorization is
      // local to each host (§6·a) — your tier can differ from host to host.
      tier: "admin",
      boot_time: "2026-05-15T03:30:11",
      kernel: "Linux 6.6.30-amd64",
      os: "Debian 12 (bookworm)",
      panel_version: "0.14.2",
      // ---- Optional backend capabilities this host exposes -----------------
      // Declared when the host is added; each one's runtime `status` is reported
      // independently so a capability can fail without the host going offline.
      // The UI reads window.hostCapability(host, id) and degrades per-capability.
      // Primary exposes all three and they're all healthy.
      capabilities: {
        // last_sample_at — wall-clock of the most recent metrics sample the
        // agent delivered. The backend reports it directly; the demo derives it
        // at load from `sample_age_s` (see the freshness pass at the bottom of
        // this file) so the relative age stays realistic whenever the demo runs.
        metrics:   { provisioned: true, status: "operational", since: "2026-05-15T03:30:42", sample_age_s: 3, info: { interval_s: 5, transport: "sse" } },
        assistant: { provisioned: true, status: "operational", since: "2026-05-15T03:31:00", info: { model: "gemma3", tools: true, context: "host" } },
        watchdog:  { provisioned: true, status: "operational", since: "2026-05-15T03:30:43", info: { policy: "restart-on-crash", grace_s: 30, checks: ["liveness", "players"] } },
      },
      cpu: {
        model: "AMD Ryzen 9 7950X",
        cores: 16, threads: 32, freq_ghz: 4.5,
        usage_pct: 42,
        per_core: [38, 64, 22, 18, 71, 12, 9, 84, 31, 45, 19, 22, 8, 14, 41, 27],
        load_avg: [2.4, 3.1, 2.8],
        temp_c: 64,
      },
      ram: {
        total_gb: 64, used_gb: 38.2, cached_gb: 12.4, buffers_gb: 1.8, free_gb: 11.6,
        swap_total_gb: 8, swap_used_gb: 0.4,
      },
      disks: [
        { mount: "/",        device: "nvme0n1p1", total_gb: 500,  used_gb: 142,  fs: "ext4", smart: "ok"   },
        { mount: "/data",    device: "nvme1n1p1", total_gb: 2000, used_gb: 1340, fs: "ext4", smart: "ok"   },
        { mount: "/backups", device: "sda1",      total_gb: 4000, used_gb: 3760, fs: "ext4", smart: "warn" },
      ],
      network: {
        interfaces: [
          { name: "eth0", ip: "10.0.0.5",   mac: "ba:2f:08:c0:14:9a", rx_kbps: 1240, tx_kbps: 2840, rx_pps: 1834, tx_pps: 2103, errors: 0 },
          { name: "wg0",  ip: "10.42.0.1",  mac: "—",                 rx_kbps:   84, tx_kbps:  204, rx_pps:  120, tx_pps:  140, errors: 0 },
        ],
        open_ports: [
          { port: 2456,  proto: "udp", server: "valheim",  app: "valheim_server" },
          { port: 2457,  proto: "udp", server: "valheim",  app: "valheim_server" },
          { port: 7777,  proto: "udp", server: "ark",      app: "ark_server"     },
          { port: 25565, proto: "tcp", server: "mc",       app: "java"           },
          { port: 8211,  proto: "udp", server: "pal",      app: "palserver"      },
          { port: 443,   proto: "tcp", server: null,       app: "caddy"          },
          { port: 22,    proto: "tcp", server: null,       app: "sshd"           },
        ],
      },
      sensors: [
        { name: "CPU",        value_c: 64, max_c: 95 },
        { name: "NVMe0",      value_c: 48, max_c: 70 },
        { name: "NVMe1",      value_c: 51, max_c: 70 },
        { name: "Chassis",    value_c: 38, max_c: 60 },
      ],
      processes: [
        { pid: 8123, name: "valheim_server",  server: "valheim",  cpu_pct: 38, ram_mb: 3276, threads: 24, fds: 412, started: "2026-05-22T08:30:11", state: "running" },
        { pid: 8217, name: "ark_server",      server: "ark",      cpu_pct: 62, ram_mb: 11264, threads: 56, fds: 1842, started: "2026-05-22T05:14:33", state: "running" },
        { pid: 8412, name: "java",            server: "mc",       cpu_pct: 12, ram_mb: 410, threads: 18, fds: 88, started: "2026-05-22T08:14:00", state: "running" },
        { pid: 1042, name: "krystal-panel",   server: null,       cpu_pct: 4,  ram_mb: 184,  threads: 12, fds: 64,  started: "2026-05-15T03:30:42", state: "running" },
        { pid: 1043, name: "krystal-watchdog",server: null,       cpu_pct: 1,  ram_mb: 38,   threads: 4,  fds: 22,  started: "2026-05-15T03:30:43", state: "running" },
        { pid: 924,  name: "caddy",           server: null,       cpu_pct: 2,  ram_mb: 96,   threads: 8,  fds: 124, started: "2026-05-15T03:31:02", state: "running" },
        { pid: 778,  name: "systemd-resolved",server: null,       cpu_pct: 0,  ram_mb: 14,   threads: 4,  fds: 22,  started: "2026-05-15T03:30:11", state: "running" },
        { pid: 712,  name: "sshd",            server: null,       cpu_pct: 0,  ram_mb: 8,    threads: 1,  fds: 12,  started: "2026-05-15T03:30:11", state: "running" },
        { pid: 9914, name: "palserver-zombie",server: "pal",      cpu_pct: 0,  ram_mb: 1024, threads: 1,  fds: 4,   started: "2026-05-21T20:02:11", state: "zombie" },
      ],
      events: [
        { ts: "2026-05-22T09:14:09", severity: "warn",    icon: "thermometer",    text: "/backups disk usage crossed 85% threshold" },
        { ts: "2026-05-22T03:14:22", severity: "info",    icon: "rotate-cw",      text: "systemd-resolved restarted" },
        { ts: "2026-05-21T19:02:00", severity: "danger",  icon: "alert-triangle", text: "palserver process became zombie (PID 9914)" },
        { ts: "2026-05-20T01:01:00", severity: "info",    icon: "package",        text: "unattended-upgrades installed 4 security updates" },
        { ts: "2026-05-19T00:00:00", severity: "info",    icon: "shield",         text: "TLS certificate auto-renewed (krystal-1.tks.example)" },
        { ts: "2026-05-15T03:30:11", severity: "success", icon: "power",          text: "Host booted — kernel Linux 6.6.30-amd64" },
      ],
      // One aggregated host-log stream, each line tagged with its `source`.
      // `at` is the aggregator's normalized ingest time (used for ordering);
      // `text` stays in each source's own format. `level` is optional/best-
      // effort — many sources won't carry one.
      logs: [
        // Backend API — REST / WS / SSE
        { at: "2026-05-21T10:32:14", source: "api", text: "POST /api/v1/servers/valheim/start (haru) → 200 in 84ms" },
        { at: "2026-05-21T10:31:58", source: "api", text: "WS connect: haru (s_8f2a) · subscribed servers, console, audit" },
        { at: "2026-05-21T09:45:32", source: "api", text: "POST /api/v1/games/palworld/install (haru) → 202 accepted" },
        { at: "2026-05-21T09:12:03", source: "api", text: "SSE /events stream opened (audit, servers) · 1 client" },
        { at: "2026-05-21T08:50:41", source: "api", text: "GET /api/v1/hosts/primary/metrics → 200 (cache miss, 12ms)" },
        { at: "2026-05-21T06:18:56", source: "api", text: "POST /api/v1/auth/refresh (eskild_iron) → 200" },
        // Assistant
        { at: "2026-05-21T10:05:41", source: "assistant", text: "action confirmed by haru → dispatch server.restart(mc)" },
        { at: "2026-05-21T10:05:10", source: "assistant", text: "tool restart_server(mc) proposed — awaiting confirmation" },
        { at: "2026-05-21T09:20:00", source: "assistant", text: "context: summarized 142 audit events for /chat session" },
        { at: "2026-05-21T08:14:33", source: "assistant", text: "tool open_ports(valheim) executed — opened 2456-2458/udp" },
        // Watchdog
        { at: "2026-05-21T09:14:09", source: "watchdog", level: "warn", text: "disk /backups at 87% (threshold 85%)" },
        { at: "2026-05-21T08:14:00", source: "watchdog", level: "warn", text: "mc unresponsive 3× — restart scheduled" },
        { at: "2026-05-21T07:35:11", source: "watchdog", text: "backup.create(valheim) ok — 1.2 GB in 41s" },
        { at: "2026-05-21T03:14:22", source: "watchdog", level: "warn", text: "systemd-resolved refused connection — restarted" },
        // Kernel
        { at: "2026-05-21T03:14:09", source: "kernel", level: "error", text: "java[8412]: segfault at 0 ip 00007f… error 4 (mc) — process killed" },
        { at: "2026-05-21T02:10:04", source: "kernel", level: "warn", text: "thermal_zone0: critical temperature 92°C reached (briefly)" },
        { at: "2026-05-21T00:30:00", source: "kernel", text: "nvme nvme1: I/O queue 3 timeout, completing request" },
        { at: "2026-05-20T18:40:00", source: "kernel", text: "EXT4-fs (nvme1n1p1): mounted filesystem with ordered data mode" },
        // Auth
        { at: "2026-05-21T10:12:48", source: "auth", text: "Accepted publickey for haru from 81.4.10.22 port 51420" },
        { at: "2026-05-21T09:45:21", source: "auth", text: "haru : sudo : COMMAND=/usr/bin/systemctl restart caddy" },
        { at: "2026-05-21T06:18:50", source: "auth", level: "warn", text: "fail2ban: banned 193.32.18.4 for 24h (3 invalid users)" },
        { at: "2026-05-21T06:18:33", source: "auth", level: "warn", text: "Invalid user admin from 193.32.18.4 port 60112" },
      ],
    },
    {
      id: "secondary",
      name: "Secondary",
      hostname: "krystal-2.tks.example",
      region: "syd1",
      online: true,
      tier: "operator",          // lower role here than on Primary — see Settings
      boot_time: "2026-05-20T18:11:04",
      kernel: "Linux 6.6.30-amd64",
      os: "Debian 12 (bookworm)",
      panel_version: "0.14.2",
      // Secondary's metrics exporter has fallen over (provisioned but DOWN — a
      // temporary runtime failure the capacity surfaces degrade around), while
      // its assistant runs a different local model (llama3.1) — so the dock's
      // host picker offers a real choice between Primary and Secondary.
      capabilities: {
        metrics:   { provisioned: true,  status: "down", since: "2026-05-22T10:48:00", sample_age_s: 374, message: "Agent metrics exporter stopped responding — the readout went dark.", info: { interval_s: 5, transport: "sse" } },
        assistant: { provisioned: true,  status: "operational", since: "2026-05-20T18:11:40", info: { model: "llama3.1", tools: true, context: "host" } },
        watchdog:  { provisioned: true,  status: "operational", since: "2026-05-20T18:11:31", info: { policy: "restart-on-crash", grace_s: 30, checks: ["liveness"] } },
      },
      cpu: {
        model: "Intel Xeon E-2386G",
        cores: 6, threads: 12, freq_ghz: 3.5,
        usage_pct: 47,
        per_core: [62, 41, 58, 33, 49, 28, 44, 37, 51, 29, 38, 31],
        load_avg: [3.2, 2.8, 2.6],
        temp_c: 61,
      },
      ram: {
        total_gb: 32, used_gb: 17.8, cached_gb: 7.1, buffers_gb: 0.8, free_gb: 6.3,
        swap_total_gb: 4, swap_used_gb: 0.2,
      },
      disks: [
        { mount: "/",     device: "sda1", total_gb: 250,  used_gb: 64,  fs: "ext4", smart: "ok" },
        { mount: "/data", device: "sdb1", total_gb: 1000, used_gb: 218, fs: "ext4", smart: "ok" },
      ],
      network: {
        interfaces: [
          { name: "eth0", ip: "10.0.1.5", mac: "ba:2f:08:c0:14:9b", rx_kbps: 420, tx_kbps: 880, rx_pps: 612, tx_pps: 814, errors: 0 },
        ],
        open_ports: [
          { port: 28015, proto: "udp", server: "rust", app: "rust_server" },
          { port: 28016, proto: "tcp", server: "rust", app: "rust_rcon"   },
          { port: 443,   proto: "tcp", server: null,   app: "caddy" },
          { port: 22,    proto: "tcp", server: null,   app: "sshd"  },
        ],
      },
      sensors: [
        { name: "CPU",     value_c: 52, max_c: 95 },
        { name: "Chassis", value_c: 36, max_c: 60 },
      ],
      processes: [
        { pid: 5120, name: "RustDedicated",    server: "rust", cpu_pct: 41, ram_mb: 6963, threads: 32, fds: 648, started: "2026-06-09T04:02:18", state: "running" },
        { pid: 1042, name: "krystal-panel",   server: null, cpu_pct: 3, ram_mb: 168, threads: 12, fds: 58, started: "2026-05-20T18:11:30", state: "running" },
        { pid: 1043, name: "krystal-watchdog",server: null, cpu_pct: 1, ram_mb: 36,  threads: 4,  fds: 22, started: "2026-05-20T18:11:31", state: "running" },
        { pid: 924,  name: "caddy",           server: null, cpu_pct: 1, ram_mb: 84,  threads: 8,  fds: 104, started: "2026-05-20T18:11:42", state: "running" },
        { pid: 712,  name: "sshd",            server: null, cpu_pct: 0, ram_mb: 8,   threads: 1,  fds: 12,  started: "2026-05-20T18:11:11", state: "running" },
      ],
      events: [
        { ts: "2026-06-09T04:02:18", severity: "success", icon: "play",    text: "Rusty Shores started — 38 players peak" },
        { ts: "2026-05-20T18:11:42", severity: "info",    icon: "package", text: "krystal-panel 0.14.2 deployed" },
        { ts: "2026-05-20T18:11:04", severity: "success", icon: "power",   text: "Host booted — kernel Linux 6.6.30-amd64" },
      ],
      logs: [
        { at: "2026-05-21T10:30:00", source: "api", text: "GET /api/v1/hosts/secondary/metrics → 200 (cache hit)" },
        { at: "2026-05-21T10:29:40", source: "api", text: "WS connect: haru (s_2b91) · subscribed servers, console" },
        { at: "2026-05-21T08:14:02", source: "watchdog", text: "rust: 38 players connected — healthy" },
        { at: "2026-05-21T04:02:18", source: "watchdog", text: "rust server process online (pid 5120)" },
        { at: "2026-05-21T04:02:10", source: "watchdog", text: "rust: start requested — process booting (pid 5120)" },
        { at: "2026-05-20T18:30:11", source: "auth", text: "Accepted publickey for haru from 81.4.10.22 port 51010" },
        { at: "2026-05-20T18:11:30", source: "kernel", text: "EXT4-fs (sda1): mounted filesystem with ordered data mode" },
      ],
    },
    {
      // A host the crew added but where THIS Discord identity has no granted
      // role. Identity verifies fine (same Discord login); authorization fails
      // at the host's own bot check → every scoped call returns 403. Telemetry
      // is never fetched, so the shape is intentionally empty (valid-but-zero,
      // so nothing crashes) and the UI shows the terminal "no permission"
      // state instead of metrics. This is the per-host 403 base case.
      id: "community",
      name: "Community Box",
      hostname: "community.tks-fans.example",
      region: "iad1",
      online: true,
      tier: "none",
      authDenied: true,
      boot_time: "2026-06-01T09:00:00",
      kernel: "\u2014", os: "\u2014", panel_version: "0.14.2",
      // Access is denied on this host (403 from its own Discord bot check), so we
      // can't probe ANY capability — each reports `unknown` rather than absent.
      capabilities: {
        metrics:   { provisioned: true, status: "unknown", message: "No access on this host." },
        assistant: { provisioned: true, status: "unknown", message: "No access on this host." },
        watchdog:  { provisioned: true, status: "unknown", message: "No access on this host." },
      },
      cpu: { model: "\u2014", cores: 0, threads: 0, freq_ghz: 0, usage_pct: 0, per_core: [], load_avg: [0, 0, 0], temp_c: 0 },
      ram: { total_gb: 0, used_gb: 0, cached_gb: 0, buffers_gb: 0, free_gb: 0, swap_total_gb: 0, swap_used_gb: 0 },
      disks: [], network: { interfaces: [], open_ports: [] }, sensors: [], processes: [],
      events: [], logs: [],
    },
  ],
};

// ---- Metrics freshness (demo modelling, backend-ready) ----
// The real backend stamps each host's metrics capability with an absolute
// `last_sample_at`. The demo can't hard-code an absolute time (the fixture's
// dates are weeks old relative to "now"), so we synthesise it once at load from
// a per-host `sample_age_s` — seconds since the last sample arrived. When the
// API is wired in it already provides `last_sample_at`, so this pass becomes a
// no-op (it never overwrites a value the backend supplied).
(function stampMetricsFreshness() {
  var now = Date.now();
  (KRYSTAL_DATA.hosts || []).forEach(function (h) {
    var m = h.capabilities && h.capabilities.metrics;
    if (!m) return;
    if (m.last_sample_at == null && m.sample_age_s != null) {
      m.last_sample_at = new Date(now - m.sample_age_s * 1000).toISOString();
    }
  });
})();

// ---- Demo heartbeat (simulated metrics stream) ----
// A host whose metrics exporter is `operational` is streaming samples, so its
// `last_sample_at` must keep advancing — otherwise the freshness check would
// (correctly) decide the feed had gone stale after a minute. The real backend
// gets this for free from the live stream; here we fake the heartbeat. Hosts
// whose exporter is down/degraded are deliberately NOT advanced — their dial
// stays frozen at the moment it stopped, which is exactly what we want to show.
// When the API is wired in, delete this block: the stream supplies the stamps.
(function metricsHeartbeat() {
  function tick() {
    var iso = new Date().toISOString();
    (KRYSTAL_DATA.hosts || []).forEach(function (h) {
      var m = h.capabilities && h.capabilities.metrics;
      if (m && m.status === "operational") m.last_sample_at = iso;
    });
  }
  tick();
  setInterval(tick, 4000);
})();

// ---- Demo: cycle Secondary's metrics on/off every 20s ----
// Purely to showcase the instrument power-down → power-up transition (and its
// neon-style warm-up flicker) without waiting for a real outage. Flips the
// metrics capability between `operational` and `down` on a timer via the same
// setHostCapability the backend would call over the socket, so the Fleet card
// and Dashboard react too — not just the diagnostics page. Delete for production.
(function secondaryMetricsCycle() {
  var live = false; // Secondary starts "down" (dark) in the fixture.
  function flip() {
    if (!setHostCapability) return;
    live = !live;
    if (live) {
      setHostCapability("secondary", "metrics", {
        status: "operational", message: null, last_sample_at: new Date().toISOString(),
      });
    } else {
      setHostCapability("secondary", "metrics", {
        status: "down",
        message: "Agent metrics exporter stopped responding — the readout went dark.",
        last_sample_at: new Date().toISOString(),
      });
    }
  }
  setInterval(flip, 20000);
})();

// ---- Demo: cycle Secondary's WATCHDOG independently of metrics ----
// Watchdog is a separate vertical: when it's down the process table and
// lifecycle actions lock, but live performance metrics are unaffected. A
// different period (28s vs the 20s metrics cycle) desyncs them so all four
// up/down combinations appear over time — proving the two are independent.
// Delete for production; the backend reports real status over the socket.
(function secondaryWatchdogCycle() {
  var up = true; // Secondary's watchdog starts operational in the fixture.
  function flip() {
    if (!setHostCapability) return;
    up = !up;
    setHostCapability("secondary", "watchdog", up
      ? { status: "operational", message: null }
      : { status: "down", message: "Watchdog process stopped responding — recovery and lifecycle control are offline." });
  }
  setInterval(flip, 28000);
})();

export { KRYSTAL_DATA, KRYSTAL_LABELS };

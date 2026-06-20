import { detectAnomalies } from "../components/TimeSeriesChart.jsx";
import { KRYSTAL_DATA } from "./data.js";
import { can } from "./persona.js";
import { auditStore, hostsStore, serversStore } from "./stores.js";
import { fmtRelative, parseTs } from "../pages/AuditLogPage.jsx";

// chatTools.js — the assistant's "eyes" into the website.
//
// Given a user message (and the running conversation), this module decides
// what live website data would help answer it, gathers that data from
// KRYSTAL_DATA, and returns:
//   - faded "context pills" to render in the thread ("Reading performance
//     metrics for MyValheimServer…")
//   - a block of plain-text context to inject into the model prompt so the
//     LLM can reason over it, transparently to the user.
//
// In production these would be real function/tool calls the model issues
// (Ollama supports tool-calling); here we use lightweight intent detection
// so the demo works with any Gemma model. The tool DEFINITIONS below are the
// contract a real backend would expose.

  // Read live data from the domain stores (server-authoritative cache), with a
  // fixture fallback so this module loads even before the stores exist. This is
  // how the assistant "sees" the same truth every page shows.
  const getServers = () => (serversStore ? serversStore.getState().list : (getServers() || []));
  const getAudit   = () => (auditStore   ? auditStore.getState().list   : (getAudit() || []));
  const getHosts   = () => (hostsStore   ? hostsStore.getState().list   : (getHosts() || []));

  const TOOL_DEFS = [
    {
      name: "get_performance",
      description: "Recent CPU / RAM / tick / network metrics and detected anomalies for a game server. Use when the user reports lag, stutter, high ping, slowness, or crashes.",
      parameters: { server_id: "string", window: "string (e.g. '10m', '1h')" },
    },
    {
      name: "get_audit_log",
      description: "Recent operational events (backups, restarts, updates, crashes, bans) for a game server. Use to explain what the system was doing at a given time.",
      parameters: { server_id: "string", window: "string" },
    },
    {
      name: "get_server_status",
      description: "Current status, player count, version and IP for a game server.",
      parameters: { server_id: "string" },
    },
    {
      name: "get_console",
      description: "Recent game-server console output (startup, errors, player join/leave, crashes). The richest signal for diagnosing crashes and startup failures.",
      parameters: { server_id: "string", lines: "number" },
    },
    {
      name: "get_config",
      description: "The server's config file values (port, password, PvP, difficulty, max players, whitelist, etc). Use to answer config questions and 'why can't my friend join'.",
      parameters: { server_id: "string" },
    },
    {
      name: "get_host_diagnostics",
      description: "Health of the physical host running this server: CPU/RAM/disk, swap, temperature, and other servers competing for resources on the same machine.",
      parameters: { server_id: "string" },
    },
  ];

  // ---- server resolution ----
  // Resolve a free-text mention to ONE server. The naïve approach — "return the
  // first server whose name shares any word" — misfires the moment two names
  // overlap: "…on Minecraft Survival…" latched onto "Dino Survival" purely
  // because both contain the generic word "survival", and which one won came
  // down to list order. Players name servers anything, so we can't hardcode our
  // way out. Instead we SCORE every server and require a clear winner:
  //   • the full display name appearing as a phrase is the strongest signal;
  //   • explicit identifiers (short id, game, curated alias) are strong;
  //   • each name word counts in proportion to how DISTINCTIVE it is — a word
  //     shared across several names, or a generic mode word like "survival" /
  //     "world", barely moves the needle; a word unique to one name counts fully.
  // A match only sticks if the leader clears a floor AND beats the runner-up by
  // a margin. An ambiguous mention keeps the conversation's current server
  // rather than flipping focus to an arbitrary one.
  const ALIASES = { mc: ["minecraft"], pal: ["palworld"], ark: ["ark"], valheim: ["valheim"] };
  // Mode / boilerplate words that recur across unrelated server names and so
  // carry almost no identifying power on their own, however many servers use them.
  const GENERIC_NAME_WORDS = new Set([
    "server", "servers", "survival", "creative", "hardcore", "world", "realm",
    "community", "main", "primary", "secondary", "backup", "test", "public",
    "private", "official", "modded", "vanilla", "smp", "pve", "pvp", "coop",
    "the", "new", "old",
  ]);

  function nameWords(s) {
    return (s.name || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  }

  function resolveServer(text, lastServerId) {
    const servers = (KRYSTAL_DATA && getServers()) || [];
    const keepContext = () => (lastServerId ? servers.find(s => s.id === lastServerId) || null : null);
    if (!servers.length) return keepContext();
    const low = " " + text.toLowerCase() + " ";
    // Word-boundary test so "ark" doesn't match "dark" and "mc" doesn't match
    // "mcserver". Escapes regex metacharacters in the token.
    const mentions = (tok) =>
      !!tok && new RegExp("[^a-z0-9]" + String(tok).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^a-z0-9]").test(low);

    // Document frequency: how many server NAMES each word shows up in. A word in
    // one name is a good identifier; one shared by many is nearly useless.
    const df = {};
    for (const s of servers) for (const w of new Set(nameWords(s))) df[w] = (df[w] || 0) + 1;

    const score = (s) => {
      let pts = 0;
      const nameLow = (s.name || "").toLowerCase().trim();
      if (nameLow.length >= 3 && mentions(nameLow)) pts += 100;           // whole name, as a phrase
      if (mentions(s.id)) pts += 50;                                       // explicit short id
      if (s.game && mentions(s.game.toLowerCase())) pts += 40;            // game name
      for (const a of (ALIASES[s.id] || [])) if (mentions(a)) pts += 40;  // curated aliases
      for (const w of new Set(nameWords(s))) {
        if (!mentions(w)) continue;
        let wt = 12 / (df[w] || 1);                          // distinctive ⇒ ~12, shared-by-N ⇒ 12/N
        if (GENERIC_NAME_WORDS.has(w)) wt = Math.min(wt, 2); // generic words can't carry a match
        pts += wt;
      }
      return pts;
    };

    let best = null, bestScore = 0, secondScore = 0;
    for (const s of servers) {
      const pts = score(s);
      if (pts > bestScore) { secondScore = bestScore; bestScore = pts; best = s; }
      else if (pts > secondScore) { secondScore = pts; }
    }

    // Need a genuine signal (floor) AND a clear lead over the runner-up — else
    // the mention is ambiguous (only a shared/generic word matched, or two
    // servers tie) and we must NOT yank focus away from the current one.
    if (best && bestScore >= 8 && (bestScore - secondScore) >= 6) return best;
    return keepContext();
  }

  // ---- summaries ----
  function summarizePerformance(server) {
    const metrics = (KRYSTAL_DATA.metricsByServer || {})[server.id];
    if (!metrics) {
      return {
        contextText: `[performance: ${server.name}] No recent metrics — server is ${server.status}.`,
        hadAnomaly: false,
      };
    }
    const N = metrics.length;
    const cpu = metrics.map(m => m.cpu);
    const ram = metrics.map(m => m.ram_pct);
    const tick = metrics.map(m => m.tick_ms);
    const netOut = metrics.map(m => m.net_out_kbps);
    const last = metrics[N - 1];

    const defs = [
      { key: "CPU", unit: "%", vals: cpu },
      { key: "RAM", unit: "%", vals: ram },
      { key: "tick", unit: "ms", vals: tick },
      { key: "network-out", unit: "kbps", vals: netOut },
    ];
    const detect = detectAnomalies || (() => []);
    let lines = [`[performance: ${server.name} (${server.id})] status ${server.status}, ${server.players.current}/${server.players.max} players.`];
    lines.push(`now: CPU ${last.cpu.toFixed(0)}%, RAM ${last.ram_pct.toFixed(0)}%, tick ${last.tick_ms.toFixed(1)}ms.`);
    let hadAnomaly = false;
    for (const d of defs) {
      const anoms = detect(d.vals);
      if (anoms.length) {
        hadAnomaly = true;
        const a = anoms.sort((x, y) => y.peakIdx - x.peakIdx)[0];
        const minsAgo = Math.max(1, Math.round((N - 1 - a.peakIdx) * 1.25));
        const ratio = (a.peakValue / a.mean).toFixed(1);
        lines.push(`ANOMALY: ${d.key} spiked to ${a.peakValue.toFixed(0)}${d.unit} (~${ratio}× normal) about ${minsAgo} min ago.`);
      }
    }
    if (!hadAnomaly) lines.push("No anomalies — metrics within normal range for this window.");
    return { contextText: lines.join("\n"), hadAnomaly };
  }

  function summarizeAudit(server) {
    const all = (getAudit() || []).filter(
      e => e.serverId === server.id || e.target?.id === server.id
    ).slice(0, 6);
    if (!all.length) return { contextText: `[audit: ${server.name}] No recent events.` };
    const now = parseTs ? parseTs((getAudit()[0] || {}).ts || new Date().toISOString()) : new Date();
    const rel = fmtRelative || (() => "recently");
    const lines = [`[audit: ${server.name} (${server.id})] recent events:`];
    for (const e of all) {
      const when = parseTs ? rel(parseTs(e.ts), now) : "";
      const extra = e.meta && e.meta.size ? ` (${e.meta.size})` : "";
      lines.push(`- ${when}: ${e.actor.name} ${e.summary} [${e.action}]${extra}`);
    }
    return { contextText: lines.join("\n") };
  }

  function summarizeStatus(server) {
    return {
      contextText: `[status: ${server.name}] ${server.status}, ${server.players.current}/${server.players.max} players, v${server.version}, ${server.ip}.`,
    };
  }

  // ---- console logs: the richest crash/error signal ----
  function summarizeConsole(server) {
    const log = server.log || [];
    if (!log.length) return { contextText: `[console: ${server.name}] No recent output.` };
    const lines = [`[console: ${server.name} (${server.id})] last ${Math.min(log.length, 8)} lines:`];
    for (const l of log.slice(-8)) {
      // strip the §…§ highlight markers used by the console UI
      const text = (l.text || "").replace(/§/g, "");
      const tag = l.tag ? `[${l.tag}] ` : "";
      lines.push(`  ${l.ts}  ${tag}${text}`);
    }
    // surface any error/warn lines explicitly so the model can't miss them
    const flagged = log.filter(l => l.tag === "warn" || l.tag === "error" || /error|exception|fail|crash|segfault|unsupported/i.test(l.text || ""));
    if (flagged.length) {
      lines.push(`note: ${flagged.length} warning/error line(s) present.`);
    }
    return { contextText: lines.join("\n") };
  }

  // ---- config: answers "is PvP on?", "what port?", "why can't my friend join?" ----
  function summarizeConfig(server) {
    const cfg = server.config;
    if (!cfg) return { contextText: `[config: ${server.name}] No config on file.` };
    const file = cfg.file || "config";
    const pairs = Object.entries(cfg)
      .filter(([k]) => k !== "file")
      .map(([k, v]) => `  ${k} = ${v}`);
    return {
      contextText: [`[config: ${server.name} (${file})]:`, ...pairs].join("\n"),
      file,
    };
  }

  // ---- network: ports required (from config) vs open (from host), traffic ----
  // A connection problem is usually one of: required port not open, or traffic
  // anomaly. We cross-reference the server's config-declared ports against the
  // host's open-ports list so the assistant can say "port X is closed" with
  // confidence, or rule ports out and look elsewhere.
  //
  // Required ports = config.port (+ query if present) + per-game extras
  // (e.g. Valheim needs the two ports above its game port). This mirrors how
  // a real backend would expose `server.required_ports`.
  const GAME_EXTRA_PORTS = {
    valheim: (p) => [p, p + 1, p + 2],   // 2456–2458 UDP
    ark:     (p) => [p, 27015],          // game + query
    rust:    (p) => [p, p + 1],
  };
  function requiredPorts(server) {
    const cfg = server.config || {};
    const base = typeof cfg.port === "number" ? cfg.port : null;
    let ports = [];
    if (base != null) {
      const extra = GAME_EXTRA_PORTS[server.id];
      ports = extra ? extra(base) : [base];
    }
    if (typeof cfg.query === "number") ports.push(cfg.query);
    // de-dupe, keep order
    return [...new Set(ports)];
  }
  function networkFacts(server) {
    const hosts = getHosts() || [];
    const host = hosts.find(h => h.id === server.hostId) || hosts[0];
    const required = requiredPorts(server);
    const openList = host ? (host.network.open_ports || []) : [];
    const openForServer = new Set(openList.filter(p => p.server === server.id).map(p => p.port));
    const proto = openList.find(p => p.server === server.id)?.proto || "udp";
    const rows = required.map(port => ({ port, proto, open: openForServer.has(port) }));
    const closed = rows.filter(r => !r.open);
    const iface = host && host.network.interfaces[0] ? host.network.interfaces[0] : null;
    return { host, rows, closed, iface, proto };
  }

  function summarizeNetwork(server) {
    const { host, rows, closed, iface } = networkFacts(server);
    if (!host || rows.length === 0) return { contextText: `[network: ${server.name}] No port/network data on file.` };
    const portLines = rows.map(r => `  ${r.port}/${r.proto}: ${r.open ? "OPEN" : "CLOSED"}`);
    const trafficLine = iface
      ? `  iface ${iface.name}: ↓${iface.rx_kbps}kbps ↑${iface.tx_kbps}kbps, ${iface.errors} errors`
      : "  (no interface stats)";
    const verdict = closed.length
      ? `  ⇒ ${closed.length} required port(s) CLOSED: ${closed.map(c => c.port).join(", ")} — likely the cause of connection failures.`
      : `  ⇒ all required ports are open; if players still can't connect, check the in-game password/allowlist or the player's own network.`;
    return {
      contextText: [
        `[network: ${server.name}] required vs open ports:`,
        ...portLines, trafficLine, verdict,
      ].join("\n"),
    };
  }

  function buildNetworkEvidence(server) {
    const { host, rows, closed, iface } = networkFacts(server);
    if (!host || rows.length === 0) return null;
    return {
      kind: "network",
      // Ports are directly measured against the host firewall — confirmed when
      // something is closed; when all open the *connection* cause can't be
      // measured (player's own network), so it's only "possible".
      confidence: closed.length ? "confirmed" : "possible",
      serverId: server.id,
      serverName: server.name,
      rows,
      closedCount: closed.length,
      iface: iface ? { name: iface.name, rx: iface.rx_kbps, tx: iface.tx_kbps, errors: iface.errors } : null,
    };
  }

  // ---- host diagnostics: disk-full, swap thrash, noisy-neighbour servers ----
  function summarizeHost(server) {
    const hosts = getHosts() || [];
    const host = hosts.find(h => h.id === server.hostId) || hosts[0];
    if (!host) return { contextText: `[host] No host data.` };
    const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
    const fullest = host.disks.reduce((acc, d) => {
      const pct = (d.used_gb / d.total_gb) * 100;
      return pct > acc.pct ? { d, pct } : acc;
    }, { d: null, pct: 0 });
    const hotTemp = host.sensors.reduce((m, s) => Math.max(m, s.value_c), 0);
    const lines = [
      `[host: ${host.name} (${host.hostname})] running ${server.name}.`,
      `CPU ${host.cpu.usage_pct}% (load ${host.cpu.load_avg.join("/")}, ${host.cpu.cores} cores), RAM ${ramPct}% (swap ${host.ram.swap_used_gb}/${host.ram.swap_total_gb} GB), hottest sensor ${hotTemp}°C.`,
    ];
    if (fullest.d) {
      lines.push(`fullest disk: ${fullest.d.mount} at ${Math.round(fullest.pct)}% (SMART ${fullest.d.smart}).`);
    }
    // Noisy-neighbour detection: other processes hogging the box.
    const heavy = (host.processes || [])
      .filter(p => p.server && p.server !== server.id && (p.cpu_pct > 50 || p.ram_mb > 8000))
      .map(p => `${p.name} (server ${p.server}, ${p.cpu_pct}% CPU, ${(p.ram_mb/1024).toFixed(1)}GB)`);
    if (heavy.length) lines.push(`noisy neighbours on this host: ${heavy.join("; ")}.`);
    const zombies = (host.processes || []).filter(p => p.state && p.state !== "running");
    if (zombies.length) lines.push(`stuck/zombie processes: ${zombies.map(z => z.name + " (PID " + z.pid + ")").join(", ")}.`);
    return { contextText: lines.join("\n") };
  }

  // ---- evidence builders ----
  // These produce structured "evidence cards" the chat UI renders inline
  // beneath the assistant's answer — the actual graph / log lines / config
  // rows behind a diagnostic claim, so the user can verify it rather than
  // take it on faith. Each returns null when there's nothing worth showing,
  // which keeps the thread from sprouting a chart on every message.

  const PERF_METRIC_DEFS = [
    { key: "cpu",     label: "CPU",         unit: "%",    color: "var(--krystal-teal)", yMax: 100, pick: m => m.cpu },
    { key: "ram",     label: "Memory",      unit: "%",    color: "#FBBF24",             yMax: 100, pick: m => m.ram_pct },
    { key: "tick",    label: "Tick time",   unit: "ms",   color: "#FB923C",             yMax: null, pick: m => m.tick_ms },
    { key: "net_out", label: "Network out", unit: " kbps",color: "var(--info)",         yMax: null, pick: m => m.net_out_kbps },
  ];

  // Audit actions that plausibly explain a resource spike, best-first.
  const CAUSAL_ACTIONS = ["backup.create", "server.update", "server.restart", "server.crash", "backup.restore"];

  function findCorrelatedEvent(server) {
    const all = (getAudit() || []).filter(
      e => e.serverId === server.id || e.target?.id === server.id
    );
    for (const action of CAUSAL_ACTIONS) {
      const hit = all.find(e => e.action === action);
      if (hit) return hit;
    }
    return all[0] || null;
  }

  // ---- root-cause chain ----
  // Links independent findings into a causal narrative. Most incidents are a
  // chain: a root condition (disk full / update / setting change) triggers a
  // downstream effect (backup failed / crash / restart) that hits the player.
  // We assemble an ordered chain from the audit timeline + live host/console
  // state so the assistant can point at the CAUSE, not just the symptom.
  //
  // Returns null when there's no multi-step story to tell (single findings are
  // handled by the existing per-source evidence cards). Otherwise:
  //   { kind:"rootcause", serverName, headline, steps:[{icon,tone,label,detail,kind}], rootFix? }
  function buildRootCauseChain(server) {
    if (!server) return null;
    const audit = (getAudit() || []).filter(
      e => e.serverId === server.id || e.target?.id === server.id
    );
    // Anchor on the most significant downstream event: a crash, else a restart
    // or a resource anomaly. No anchor → no chain worth drawing.
    const crash = audit.find(e => e.action === "server.crash");
    const restart = audit.find(e => e.action === "server.restart");
    const detect = detectAnomalies || (() => []);
    const metrics = (KRYSTAL_DATA.metricsByServer || {})[server.id];
    const hasSpike = metrics ? (detect(metrics.map(m => m.cpu)).length || detect(metrics.map(m => m.tick_ms)).length) : 0;

    const anchor = crash || restart || (hasSpike ? { action: "anomaly" } : null);
    if (!anchor) return null;

    const steps = [];
    let rootFix = null;

    // --- Look for an upstream root condition that precedes the anchor. ---
    const hosts = getHosts() || [];
    const host = hosts.find(h => h.id === server.hostId) || hosts[0];
    const fullest = host ? host.disks.reduce((a, d) => {
      const pct = (d.used_gb / d.total_gb) * 100; return pct > a.pct ? { d, pct } : a;
    }, { d: null, pct: 0 }) : { d: null, pct: 0 };
    const diskFull = fullest.d && fullest.pct >= 85;

    const backupEvent = audit.find(e => e.action === "backup.create");
    const updateEvent = audit.find(e => e.action === "server.update");
    const settingEvent = audit.find(e => e.action === "settings.change");

    // Build the chain root → … → effect → impact.
    if (crash) {
      // Root: disk pressure or a bad update is the usual upstream cause.
      if (diskFull) {
        steps.push({ icon: "database", tone: "danger", kind: "host",
          label: `${fullest.d.mount} disk ${Math.round(fullest.pct)}% full`,
          detail: `Low space on ${host.hostname} — backups and writes start failing here.` });
        rootFix = null; // disk cleanup isn't a one-click action (yet)
        if (backupEvent) steps.push({ icon: "database", tone: "warn", kind: "audit",
          label: "Auto-backup ran under pressure", detail: backupEvent.summary });
      } else if (updateEvent) {
        steps.push({ icon: "download", tone: "warn", kind: "audit",
          label: "Update applied", detail: updateEvent.summary });
      }
      // Effect: the crash itself.
      steps.push({ icon: "alert-triangle", tone: "danger", kind: "audit",
        label: "Server crashed", detail: crash.summary + (crash.meta?.exit_code ? ` (exit ${crash.meta.exit_code})` : "") });
      // Impact + remedy.
      const back = server.status === "online";
      steps.push({ icon: back ? "circle-check-big" : "power", tone: back ? "success" : "danger", kind: "impact",
        label: back ? "Auto-restarted — back online" : "Currently offline",
        detail: back ? "The watchdog recovered it; players can reconnect." : "Players can't connect until it's started." });
      if (!back) rootFix = "start";
    } else if (restart) {
      if (settingEvent) steps.push({ icon: "settings", tone: "info", kind: "audit",
        label: "Setting changed", detail: settingEvent.summary });
      steps.push({ icon: "rotate-cw", tone: "update", kind: "audit",
        label: "Server restarted", detail: restart.summary + (restart.meta?.source ? ` (${restart.meta.source})` : "") });
      steps.push({ icon: "users", tone: "warn", kind: "impact",
        label: "Players disconnected briefly", detail: "Expected during a restart — they can rejoin." });
    } else {
      // Anomaly-anchored chain: spike correlated with a backup/update.
      const corr = backupEvent || updateEvent;
      if (!corr) return null;
      steps.push({ icon: corr.action === "backup.create" ? "database" : "download", tone: "info", kind: "audit",
        label: corr.action === "backup.create" ? "Auto-backup started" : "Update started", detail: corr.summary });
      steps.push({ icon: "activity", tone: "warn", kind: "perf",
        label: "Resource spike", detail: "CPU/tick climbed while the job ran — the source of the lag." });
      steps.push({ icon: "clock", tone: "info", kind: "impact",
        label: "Transient — clears when the job finishes", detail: "No action needed; it self-resolves." });
    }

    if (steps.length < 2) return null;
    const headline = crash
      ? (diskFull ? "Disk pressure → backup → crash" : "Crash traced to a recent change")
      : restart ? "A setting change triggered a restart" : "Lag traced to a background job";
    return {
      kind: "rootcause", serverId: server.id, serverName: server.name,
      // A causal chain is an inference across sources → "likely".
      confidence: "likely",
      headline, steps,
      rootFix: rootFix && ACTION_REGISTRY.find(a => a.id === rootFix && a.applies(server)) ? rootFix : null,
    };
  }

  function buildPerformanceEvidence(server) {
    const metrics = (KRYSTAL_DATA.metricsByServer || {})[server.id];
    if (!metrics || !metrics.length) return null;
    const detect = detectAnomalies || (() => []);
    const N = metrics.length;

    // Find the metric with the most recent anomaly window.
    let best = null;
    for (const def of PERF_METRIC_DEFS) {
      const vals = metrics.map(def.pick);
      const anoms = detect(vals);
      if (!anoms.length) continue;
      const a = anoms.sort((x, y) => y.peakIdx - x.peakIdx)[0];
      if (!best || a.peakIdx > best.anomaly.peakIdx) {
        best = { def, vals, anomaly: a };
      }
    }
    if (!best) return null;

    const { def, vals, anomaly } = best;
    const minsAgo = Math.max(1, Math.round((N - 1 - anomaly.peakIdx) * 1.25));
    const ratio = (anomaly.peakValue / anomaly.mean).toFixed(1);
    const correlated = findCorrelatedEvent(server);

    return {
      kind: "performance",
      // The spike is measured, but attributing it to the correlated event is
      // an inference → "likely".
      confidence: correlated ? "likely" : "confirmed",
      serverId: server.id,
      serverName: server.name,
      metric: { key: def.key, label: def.label, unit: def.unit, color: def.color },
      values: vals,
      yMax: def.yMax,
      anomaly: { start: anomaly.start, end: anomaly.end, peakIdx: anomaly.peakIdx, peakValue: anomaly.peakValue, mean: anomaly.mean },
      caption: `${def.label} spiked to ${anomaly.peakValue.toFixed(0)}${def.unit} · ${ratio}× normal · ~${minsAgo} min ago`,
      correlated: correlated ? { action: correlated.action, summary: correlated.summary, actor: correlated.actor.name, ts: correlated.ts } : null,
    };
  }

  function buildConsoleEvidence(server) {
    const log = server.log || [];
    const flagged = log.filter(l =>
      l.tag === "warn" || l.tag === "error" ||
      /error|exception|fail|crash|segfault|unsupported|timeout/i.test(l.text || "")
    );
    if (!flagged.length) return null;
    return {
      kind: "console",
      confidence: "confirmed",   // the log lines exist verbatim
      serverId: server.id,
      serverName: server.name,
      lines: flagged.slice(-4).map(l => ({
        ts: l.ts,
        tag: l.tag || (/error|exception|segfault|crash/i.test(l.text) ? "error" : "warn"),
        text: (l.text || "").replace(/§/g, ""),
      })),
    };
  }

  function buildConfigEvidence(server, highlightKeys) {
    const cfg = server.config;
    if (!cfg) return null;
    const file = cfg.file || "config";
    const entries = Object.entries(cfg).filter(([k]) => k !== "file");
    if (!entries.length) return null;
    const hi = new Set(highlightKeys || []);
    // Show highlighted rows first, then fill to a small cap.
    const rows = entries
      .map(([key, value]) => ({ key, value: String(value), flagged: hi.has(key) }))
      .sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0))
      .slice(0, hi.size ? Math.max(hi.size, 4) : 5);
    return { kind: "config", confidence: "confirmed", serverId: server.id, serverName: server.name, file, rows };
  }

  function buildHostEvidence(server) {
    const hosts = getHosts() || [];
    const host = hosts.find(h => h.id === server.hostId) || hosts[0];
    if (!host) return null;
    const problems = [];
    const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
    const fullest = host.disks.reduce((acc, d) => {
      const pct = (d.used_gb / d.total_gb) * 100;
      return pct > acc.pct ? { d, pct } : acc;
    }, { d: null, pct: 0 });
    if (fullest.d && fullest.pct >= 80) problems.push({ icon: "database", tone: fullest.pct >= 90 ? "danger" : "warn", text: `${fullest.d.mount} disk ${Math.round(fullest.pct)}% full (SMART ${fullest.d.smart})` });
    if (host.ram.swap_used_gb / host.ram.swap_total_gb > 0.3) problems.push({ icon: "hard-drive", tone: "warn", text: `swap in use: ${host.ram.swap_used_gb}/${host.ram.swap_total_gb} GB — memory pressure` });
    const heavy = (host.processes || []).filter(p => p.server && p.server !== server.id && (p.cpu_pct > 50 || p.ram_mb > 8000));
    heavy.forEach(p => problems.push({ icon: "flame", tone: "warn", text: `noisy neighbour: ${p.name} (${p.server}) using ${p.cpu_pct}% CPU, ${(p.ram_mb/1024).toFixed(1)} GB` }));
    const zombies = (host.processes || []).filter(p => p.state && p.state !== "running");
    zombies.forEach(z => problems.push({ icon: "skull", tone: "danger", text: `stuck process: ${z.name} (PID ${z.pid}, ${z.state})` }));
    if (!problems.length) return null;
    return { kind: "host", confidence: "confirmed", hostName: host.name, hostId: host.id, problems };
  }

  // ---- grounded action registry ----
  // The ONLY actions the assistant may propose. Each maps 1:1 to a real verb
  // App.handleAction() understands (start | stop | restart | update). Every
  // entry declares applies(server) so we never surface an action the website
  // can't perform on the server in its current state (e.g. "start" while
  // already online). Nothing here is free-text — if the model's intent doesn't
  // match a registry entry whose guard passes, no button is shown.
  const ACTION_REGISTRY = [
    {
      id: "start",  label: "Start server",   icon: "play",      tone: "success",
      verb: "start",
      applies: (s) => s.status === "offline" || s.status === "crashed",
      // intent the model/user expresses that maps to this action
      re: /\b(start|boot|bring (it )?(up|online)|turn (it )?on|launch|spin (it )?up)\b/i,
      confirm: (s) => `Start ${s.name}?`,
    },
    {
      id: "stop",   label: "Stop server",    icon: "square",    tone: "danger",
      verb: "stop",
      applies: (s) => s.status === "online" || s.status === "updating",
      re: /\b(stop|shut ?down|shut it down|turn (it )?off|kill|halt|take (it )?(down|offline))\b/i,
      confirm: (s) => `Stop ${s.name}? Players currently online (${s.players.current}) will be disconnected.`,
    },
    {
      id: "restart", label: "Restart server", icon: "rotate-cw", tone: "update",
      verb: "restart",
      applies: (s) => s.status === "online",
      re: /\b(restart|reboot|cycle|bounce|reset)\b/i,
      confirm: (s) => `Restart ${s.name}? Players currently online (${s.players.current}) will be disconnected briefly.`,
    },
    {
      id: "update", label: "Check for update", icon: "download", tone: "info",
      verb: "update",
      applies: (s) => s.status === "online" || s.status === "offline",
      re: /\b(update|upgrade|patch|new version|latest)\b/i,
      confirm: (s) => `Check ${s.name} for updates and install if available?`,
    },
    {
      id: "open_ports", label: "Open ports", icon: "network", tone: "info",
      verb: "open_ports",
      // Only offer when the server actually has a required port that's closed.
      applies: (s) => networkFacts(s).closed.length > 0,
      re: /\b(open (the )?ports?|port forward|forward (the )?ports?|firewall|allow (the )?ports?)\b/i,
      confirm: (s) => {
        const c = networkFacts(s).closed.map(p => `${p.port}/${p.proto}`).join(", ");
        return `Open ${c} on the host firewall for ${s.name}?`;
      },
    },
  ];

  // Given the user's message + the resolved server, return the real actions
  // worth offering. Strategy:
  //  - explicit verb in the message → offer that action (if applicable now)
  //  - a diagnosis that implies a fix (e.g. crashed → start, mid-backup lag →
  //    restart) → offer the remedial action
  // Always filtered through applies(server), so the proposal is grounded in
  // what the website can actually do right now.
  function inferActions(text, server, opts = {}) {
    if (!server) return [];
    const low = text.toLowerCase();
    const offered = new Map();

    // 1. Explicit verbs the user typed.
    for (const a of ACTION_REGISTRY) {
      if (a.re.test(low) && a.applies(server)) {
        offered.set(a.id, { ...publicAction(a, server), reason: "you asked" });
      }
    }

    // 2. Remedial suggestions from server state — only when the user is
    //    clearly troubleshooting (asking why / reporting a problem).
    const troubleshooting = opts.troubleshooting;
    if (troubleshooting) {
      if ((server.status === "offline" || server.status === "crashed")) {
        const a = ACTION_REGISTRY.find(x => x.id === "start");
        if (a && a.applies(server) && !offered.has("start")) {
          offered.set("start", { ...publicAction(a, server), reason: server.status === "crashed" ? "it crashed" : "it's offline" });
        }
      }
      // Lag during a backup/update → a restart once it's done is the usual fix.
      if (server.status === "online") {
        const a = ACTION_REGISTRY.find(x => x.id === "restart");
        if (a && a.applies(server) && !offered.has("restart")) {
          offered.set("restart", { ...publicAction(a, server), reason: "clears transient lag", secondary: true });
        }
      }
      // Connection trouble + a closed required port → propose opening it.
      const op = ACTION_REGISTRY.find(x => x.id === "open_ports");
      if (op && op.applies(server) && !offered.has("open_ports")) {
        const closed = networkFacts(server).closed.map(p => p.port).join(", ");
        offered.set("open_ports", { ...publicAction(op, server), reason: `port ${closed} closed` });
      }
    }

    return Array.from(offered.values());
  }

  // Strip internal fields (re/applies/confirm fn) into a UI-safe shape, with
  // the confirm string resolved against the current server.
  function publicAction(a, server) {
    return {
      id: a.id, verb: a.verb, label: a.label, icon: a.icon, tone: a.tone,
      serverId: server.id, serverName: server.name,
      confirm: a.confirm(server),
    };
  }

  // ---- intent detection ----
  const PERF_RE = /\b(lag|laggy|lagging|slow|stutter|fps|ping|freez|spike|spik|performance|perf|cpu|memory|ram|crash|crashing|unplayable|rubber)/i;
  const AUDIT_RE = /\b(backup|restart|reboot|update|updating|crash|ban|kick|who|when|happen|happened|why|going on|wrong|down|offline|restarted)/i;
  const STATUS_RE = /\b(status|online|offline|how many|players|who's on|whos on|up\b|running|ip|address|version)/i;
  const CONSOLE_RE = /\b(log|logs|console|error|errors|exception|stack|trace|startup|booting|loading|stuck|output|spam|warning)/i;
  const CONFIG_RE = /\b(config|cfg|setting|settings|password|port|pvp|pve|difficulty|whitelist|allowlist|slot|slots|max ?players|raid|webhook|gamemode|mod|cross ?play|properties)/i;
  const HOST_RE = /\b(host|machine|box|hardware|disk|storage|space|full|swap|temperature|temp|overheat|thermal|noisy neighbo|other server|out of (space|disk|memory)|zombie)/i;

  // A crash/error question benefits from the console even if not named.
  const CRASH_RE = /\b(crash|crashing|crashed|error|exception|won'?t start|wont start|keeps dying|died|segfault|stuck)/i;
  const JOIN_RE = /\b(can'?t (join|connect)|cant (join|connect)|unable to (join|connect)|connect to|join the|friend.*(join|connect)|whitelist|allowlist|password)/i;
  // Connection / networking troubleshooting → pull port + traffic context.
  const NETWORK_RE = /\b(connect|connection|can'?t (join|connect)|cant (join|connect)|unreachable|time(d)? ?out|timeout|port|firewall|forward|network|nat|refused|ping|packet|ports? (closed|open|blocked)|can't reach|cannot reach)\b/i;

  // Returns { contextText, pills:[{tool,label,detail}], serverId }.
  function inferContext(text, lastServerId) {
    const server = resolveServer(text, lastServerId);
    const wantPerf = PERF_RE.test(text);
    const wantAudit = AUDIT_RE.test(text);
    const wantStatus = STATUS_RE.test(text);
    const wantConsole = CONSOLE_RE.test(text) || CRASH_RE.test(text);
    const wantConfig = CONFIG_RE.test(text) || JOIN_RE.test(text);
    const wantHost = HOST_RE.test(text);
    const wantNetwork = NETWORK_RE.test(text) || JOIN_RE.test(text);
    // Guided full sweep — "health check", "diagnose", "check everything", "what's wrong".
    const wantHealth = /\b(health ?check|diagnos|run a check|check everything|full check|sweep|what'?s wrong with|everything ok|all good|status report)\b/i.test(text);
    // "What changed?" — recent-change timeline. Common for "worked yesterday".
    const wantChanges = /\b(what changed|what'?s changed|anything change|recent change|changed recently|was working|worked (yesterday|before|fine)|used to work|since (yesterday|last)|what did (i|we) change|timeline)\b/i.test(text);

    // Troubleshooting tone → allow remedial action suggestions.
    const troubleshooting = wantPerf || wantConsole || wantNetwork || wantHealth || wantChanges || /\b(why|wrong|broken|help|fix|down|offline|isn'?t|not working)\b/i.test(text);
    const actions = inferActions(text, server, { troubleshooting });

    if (!server || (!wantPerf && !wantAudit && !wantStatus && !wantConsole && !wantConfig && !wantHost && !wantNetwork && !wantHealth && !wantChanges && actions.length === 0)) {
      return { contextText: "", pills: [], serverId: server ? server.id : lastServerId || null, evidence: [], actions: [] };
    }

    const pills = [];
    const ctx = [];
    const evidence = [];
    const add = (summary, tool, label, detail) => {
      ctx.push(summary.contextText);
      pills.push({ tool, label, detail });
    };

    // Root-cause chain leads when a multi-step incident is detectable on a
    // troubleshooting question — it frames the per-source cards that follow.
    if (wantPerf || wantHealth || wantConsole || troubleshooting) {
      const chain = buildRootCauseChain(server);
      if (chain) {
        add({ contextText: `[root-cause: ${server.name}] ${chain.headline}\n` + chain.steps.map(s => `  → ${s.label}: ${s.detail}`).join("\n") },
          "trace_root_cause", `Tracing root cause for ${server.name}`, `${chain.steps.length} linked events`);
        evidence.push(chain);
        if (chain.rootFix) {
          const reg = ACTION_REGISTRY.find(a => a.id === chain.rootFix);
          if (reg && reg.applies(server) && !actions.some(a => a.id === chain.rootFix)) {
            actions.push({ ...publicAction(reg, server), reason: "fixes the root cause" });
          }
        }
      }
    }

    // "What changed?" timeline — leads when the user is chasing a recent change
    // (also useful alongside connection/config troubleshooting).
    if (wantChanges || wantNetwork || wantConfig) {
      const tl = buildChangeTimeline(server, { range: "7d" });
      if (tl) {
        add({ contextText: `[changes: ${server.name}, ${tl.windowLabel}]\n` + tl.changes.map(c => `  ${c.rel}: ${c.label} — ${c.detail} (by ${c.by})`).join("\n") },
          "get_change_timeline", `Checking what changed on ${server.name}`, tl.windowLabel);
        // Only push the card when explicitly asked, to avoid crowding every
        // config/network answer with a full timeline.
        if (wantChanges) evidence.push(tl);
      }
    }

    // Guided health check short-circuits the per-intent gathering: it sweeps
    // everything at once and emits one ranked card. Its fix (if any) is offered
    // as a grounded action.
    if (wantHealth) {
      const hc = runHealthCheck(server);
      add({ contextText: "[health-check: " + server.name + "]\n" + hc.checks.map(c => `  ${c.status.toUpperCase()} ${c.label}: ${c.detail}`).join("\n") },
        "run_health_check", `Running health check on ${server.name}`, `${hc.checks.length} checks`);
      evidence.push({ kind: "health", confidence: "confirmed", ...hc });
      if (hc.fixActionId) {
        const reg = ACTION_REGISTRY.find(a => a.id === hc.fixActionId);
        if (reg && reg.applies(server) && !actions.some(a => a.id === hc.fixActionId)) {
          actions.push({ ...publicAction(reg, server), reason: "from health check" });
        }
      }
      return { contextText: ctx.join("\n\n"), pills, serverId: server.id, evidence, actions };
    }

    // Performance intent pulls metrics + audit (to explain a spike) and the
    // console (crashes often show there first).
    if (wantPerf) {
      add(summarizePerformance(server), "get_performance", `Reading performance metrics for ${server.name}`, "last 10 minutes");
      add(summarizeAudit(server), "get_audit_log", `Reading audit log for ${server.name}`, "recent events");
      const pe = buildPerformanceEvidence(server);
      if (pe) evidence.push(pe);
    } else if (wantAudit) {
      add(summarizeAudit(server), "get_audit_log", `Reading audit log for ${server.name}`, "recent events");
    }

    if (wantConsole) {
      add(summarizeConsole(server), "get_console", `Reading server console for ${server.name}`, "last 8 lines");
      const ce = buildConsoleEvidence(server);
      if (ce) evidence.push(ce);
    }
    if (wantConfig) {
      const c = summarizeConfig(server);
      add(c, "get_config", `Reading ${c.file || "config"} for ${server.name}`, null);
      // Highlight the keys most relevant to a "can't join" question.
      const joinKeys = JOIN_RE.test(text) ? ["password", "allowlist", "whitelist", "max_players", "port", "crossplay"] : [];
      const ce = buildConfigEvidence(server, joinKeys);
      if (ce) evidence.push(ce);
    }
    if (wantHost) {
      add(summarizeHost(server), "get_host_diagnostics", `Checking host machine for ${server.name}`, "cpu · disk · neighbours");
      const he = buildHostEvidence(server);
      if (he) evidence.push(he);
    }
    if (wantNetwork) {
      add(summarizeNetwork(server), "get_network", `Checking network & ports for ${server.name}`, "required vs open");
      const ne = buildNetworkEvidence(server);
      if (ne) evidence.push(ne);
    }
    if (wantStatus && !wantPerf) {
      add(summarizeStatus(server), "get_server_status", `Checking status of ${server.name}`, null);
    }

    return { contextText: ctx.join("\n\n"), pills, serverId: server.id, evidence, actions };
  }

  // ---- proactive briefing ----
  // suggestFollowups: up to 3 grounded next-questions to show as chips beneath
  // the latest answer. Driven by the scoped server's state + the last intent.
  function suggestFollowups(lastUserText, server) {
    const text = (lastUserText || "").toLowerCase();
    const out = [];
    const name = server ? server.name : null;
    const wantPerf = PERF_RE.test(text);
    const wantConsole = CONSOLE_RE.test(text) || CRASH_RE.test(text);
    const wantConfig = CONFIG_RE.test(text) || JOIN_RE.test(text);

    if (server) {
      if (wantPerf) {
        out.push(`Show me last week's pattern for ${name}`);
        out.push(`Is the host under load?`);
      }
      if (wantConsole) out.push(`Summarize the errors in ${name}'s console`);
      if (wantConfig) out.push(`What other settings should I check on ${name}?`);
      // State-aware nudges.
      if (server.status === "offline" || server.status === "crashed") out.push(`What's stopping ${name} from starting?`);
      if (server.status === "online" && !wantPerf) out.push(`How is ${name} performing right now?`);
    } else {
      // No scope yet — broad, useful starters.
      out.push("Which of my servers need attention?");
      out.push("Is any host running low on disk?");
    }
    // De-dupe + cap at 3.
    return [...new Set(out)].slice(0, 3);
  }

  // suggestNavigation: contextual "jump to the relevant screen" chips. Unlike
  // followups (which send a question), these navigate. Each: { label, icon,
  // target: { kind, serverId?, tab? } } — target maps 1:1 to App's router so
  // we never suggest a destination that doesn't exist.
  function suggestNavigation(lastUserText, server) {
    const text = (lastUserText || "").toLowerCase();
    const out = [];
    const sid = server ? server.id : null;
    const name = server ? server.name : null;
    if (server) {
      if (PERF_RE.test(text)) out.push({ label: `Open ${name} metrics`, icon: "line-chart", target: { kind: "server", serverId: sid, tab: "performance" } });
      if (CONSOLE_RE.test(text) || CRASH_RE.test(text)) out.push({ label: `Open ${name} console`, icon: "terminal-square", target: { kind: "server", serverId: sid, tab: "console" } });
      if (CONFIG_RE.test(text) || JOIN_RE.test(text)) out.push({ label: `Open ${name} files`, icon: "folder", target: { kind: "server", serverId: sid, tab: "files" } });
      if (AUDIT_RE.test(text)) out.push({ label: `Open ${name} audit log`, icon: "scroll-text", target: { kind: "audit", serverId: sid } });
    }
    if (NETWORK_RE.test(text) || HOST_RE.test(text)) out.push({ label: "Open host diagnostics", icon: "activity", target: { kind: "fleet" } });
    // De-dupe by label, cap at 3.
    const seen = new Set();
    return out.filter(o => { if (seen.has(o.label)) return false; seen.add(o.label); return true; }).slice(0, 3);
  }

  // ---- proactive briefing scan ----
  // Each item: { id (stable, for dismissal), severity, icon, title, detail,
  // prompt (pre-fills the composer / opens a focused chat), serverId? }.
  // Stable ids let the UI remember dismissals so we never nag.
  function buildBriefing() {
    const D = KRYSTAL_DATA || {};
    const servers = D.servers || [];
    const hosts = D.hosts || [];
    const detect = detectAnomalies || (() => []);
    const items = [];

    // 1. Crashed / offline servers.
    for (const s of servers) {
      if (s.status === "crashed") {
        items.push({ id: "crash:" + s.id, severity: "danger", icon: "alert-triangle",
          title: `${s.name} crashed`, detail: "Offline after an unexpected exit — check the console.",
          prompt: `Why did ${s.name} crash and how do I get it back online?`, serverId: s.id });
      }
    }

    // 2. Updates in progress that may be stuck, and available updates.
    for (const s of servers) {
      if (typeof s.version === "string" && s.version.includes("→")) {
        items.push({ id: "update:" + s.id, severity: "info", icon: "download",
          title: `${s.name} is updating`, detail: `Version change ${s.version}.`,
          prompt: `Is the update for ${s.name} progressing normally?`, serverId: s.id });
      }
    }

    // 3. Resource anomalies on online servers.
    for (const s of servers) {
      if (s.status !== "online") continue;
      const metrics = (D.metricsByServer || {})[s.id];
      if (!metrics) continue;
      const cpu = metrics.map(m => m.cpu);
      const tick = metrics.map(m => m.tick_ms);
      if (detect(cpu).length || detect(tick).length) {
        items.push({ id: "anomaly:" + s.id, severity: "warn", icon: "activity",
          title: `${s.name} had a resource spike`, detail: "Recent CPU/tick anomaly — may have caused lag.",
          prompt: `What caused the recent resource spike on ${s.name}?`, serverId: s.id });
      }
    }

    // 4. Host problems: full disks, swap pressure, zombies.
    for (const h of hosts) {
      const fullest = (h.disks || []).reduce((acc, d) => {
        const pct = (d.used_gb / d.total_gb) * 100;
        return pct > acc.pct ? { d, pct } : acc;
      }, { d: null, pct: 0 });
      if (fullest.d && fullest.pct >= 85) {
        items.push({ id: "disk:" + h.id + ":" + fullest.d.mount, severity: fullest.pct >= 90 ? "danger" : "warn", icon: "database",
          title: `${h.name}: ${fullest.d.mount} ${Math.round(fullest.pct)}% full`, detail: `Disk space is running low on ${h.hostname}.`,
          prompt: `${h.name}'s ${fullest.d.mount} disk is almost full — what's using the space and what can I clear?` });
      }
      const zombies = (h.processes || []).filter(p => p.state && p.state !== "running");
      zombies.forEach(z => items.push({ id: "zombie:" + h.id + ":" + z.pid, severity: "warn", icon: "skull",
        title: `Stuck process on ${h.name}`, detail: `${z.name} (PID ${z.pid}) is ${z.state}.`,
        prompt: `There's a stuck ${z.name} process (PID ${z.pid}) on ${h.name} — what should I do?`,
        serverId: z.server || undefined }));
    }

    // Order by severity: danger → warn → info.
    const rank = { danger: 0, warn: 1, info: 2 };
    items.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
    return items;
  }

  // ---- guided health check ----
  // Sweeps every diagnostic source for a server and returns a ranked list of
  // checks so the user doesn't have to know what to ask. Each check:
  // { id, label, status: "pass"|"warn"|"fail"|"skip", detail, fix? }
  // fix is an action id from ACTION_REGISTRY when a one-click remedy applies.
  function runHealthCheck(server) {
    if (!server) return null;
    const checks = [];

    // 1. Power state.
    if (server.status === "online") {
      checks.push({ id: "status", label: "Server online", status: "pass", detail: `Up · ${server.players.current}/${server.players.max} players · v${server.version}` });
    } else if (server.status === "updating") {
      checks.push({ id: "status", label: "Server updating", status: "warn", detail: `Mid-update (${server.version}) — some checks skipped until it's back.` });
    } else {
      checks.push({ id: "status", label: "Server offline", status: "fail", detail: server.status === "crashed" ? "Crashed — not currently running." : "Stopped.", fix: "start" });
    }

    // 2. Ports (only meaningful when it should be reachable).
    const nf = networkFacts(server);
    if (nf.rows.length === 0) {
      checks.push({ id: "ports", label: "Ports", status: "skip", detail: "No port definitions in config." });
    } else if (nf.closed.length) {
      checks.push({ id: "ports", label: "Required ports", status: "fail", detail: `${nf.closed.map(c => c.port + "/" + c.proto).join(", ")} closed on the host firewall.`, fix: "open_ports" });
    } else {
      checks.push({ id: "ports", label: "Required ports", status: "pass", detail: `All ${nf.rows.length} open (${nf.rows.map(r => r.port).join(", ")}).` });
    }

    // 3. Resources (CPU / RAM / tick anomalies).
    const metrics = (KRYSTAL_DATA.metricsByServer || {})[server.id];
    if (!metrics) {
      checks.push({ id: "resources", label: "Resource usage", status: "skip", detail: "No recent metrics." });
    } else {
      const detect = detectAnomalies || (() => []);
      const cpuA = detect(metrics.map(m => m.cpu)).length;
      const tickA = detect(metrics.map(m => m.tick_ms)).length;
      const ramPct = server.ram ? Math.round((server.ram.used / server.ram.max) * 100) : 0;
      if (cpuA || tickA) {
        checks.push({ id: "resources", label: "Resource usage", status: "warn", detail: `Recent ${cpuA ? "CPU" : "tick-time"} spike detected — may cause lag.` });
      } else if (ramPct >= 90) {
        checks.push({ id: "resources", label: "Memory", status: "warn", detail: `RAM at ${ramPct}% of allocation.` });
      } else {
        checks.push({ id: "resources", label: "Resource usage", status: "pass", detail: `CPU ${server.cpu}% · RAM ${ramPct}% · steady.` });
      }
    }

    // 4. Console errors.
    const flagged = (server.log || []).filter(l => l.tag === "warn" || l.tag === "error" || /error|exception|fail|crash|segfault|timeout/i.test(l.text || ""));
    const errs = flagged.filter(l => l.tag === "error" || /error|exception|segfault|crash/i.test(l.text || ""));
    if (errs.length) {
      checks.push({ id: "console", label: "Console", status: "fail", detail: `${errs.length} error line(s) in recent output.` });
    } else if (flagged.length) {
      checks.push({ id: "console", label: "Console", status: "warn", detail: `${flagged.length} warning(s) — non-fatal.` });
    } else {
      checks.push({ id: "console", label: "Console", status: "pass", detail: "No errors in recent output." });
    }

    // 5. Host health (shared infra).
    const he = buildHostEvidence(server);
    if (he && he.problems.length) {
      const worst = he.problems.some(p => p.tone === "danger") ? "fail" : "warn";
      checks.push({ id: "host", label: "Host machine", status: worst, detail: he.problems[0].text + (he.problems.length > 1 ? ` (+${he.problems.length - 1} more)` : "") });
    } else {
      checks.push({ id: "host", label: "Host machine", status: "pass", detail: "Disk, memory and neighbours all nominal." });
    }

    const order = { fail: 0, warn: 1, pass: 2, skip: 3 };
    checks.sort((a, b) => order[a.status] - order[b.status]);
    const fails = checks.filter(c => c.status === "fail").length;
    const warns = checks.filter(c => c.status === "warn").length;
    const passes = checks.filter(c => c.status === "pass").length;
    // The single action worth surfacing: the first failing check that has a fix.
    const fixCheck = checks.find(c => c.fix && (c.status === "fail" || c.status === "warn"));
    return { serverId: server.id, serverName: server.name, checks, fails, warns, passes, fixActionId: fixCheck ? fixCheck.fix : null };
  }

  // ---- post-action verification ----
  // After an action runs and its effect settles, re-check the relevant state
  // so the assistant can confirm it actually worked (or flag that it didn't).
  // `server` is the LIVE post-action server object (passed from App, which
  // owns the state machine). Returns { ok, headline, lines:[{label,detail,status}] }.
  function verifyAction(action, server) {
    if (!server) return { ok: false, headline: "Couldn't read server state to verify.", lines: [] };
    const verb = action.verb;
    if (verb === "open_ports") {
      const nf = networkFacts(server);
      const ok = nf.closed.length === 0;
      return {
        ok,
        headline: ok ? "All required ports are now open." : `${nf.closed.length} port(s) still closed — may be blocked upstream of the host.`,
        lines: nf.rows.map(r => ({ label: `${r.port}/${r.proto}`, detail: r.open ? "open" : "still closed", status: r.open ? "pass" : "fail" })),
      };
    }
    if (verb === "start" || verb === "restart" || verb === "update") {
      const ok = server.status === "online";
      return {
        ok,
        headline: ok
          ? `${server.name} is online — ${server.uptime} uptime.`
          : `${server.name} is ${server.status} — didn't come back as expected. Check the console.`,
        lines: [
          { label: "State", detail: server.status, status: ok ? "pass" : "fail" },
          { label: "Players", detail: `${server.players.current}/${server.players.max}`, status: "pass" },
        ],
      };
    }
    if (verb === "stop") {
      const ok = server.status === "offline";
      return {
        ok,
        headline: ok ? `${server.name} has shut down cleanly.` : `${server.name} is still ${server.status}.`,
        lines: [{ label: "State", detail: server.status, status: ok ? "pass" : "warn" }],
      };
    }
    return { ok: true, headline: "Done.", lines: [] };
  }

  // ---- "what changed?" timeline diff ----
  // A huge share of "it worked yesterday" issues trace to a recent change.
  // This pulls change-type events (config edits, updates, setting changes,
  // restarts, installs, port changes, backup restores) for a server, newest
  // first, so the assistant can point at "crossplay was turned off 2h before
  // your friend couldn't join". Read-only — pure audit query.
  //   { kind:"changes", serverName, windowLabel, changes:[{ts,icon,tone,label,detail,rel}] }
  const CHANGE_ACTIONS = {
    "settings.change":     { icon: "settings",     tone: "info",   label: "Setting changed" },
    "file.edit":           { icon: "file-pen",     tone: "info",   label: "Config edited" },
    "file.upload":         { icon: "upload",       tone: "info",   label: "File uploaded" },
    "server.update":       { icon: "download",     tone: "warn",   label: "Update applied" },
    "server.restart":      { icon: "rotate-cw",    tone: "update", label: "Restarted" },
    "server.install":      { icon: "package-plus", tone: "info",   label: "Installed" },
    "server.rename":       { icon: "pencil",       tone: "info",   label: "Renamed" },
    "backup.restore":      { icon: "rotate-ccw",   tone: "warn",   label: "Backup restored" },
    "network.ports.open":  { icon: "network",      tone: "info",   label: "Ports opened" },
  };
  function buildChangeTimeline(server, opts = {}) {
    if (!server) return null;
    const all = getAudit() || [];
    // "now" anchored to the newest event so demo relative-times stay stable.
    const now = all.length ? parseTs(all[0].ts) : new Date();
    const windowMs = { "24h": 86400e3, "7d": 7*86400e3, "30d": 30*86400e3, "all": Infinity }[opts.range || "7d"];
    const cutoff = new Date(now.getTime() - windowMs);
    const changes = all
      .filter(e => (e.serverId === server.id || e.target?.id === server.id))
      .filter(e => CHANGE_ACTIONS[e.action])
      .filter(e => parseTs(e.ts) >= cutoff)
      .map(e => {
        const m = CHANGE_ACTIONS[e.action];
        // Prefer a precise diff from meta when present (e.g. "weekly → daily").
        const detail = e.meta?.changed || e.meta?.from && e.meta?.to
          ? (e.meta.changed || `${e.meta.from} → ${e.meta.to}`)
          : e.summary;
        return { ts: e.ts, icon: m.icon, tone: m.tone, label: m.label, detail, by: e.actor.name, rel: fmtRelative(parseTs(e.ts), now) };
      });
    if (!changes.length) return null;
    return {
      kind: "changes",
      serverId: server.id,
      serverName: server.name,
      windowLabel: { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days", "all": "all time" }[opts.range || "7d"],
      changes,
    };
  }

  const KrystalChat = { TOOL_DEFS, ACTION_REGISTRY, inferContext, inferActions, resolveServer, buildBriefing, suggestFollowups, suggestNavigation, runHealthCheck, verifyAction, buildRootCauseChain, buildChangeTimeline };

export { KrystalChat };

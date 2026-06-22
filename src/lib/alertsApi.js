import React from "react";
import { api } from "./apiClient.js";
import { LIVE, MOCK } from "./config.js";
import * as merge from "./merge.js";
import { createStore } from "./store.js";

// alertsApi.js — the alerts domain, on the shared store layer.
//
// MODEL A (condition-mirror). An alert is the live representation of a problem
// CONDITION, not a task a human checks off. It fires while the condition is
// true and resolves itself when the condition clears — whether the operator
// fixed it or the server did. There is no manual "complete" or "dismiss": the
// UI never writes here, it only reflects what the server reports. The page
// therefore trends toward empty ("All clear"), and the long-term record of
// what fired lives in the audit log, not in a growing pile of alerts.
//
//   status ∈ "firing" | "resolved"
//     firing    — the condition is true right now and needs attention.
//                 `escalated:true` marks one where auto-recovery tried and gave
//                 up (e.g. a crash-loop); it does NOT auto-resolve and does NOT
//                 fade — self-healing makes the easy stuff invisible and the
//                 hard stuff louder.
//     resolved  — the condition cleared. Shown only briefly (a 24h "recently
//                 resolved" rear-view; see alertBuckets), then it ages off the
//                 board. `resolvedAt` timestamps the clear.
//
//   resolution — how it cleared. Always { by:"system", source, reason } now
//     (the monitor/assistant observed the clear). `actionId` links to the
//     audit-log action the fix corresponds to: the condition-cleared fact lives
//     on the alert, the fix itself lives in the audit log — the two stores meet
//     here without blurring (alerts = present conditions, audit = past actions).
//
//   autoResolves — mock-monitor hint for what it will say when it later
//     confirms the condition is gone; a real backend wouldn't need it on file.
//
//   anchor — the alert's point of origin in the UI (surface + host/server/tab,
//     and a precise `ref`), so contextual surfaces can render it in place.
//     ref grammar:  "disk:<mount>" · "pid:<pid>"
//
// Production swap (architecture.html §7): hydrate from api.get("/alerts?status=
// active") and keep live via api.stream.subscribe(["alerts"], …) — the inbound
// path below is exactly what consumes those pushes.

  // v3: Model A. firing/resolved replace active/completed/dismissed; added
  // escalation, resolvedAt and the audit-link. Bumped so stale feeds re-seed.
  const LS_KEY = "krystal:alerts:feed:v3";

  const MIN = 60000, HOUR = 3600000;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  // Seed is built relative to load time so the demo's "firing" and 24h
  // "recently resolved" sections are both populated on a fresh load.
  function buildSeed() {
    return [
      // ---- Firing: conditions true right now ----------------------------
      { id: "disk:primary:/backups", severity: "danger", icon: "database", source: "host-monitor",
        title: "Primary: /backups 94% full", detail: "Disk space is running low on krystal-1.tks.example.",
        serverId: null, raisedAt: ago(3 * HOUR), status: "firing",
        anchor: { surface: "diagnostics", hostId: "primary", tab: "resources", ref: "disk:/backups" },
        prompt: "Primary's /backups disk is almost full — what's using the space and what can I clear?" },

      { id: "zombie:primary:9914", severity: "warn", icon: "skull", source: "host-monitor",
        title: "Stuck process on Primary", detail: "palserver-zombie (PID 9914) is zombie.",
        serverId: "pal", raisedAt: ago(38 * MIN), status: "firing",
        autoResolves: { source: "host-monitor", reason: "Zombie process reaped — PID 9914 exited." },
        anchor: { surface: "diagnostics", hostId: "primary", tab: "processes", ref: "pid:9914" },
        prompt: "There's a stuck palserver-zombie process (PID 9914) on Primary — what should I do?" },

      // Escalated: auto-recovery exhausted its retries. Stays loud, never fades.
      { id: "crashloop:mc", severity: "danger", icon: "alert-triangle", source: "watchdog",
        title: "Minecraft Survival won't stay up", detail: "Crashed on startup 3× in a row — likely a bad config, not a transient fault.",
        serverId: "mc", raisedAt: ago(11 * MIN), status: "firing", escalated: true, attempts: 3,
        anchor: { surface: "server", serverId: "mc", tab: "overview" },
        prompt: "Minecraft Survival keeps crashing on startup after 3 auto-restarts — what's wrong with the config?" },

      // ---- Recently resolved: the 24h rear-view -------------------------
      // Watchdog self-heal: a transient crash that recovered on its own.
      { id: "crash:mc:earlier", severity: "danger", icon: "alert-triangle", source: "watchdog",
        title: "Minecraft Survival crashed", detail: "Unexpected exit (exit 1).",
        serverId: "mc", raisedAt: ago(2 * HOUR + 4 * MIN), status: "resolved", resolvedAt: ago(2 * HOUR),
        resolution: { by: "system", source: "watchdog", reason: "Auto-restarted; players could reconnect.", actionId: "evt_restart_mc" },
        anchor: { surface: "server", serverId: "mc", tab: "overview" },
        prompt: "Why did Minecraft Survival crash earlier?" },

      // Assistant self-heal: the alert↔audit bridge — the fix is an action in the log.
      { id: "port:rust:28015", severity: "warn", icon: "plug-zap", source: "assistant",
        title: "Rust query port was unreachable", detail: "TCP 28015 stopped answering the server browser.",
        serverId: "rust", raisedAt: ago(5 * HOUR + 9 * MIN), status: "resolved", resolvedAt: ago(5 * HOUR),
        resolution: { by: "system", source: "assistant", reason: "Reopened TCP 28015 — a firewall rule had drifted.", actionId: "evt_open_ports_rust" },
        anchor: { surface: "server", serverId: "rust", tab: "overview" },
        prompt: "What happened with the Rust query port earlier?" },
    ];
  }

  function load() {
    try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r); } catch (e) {}
    return null;
  }
  // Persist the feed (minus transient render-only flags) so the "server" remembers.
  function save(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list.map(({ pending, justResolved, ...a }) => a))); } catch (e) {}
  }

  // Hydrate from the saved feed when present, backfilling `anchor` from the seed
  // by id so older saved feeds still render in-context without losing state.
  function hydrate() {
    const saved = load();
    if (!saved) return buildSeed();
    const byId = Object.fromEntries(buildSeed().map(s => [s.id, s]));
    return saved.map(a => (!a.anchor && byId[a.id] ? { ...a, anchor: byId[a.id].anchor } : a));
  }

  // Live mode: start EMPTY — never seed the demo fixtures (they'd read as real,
  // fabricated alerts). The real GET /alerts + `alerts` stream is a later slice
  // (WIRING.md §8); until then a live panel honestly shows no alerts. Also skip
  // persistence so we don't clobber a saved demo feed with live emptiness.
  // Fixtures only in the MOCK demo. LIVE starts empty (real /alerts hydrates it);
  // OFFLINE starts empty too (no fabricated alerts before a host is connected).
  const store = createStore({ list: MOCK ? hydrate() : [] });
  if (MOCK) store.subscribe(() => save(store.getState().list));
  const alertsStore = store;

  // Live hydrate/backfill (architecture.html §3·j). Pull the current firing
  // conditions + the 24h resolved rear-view and replace the feed wholesale; the
  // `alerts` WS stream then keeps it live via ingest() (raise/resolve/retract).
  // Both queries hit the same /alerts endpoint (so they succeed or fail
  // together) — on failure we leave the feed untouched rather than blank it.
  // Mock mode is driven by buildSeed() + the mock-monitor, so refresh is a
  // no-op there — never clobber the demo feed with a fetch.
  alertsStore.refresh = () => {
    if (!LIVE) return Promise.resolve(store.getState().list);
    // Fan both windows out across every connected host and merge by id (each alert
    // is host-tagged). MOCK / lone seed → a single get, identical to before. On a
    // TOTAL failure (every host unreachable for both queries) leave the feed
    // untouched rather than blanking it (the original all-or-nothing guard).
    const rows = (rs) => rs.filter(r => r.ok).flatMap(r => r.data || []);
    return Promise.all([
      api.fanOut("/alerts?status=firing"),
      api.fanOut("/alerts?status=resolved&since=24h"),
    ]).then(([firingR, resolvedR]) => {
      if (!firingR.some(r => r.ok) && !resolvedR.some(r => r.ok)) return store.getState().list;
      const list = merge.mergeAlerts([rows(firingR), rows(resolvedR)]);
      store.setState({ list });
      return list;
    });
  };

  const setItem = (id, patch) =>
    store.setState(s => ({ list: s.list.map(a => (a.id === id ? { ...a, ...patch } : a)) }));

  const KrystalAlerts = {
    list() { return store.getState().list.map(a => ({ ...a })); },
    subscribe(fn) { return store.subscribe(fn); },

    // Inbound — the ONLY way an alert changes. The server made this change on
    // its own; the UI never writes. Idempotent, so an echo + a stream push of
    // the same change can't double-fire or re-flash. Three kinds:
    //   raise   — a new condition started firing (upsert by id)
    //   resolve — the condition cleared; → "resolved", stamped by:"system",
    //             kept briefly as the 24h rear-view (not erased)
    //   retract — the condition was never actionable and is simply gone; removed
    ingest(event) {
      if (!event || !event.kind) return;
      const list = store.getState().list;

      if (event.kind === "raise") {
        const a = event.alert; if (!a || !a.id) return;
        if (list.some(x => x.id === a.id)) setItem(a.id, { ...a, pending: false });
        else store.setState(s => ({ list: [{ ...a }, ...s.list] }));
        return;
      }

      const cur = list.find(x => x.id === event.id);
      if (!cur) return;

      if (event.kind === "retract") {
        store.setState(s => ({ list: s.list.filter(x => x.id !== event.id) }));
        return;
      }

      if (event.kind === "resolve") {
        // Idempotent guard: already resolved → no-op.
        if (cur.status === "resolved") return;
        const resolution = { by: "system", at: new Date().toISOString(), ...(event.resolution || {}) };
        setItem(event.id, { status: "resolved", resolvedAt: new Date().toISOString(), resolution, escalated: false, pending: false, justResolved: true });
        // Let the "just resolved" highlight play once, then drop the transient.
        setTimeout(() => setItem(event.id, { justResolved: false }), 2800);
      }
    },

    _reset() { store.setState({ list: buildSeed() }); },
  };

  // Be ready to accept server-pushed changes. In production this is the live
  // `alerts` WebSocket channel (architecture.html §7); here the mock backend
  // emits onto it. Either way the UI only ever reflects what the server says.
  api.stream.subscribe(["alerts"], (m) => {
    if (!m || !m.type) return;
    if (m.type === "alert.raise")        KrystalAlerts.ingest({ kind: "raise", alert: m.data });
    else if (m.type === "alert.resolve") KrystalAlerts.ingest({ kind: "resolve", id: m.data.id, resolution: m.data.resolution });
    else if (m.type === "alert.retract") KrystalAlerts.ingest({ kind: "retract", id: m.data.id });
  });

  // Live cold boot: hydrate once from REST on load (mirrors the stores.js cold
  // boot for the other surfaces). Mock mode keeps its synchronous seed above.
  if (LIVE) { try { alertsStore.refresh().catch(() => {}); } catch (e) {} }

export { KrystalAlerts, alertsStore };

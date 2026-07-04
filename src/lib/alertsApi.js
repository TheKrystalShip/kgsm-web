import { api } from "./apiClient.js";
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
//   anchor — the alert's point of origin in the UI (surface + host/server/tab,
//     and a precise `ref`), so contextual surfaces can render it in place.
//     ref grammar:  "disk:<mount>" · "pid:<pid>"
//
// Hydrate from api.get("/alerts?status=…") and keep live via
// api.stream.subscribe(["alerts"], …) — the inbound path below consumes those pushes.

  // The feed starts EMPTY and hydrates from the backend; the UI never writes here.
  const store = createStore({ list: [] });
  const alertsStore = store;

  // Live hydrate/backfill (architecture.html §3·j). Pull the current firing
  // conditions + the 24h resolved rear-view and replace the feed wholesale; the
  // `alerts` WS stream then keeps it live via ingest() (raise/resolve/retract).
  // Fan both windows out across every connected host and merge by id (each alert
  // is host-tagged); a lone connection is just a single get. On a TOTAL failure
  // (every host unreachable for both queries) leave the feed untouched rather
  // than blanking it.
  alertsStore.refresh = () => {
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
  };

  // Accept server-pushed changes over the live `alerts` WebSocket channel
  // (architecture.html §7). The UI only ever reflects what the server says.
  api.stream.subscribe(["alerts"], (m) => {
    if (!m || !m.type) return;
    if (m.type === "alert.raise")        KrystalAlerts.ingest({ kind: "raise", alert: m.data });
    else if (m.type === "alert.resolve") KrystalAlerts.ingest({ kind: "resolve", id: m.data.id, resolution: m.data.resolution });
    else if (m.type === "alert.retract") KrystalAlerts.ingest({ kind: "retract", id: m.data.id });
  });

  // Hydrate once from REST on load (mirrors the stores.js boot hydrate).
  try { alertsStore.refresh().catch(() => {}); } catch {}

export { KrystalAlerts, alertsStore };

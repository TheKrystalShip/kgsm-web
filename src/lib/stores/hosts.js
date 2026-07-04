// stores/hosts.js — Hosts store (diagnostics) + metrics/capabilities subscriptions.

import { api } from "../apiClient.js";
import { reconcileConnectionId } from "../config.js";
import * as merge from "../merge.js";
import { createStore } from "../store.js";

const hostsStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
});

hostsStore.patch = (id, partial) =>
  hostsStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, ...partial } : x)) }));
hostsStore.find = (id) => hostsStore.getState().list.find(x => x.id === id) || null;
hostsStore.add = (host) =>
  hostsStore.setState(s => ({ ...s, list: [...s.list, host] }));
hostsStore.update = (id, partial) => hostsStore.patch(id, partial);
hostsStore.remove = (id) =>
  hostsStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== id) }));

hostsStore.refresh = () => {
  hostsStore.setState(s => ({ ...s, status: "loading", error: null }));
  return api.fanOut("/hosts").then(results => {
    const okr = results.filter(r => r.ok);
    if (results.length && !okr.length) { const err = results[0].err; hostsStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
    okr.forEach(r => { const h = (r.data || [])[0]; if (r.conn && h && h.id) reconcileConnectionId(r.conn.url, h.id); });
    const list = merge.mergeHosts(okr.map(r => r.data));
    hostsStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true }));
    return list;
  });
};

// Host metrics live tick (diagnostics deep-dive only)
hostsStore.mergeMetrics = (id, t) => {
  if (!t) return;
  const at = new Date().toISOString();
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      if (h.id !== id) return h;
      const cap = h.capabilities || {};
      const next = { ...h };
      if (t.cpu) next.cpu = { ...(h.cpu || {}), ...t.cpu };
      if (t.ram) next.ram = t.ram;
      if (t.disks) next.disks = t.disks;
      if (t.sensors) next.sensors = t.sensors;
      if (t.boot_time != null) next.boot_time = t.boot_time;
      if (t.hostname) next.hostname = t.hostname;
      next.network = { ...(h.network || {}), interfaces: t.interfaces || (h.network && h.network.interfaces) || [] };
      next.capabilities = { ...cap, metrics: { ...(cap.metrics || {}), last_sample_at: at } };
      return next;
    }),
  }));
};

hostsStore.clearMetricsStamp = (id) => {
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      const m = h.id === id && h.capabilities && h.capabilities.metrics;
      if (!m || m.last_sample_at == null) return h;
      const { last_sample_at, ...rest } = m;
      return { ...h, capabilities: { ...h.capabilities, metrics: rest } };
    }),
  }));
};

function subscribeHostMetrics(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/metrics";
  const dispose = api.stream.subscribe([topic], (m) => {
    if (m && m.type === "host.metrics" && m.data) hostsStore.mergeMetrics(hostId, m.data);
  });
  return () => { dispose(); hostsStore.clearMetricsStamp(hostId); };
}

// Host capabilities live patch (app-wide, always-on)
hostsStore.mergeCapabilities = (id, caps) => {
  if (!caps || typeof caps !== "object") return;
  hostsStore.setState(s => ({
    ...s,
    list: s.list.map(h => {
      if (h.id !== id) return h;
      const cur = h.capabilities || {};
      const next = { ...cur };
      for (const k of Object.keys(caps)) next[k] = { ...(cur[k] || {}), ...caps[k] };
      return { ...h, capabilities: next };
    }),
  }));
};

const _capSubs = new Map();
function _subscribeHostCapabilities(hostId) {
  const topic = "hosts/" + hostId + "/capabilities";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "capabilities.patch" && m.data) hostsStore.mergeCapabilities(hostId, m.data);
  });
}
function syncCapabilitySubscriptions() {
  const ids = new Set((hostsStore.getState().list || []).map(h => h && h.id).filter(Boolean));
  for (const id of ids) if (!_capSubs.has(id)) _capSubs.set(id, _subscribeHostCapabilities(id));
  for (const [id, dispose] of _capSubs) if (!ids.has(id)) { try { dispose(); } catch {} _capSubs.delete(id); }
}
hostsStore.subscribe(syncCapabilitySubscriptions);

// Per-server metrics live tick (Performance deep-dive only)
function subscribeServerMetrics(serverId, onTick) {
  if (!serverId || typeof onTick !== "function") return () => {};
  const topic = "servers/" + serverId + "/metrics";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "metrics.tick" && m.data) onTick(m.data);
  });
}

// Per-server metrics HISTORY
async function fetchServerMetricsHistory(serverId, range, hostId) {
  if (!serverId || !hostId) return null;
  const r = range || "1h";
  return api.host(hostId).get("/servers/" + serverId + "/metrics/history?range=" + r);
}

// Lifecycle events for ONE server
async function fetchServerEvents(serverId, hostId, sinceIso) {
  if (!serverId) return [];
  if (!hostId) return [];
  const qs = new URLSearchParams({ serverId, limit: "200" });
  if (sinceIso) qs.set("since", sinceIso);
  const page = await api.host(hostId).get("/audit?" + qs.toString());
  return (page && page.rows) || (page && Array.isArray(page.data) ? page.data : null) || (Array.isArray(page) ? page : []) || [];
}

export {
  hostsStore, syncCapabilitySubscriptions,
  subscribeHostMetrics, subscribeServerMetrics,
  fetchServerMetricsHistory, fetchServerEvents,
};

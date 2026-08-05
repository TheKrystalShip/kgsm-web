// stores/diagnostics.js — Host logs, log sources, services, leaf provisioning/config.

import { adaptService, adaptLeafConfigApply } from "../adapters.js";
import { api } from "../apiClient.js";
import { createStore } from "../store.js";

// ---- Host logs ----
const LOGS_WINDOW = 300;
const LOGS_MAX = 2000;
const logsStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
  hostId: null,
});

logsStore.prepend = (hostId, line) =>
  logsStore.setState(s => {
    if (!line || !line.id) return s;
    if (s.hostId && hostId && s.hostId !== hostId) return s;
    if (s.list.length && s.list[0].id === line.id) return s;
    if (s.list.some(e => e.id === line.id)) return s;
    const list = [line, ...s.list];
    return { ...s, list: list.length > LOGS_MAX ? list.slice(0, LOGS_MAX) : list };
  });

let _logsGen = 0;
logsStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = ++_logsGen;
  logsStore.setState(s => ({ ...s, status: "loading", error: null, hostId }));
  return api.host(hostId).get("/hosts/" + hostId + "/logs?limit=" + LOGS_WINDOW).then(page => {
    if (gen !== _logsGen) return [];
    const rows = (page && page.rows) || [];
    logsStore.setState(s => ({ ...s, list: rows, status: "ready", error: null, everLoaded: true, hostId }));
    return rows;
  }, err => {
    if (gen === _logsGen) logsStore.setState(s => ({ ...s, status: "error", error: err, hostId }));
    throw err;
  });
};

function subscribeHostLogs(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/logs";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "log.line" && m.data) logsStore.prepend(hostId, m.data);
  });
}

// ---- One leaf's journal ----
// The per-leaf logs tab reads its OWN window rather than filtering the host-wide one: the merged
// feed is capped across every leaf at once, so a quiet leaf next to a chatty one can hold almost
// none of it — filtering that would show an empty console for a service that has been logging all
// day. Asking journald for the one source spends the whole window on the leaf you opened.
const leafLogsStore = createStore({
  list: [],
  status: "loading",
  error: null,
  hostId: null,
  leaf: null,
});

leafLogsStore.prepend = (hostId, leaf, line) =>
  leafLogsStore.setState(s => {
    if (!line || !line.id) return s;
    if (s.hostId !== hostId || s.leaf !== leaf) return s;
    if (line.source !== leaf) return s;
    if (s.list.some(e => e.id === line.id)) return s;
    const list = [line, ...s.list];
    return { ...s, list: list.length > LOGS_MAX ? list.slice(0, LOGS_MAX) : list };
  });

let _leafLogsGen = 0;
leafLogsStore.refresh = (hostId, leaf) => {
  if (!hostId || !leaf) return Promise.resolve([]);
  const gen = ++_leafLogsGen;
  leafLogsStore.setState(s => ({ ...s, list: [], status: "loading", error: null, hostId, leaf }));
  const path = "/hosts/" + hostId + "/logs?source=" + encodeURIComponent(leaf) + "&limit=" + LOGS_WINDOW;
  return api.host(hostId).get(path).then(page => {
    if (gen !== _leafLogsGen) return [];
    const rows = (page && page.rows) || [];
    leafLogsStore.setState(s => ({ ...s, list: rows, status: "ready", error: null, hostId, leaf }));
    return rows;
  }, err => {
    if (gen === _leafLogsGen) leafLogsStore.setState(s => ({ ...s, status: "error", error: err, hostId, leaf }));
    throw err;
  });
};

// One live topic carries every source, so the frames are narrowed to this leaf on the way in.
function subscribeLeafLogs(hostId, leaf) {
  if (!hostId || !leaf) return () => {};
  const topic = "hosts/" + hostId + "/logs";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "log.line" && m.data) leafLogsStore.prepend(hostId, leaf, m.data);
  });
}

function subscribeHostServices(hostId) {
  if (!hostId) return () => {};
  const topic = "hosts/" + hostId + "/services";
  return api.stream.subscribe([topic], (m) => {
    if (m && m.type === "service.patch" && m.data) servicesStore.applyRow(hostId, m.data);
  });
}

// ---- Host log sources ----
const logSourcesStore = createStore({
  sources: [],
  status: "loading",
  error: null,
  hostId: null,
});
let _logSourcesGen = 0;
logSourcesStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = ++_logSourcesGen;
  logSourcesStore.setState(s => ({ ...s, status: "loading", error: null, hostId }));
  return api.host(hostId).get("/hosts/" + hostId + "/logs/sources").then(sources => {
    if (gen !== _logSourcesGen) return [];
    const list = Array.isArray(sources) ? sources : [];
    logSourcesStore.setState(s => ({ ...s, sources: list, status: "ready", error: null, hostId }));
    return list;
  }, err => {
    if (gen === _logSourcesGen) logSourcesStore.setState(s => ({ ...s, status: "error", error: err, hostId }));
    throw err;
  });
};

// ---- Host services ----
const servicesStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
  hostId: null,
});
let _servicesGen = 0;
servicesStore.refresh = (hostId) => {
  if (!hostId) return Promise.resolve([]);
  const gen = ++_servicesGen;
  servicesStore.setState(s => ({ ...s, status: "loading", error: null, hostId }));
  return api.host(hostId).get("/hosts/" + hostId + "/services").then(rows => {
    if (gen !== _servicesGen) return [];
    const list = Array.isArray(rows) ? rows : [];
    servicesStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true, hostId }));
    return list;
  }, err => {
    if (gen === _servicesGen) servicesStore.setState(s => ({ ...s, status: "error", error: err, hostId }));
    throw err;
  });
};

servicesStore.applyRow = (hostId, row) => {
  if (!row || !row.id) return;
  servicesStore.setState(s => {
    if (s.hostId !== hostId) return s;
    const seen = s.list.some(x => x.id === row.id);
    const list = seen ? s.list.map(x => (x.id === row.id ? { ...x, ...row } : x)) : [...s.list, row];
    return { ...s, list };
  });
};

// ---- Leaf provisioning + config ----
function setLeafProvisioned(hostId, leaf, connected) {
  if (!hostId) return Promise.reject(new Error("setLeafProvisioned: hostId required"));
  const action = connected ? "connect" : "disconnect";
  return api.host(hostId).post("/hosts/" + hostId + "/services/" + leaf + "/" + action).then(raw => {
    const row = adaptService(raw);
    if (row && row.id) servicesStore.applyRow(hostId, row);
    return row;
  });
}

function fetchLeafConfig(hostId, leaf) {
  if (!hostId || !leaf) return Promise.resolve(null);
  return api.host(hostId).get("/hosts/" + hostId + "/services/" + leaf + "/config");
}

// One leaf's resource history, from the monitor's `leaf` entity kind by way of the api's proxy. The
// response is the same shape a server's history has, down to the metric names — they are the same
// quantities in the same units — which is what lets the leaf page render it through the very chart grid
// the Performance tab uses. No adapter: the series map IS the view shape, and inventing a point to fill
// a gap is exactly what the backend refuses to do.
function fetchLeafMetricsHistory(hostId, leaf, range) {
  if (!hostId || !leaf) return Promise.resolve(null);
  const r = range || "1h";
  return api.host(hostId).get("/hosts/" + hostId + "/services/" + leaf + "/metrics/history?range=" + r);
}

function applyLeafConfig(hostId, leaf, body) {
  if (!hostId || !leaf) return Promise.reject(new Error("applyLeafConfig: hostId required"));
  return api.host(hostId).put("/hosts/" + hostId + "/services/" + leaf + "/config", body || {}).then(adaptLeafConfigApply);
}

export {
  logsStore, logSourcesStore, leafLogsStore, servicesStore,
  subscribeHostLogs, subscribeLeafLogs, subscribeHostServices, setLeafProvisioned,
  fetchLeafConfig, applyLeafConfig, fetchLeafMetricsHistory,
};

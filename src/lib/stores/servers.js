// stores/servers.js — Game servers, jobs, command actions, game name resolution.

import { adaptPhantom } from "../adapters.js";
import { api, realtimeStore } from "../apiClient.js";
import * as merge from "../merge.js";
import { createStore } from "../store.js";
import { hostsStore } from "./hosts.js";
import { libraryStore } from "./library.js";

// ---- Game servers -------------------------------------------------------
const serversStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
});

serversStore.patch = (id, partial) =>
  serversStore.setState(s => ({ ...s, list: s.list.map(x => (x.id === id ? { ...x, ...partial } : x)) }));
serversStore.add = (server) =>
  serversStore.setState(s => ({ ...s, list: [...s.list, server] }));
serversStore.find = (id) =>
  serversStore.getState().list.find(x => x.id === id) || null;
serversStore.remove = (id) =>
  serversStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== id) }));

serversStore.addPhantom = (id, { blueprint, cover, hero, displayName, hostId } = {}) => {
  if (serversStore.find(id)) return;
  serversStore.add(adaptPhantom({ id, blueprint, cover, hero, displayName, hostId }));
};

serversStore.refresh = () => {
    serversStore.setState(s => ({ ...s, status: "loading", error: null }));
    return api.fanOut("/servers").then(results => {
      const okr = results.filter(r => r.ok);
      if (results.length && !okr.length) { const err = results[0].err; serversStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
      const list = merge.mergeServers(okr.map(r => r.data));
      serversStore.setState(s => {
        const cur = new Map(s.list.map(x => [x.id, x]));
        const next = list.map(srv => {
          const c = cur.get(srv.id);
          if (!c || c._phantom) return srv;
          return { ...srv, status: c.status, uptime: c.uptime, job: c.job, network: c.network };
        });
        const phantoms = s.list.filter(x => x._phantom && !next.some(r => r.id === x.id));
        return { ...s, list: [...next, ...phantoms], status: "ready", error: null, everLoaded: true };
      });
      resolveGameNames();
      return list;
    });
  };

serversStore.fetchDetail = (id, hostId) => {
  if (!id) return Promise.resolve(null);
  if (!hostId) return Promise.resolve(null);
  return api.host(hostId).get("/servers/" + id).then(be => {
    if (be && serversStore.find(id))
      serversStore.patch(id, { network: be.network || null, cover: be.cover ?? null, hero: be.hero ?? null });
    return be;
  }, () => null);
};

// Keep the store live from the server's `servers` channel
api.stream.subscribe(["servers"], (m) => {
  if (m.type === "server.patch" && m.data && m.data.id) {
    if (serversStore.find(m.data.id)) {
      const { id, ...patch } = m.data;
      const existing = serversStore.find(id);
      if (existing?._phantom && existing?.job?.verb === "uninstall") return;
      serversStore.patch(id, { ...patch, _phantom: false, job: null });
    } else {
      serversStore.add(m.data);
    }
    resolveGameNames();
  } else if (m.type === "server.removed" && m.data && m.data.id) {
    serversStore.setState(s => ({ ...s, list: s.list.filter(x => x.id !== m.data.id) }));
  }
});

// ---- Jobs (command outcomes) --------------------------------------------
const jobsStore = createStore({ byId: {} });
jobsStore.upsert = (job) => {
  if (!job || !job.id) return;
  jobsStore.setState(s => ({ ...s, byId: { ...s.byId, [job.id]: { ...s.byId[job.id], ...job } } }));
};
jobsStore.get = (id) => (id ? jobsStore.getState().byId[id] || null : null);

api.stream.subscribe(["jobs"], (m) => {
  if ((m.type === "job" || m.type === "job.patch") && m.data) {
    jobsStore.upsert(m.data);
    const { serverId, verb, state, phase, blueprint } = m.data;

    if (verb === "install") {
      if (state !== "done" && !serversStore.find(serverId)) {
        const lib = libraryStore.getState().list || [];
        const gameEntry = blueprint ? lib.find(g => g.id === blueprint) : null;
        serversStore.addPhantom(serverId, {
          blueprint,
          cover:       gameEntry?.cover ?? null,
          hero:        gameEntry?.hero  ?? null,
          displayName: gameEntry?.name  ?? blueprint,
          hostId:      hostsStore.getState().list[0]?.id ?? null,
        });
      }
      if (state === "done") {
        if (m.data.error) {
          serversStore.patch(serverId, { status: "install-failed", job: null });
        }
      } else {
        serversStore.patch(serverId, { job: { verb, state, phase: phase ?? null } });
      }
    } else if (verb === "uninstall") {
      if (state === "done") {
        if (m.data.error) {
          serversStore.patch(serverId, { _phantom: false, job: null });
        }
      } else {
        serversStore.patch(serverId, { _phantom: true, job: { verb, state } });
      }
    } else {
      serversStore.patch(serverId, { job: state === "done" ? null : { verb, state } });
    }
  }
});

// ---- Game metadata resolution (servers × library) ----------------------
function resolveGameNames() {
  const lib = libraryStore.getState().list || [];
  if (!lib.length) return;
  const byId = new Map(lib.map(g => [g.id, g]));
  const cur = serversStore.getState().list;
  let changed = false;
  const next = cur.map(srv => {
    const g = srv.blueprint ? byId.get(srv.blueprint) : null;
    if (!g) return srv;
    const name = g.name;
    const cover = g.cover ?? null;
    const hero = g.hero ?? null;
    if ((name && srv.game !== name) || (srv.cover ?? null) !== cover || (srv.hero ?? null) !== hero) {
      changed = true;
      return { ...srv, ...(name ? { game: name } : null), cover, hero };
    }
    return srv;
  });
  if (changed) serversStore.setState(s => ({ ...s, list: next }));
}
libraryStore.subscribe(resolveGameNames);
resolveGameNames();

// ---- Server write actions -----------------------------------------------
function commandServer(server, verb, origin = "ui") {
  if (!server || !server.hostId) return Promise.reject(new Error("commandServer: server.hostId required"));
  return api.host(server.hostId).post("/servers/" + server.id + "/commands", { verb, origin });
}

function sendConsoleInput(server, text, origin = "ui") {
  if (!server || !server.hostId) return Promise.reject(new Error("sendConsoleInput: server.hostId required"));
  return api.host(server.hostId).post("/servers/" + server.id + "/console", { input: text, origin });
}

// ---- Job awaiting -------------------------------------------------------
let _jobPollMs = 3000;
let _jobDeadMs = 30000;
let _jobLiveProbe = null;
function __setJobTiming(opts) {
  if (!opts) { _jobPollMs = 3000; _jobDeadMs = 30000; _jobLiveProbe = null; return; }
  if (opts.pollMs != null) _jobPollMs = opts.pollMs;
  if (opts.deadMs != null) _jobDeadMs = opts.deadMs;
  if ("liveProbe" in opts) _jobLiveProbe = opts.liveProbe;
}
function awaitJob(jobId, hostId) {
  return new Promise((resolve) => {
    if (!jobId) { resolve({ status: "unknown" }); return; }
    let settled = false, poll = null, dispose = null, downTicks = 0;
    const maxDownTicks = Math.max(1, Math.ceil(_jobDeadMs / _jobPollMs));
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (poll) { clearInterval(poll); poll = null; }
      if (dispose) dispose();
      resolve(val);
    };
    const evaluate = () => {
      const j = jobsStore.get(jobId);
      if (j && j.state === "done") finish({ status: j.error ? "failed" : "succeeded", job: j });
    };
    const socketUp = () => {
      try {
        if (_jobLiveProbe) return !!_jobLiveProbe(hostId);
        if (!hostId) return true;
        const rt = realtimeStore.getState();
        if (!rt.online) return false;
        const h = rt.hosts[hostId];
        return h ? h.mode === "live" : true;
      } catch { return true; }
    };
    const tick = () => {
      if (settled) return;
      if (socketUp()) { downTicks = 0; return; }
      if (++downTicks >= maxDownTicks) finish({ status: "unknown" });
    };
    dispose = jobsStore.subscribe(evaluate);
    poll = setInterval(tick, _jobPollMs);
    evaluate();
  });
}

function confirmCommand(server, verb) {
  return commandServer(server, verb, "assistant").then(resp => {
    const job = resp && resp.job;
    if (!job || !job.id) return { status: "sent", jobId: null };
    return awaitJob(job.id, server && server.hostId).then(r => ({ ...r, jobId: job.id }));
  });
}

function installServer(cfg) {
  const hostId = (cfg && cfg.hostId) || (hostsStore.getState().list[0] || {}).id || null;
  if (!hostId) return Promise.reject(new Error("installServer: hostId required"));
  const body = { blueprint: cfg.game.id, name: cfg.name, origin: "ui" };
  const port = Number(cfg.port);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) body.port = port;
  return api.host(hostId).post("/servers", body);
}

// ---- Settings (Phase 0) -------------------------------------------------
function fetchSettings(hostId, serverId) {
  return api.host(hostId).get("/servers/" + serverId + "/settings");
}
function patchSettings(hostId, serverId, patch) {
  return api.host(hostId).patch("/servers/" + serverId + "/settings", patch);
}
function deleteServer(hostId, serverId, origin) {
  const qs = origin ? "?origin=" + encodeURIComponent(origin) : "";
  return api.host(hostId).del("/servers/" + serverId + qs);
}

export {
  __setJobTiming, serversStore, jobsStore, resolveGameNames,
  commandServer, sendConsoleInput, awaitJob, confirmCommand, installServer,
  fetchSettings, patchSettings, deleteServer,
};

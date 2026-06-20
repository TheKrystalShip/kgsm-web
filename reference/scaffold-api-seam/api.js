// api.js — the single seam between the UI and the backend.
//
// THE WHOLE APP TALKS TO THE BACKEND THROUGH THIS FILE. Components never call
// fetch() directly — they call api.listServers() etc. That means when the real
// API lands you change this one module and nothing else.
//
// Mode is chosen by env:
//   VITE_API_BASE unset  -> fixtures mode (offline; bundled demo data)
//   VITE_API_BASE set    -> live mode (real fetch() to the backend)
//
// The fixtures branch simulates latency so loading states are exercised in dev.
import KRYSTAL_DATA from "./fixtures.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const LIVE = Boolean(API_BASE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "include", // send the session cookie; adjust for token auth
    ...opts,
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* empty / non-JSON */
  }
  if (!res.ok) throw new ApiError(res.status, (body && body.message) || res.statusText, body);
  return body;
}

export const api = {
  /** @returns {Promise<import('./api-contract.js').Server[]>} */
  async listServers() {
    if (!LIVE) {
      await sleep(140);
      return clone(KRYSTAL_DATA.servers);
    }
    return request("/servers");
  },

  /** @returns {Promise<import('./api-contract.js').Server|undefined>} */
  async getServer(id) {
    if (!LIVE) {
      await sleep(100);
      return clone(KRYSTAL_DATA.servers.find((s) => s.id === id));
    }
    return request(`/servers/${encodeURIComponent(id)}`);
  },

  /** @returns {Promise<import('./api-contract.js').Host[]>} */
  async listHosts() {
    if (!LIVE) {
      await sleep(80);
      return clone(KRYSTAL_DATA.hosts);
    }
    return request("/hosts");
  },

  /** @returns {Promise<import('./api-contract.js').CatalogGame[]>} */
  async listCatalog() {
    if (!LIVE) {
      await sleep(120);
      return clone(KRYSTAL_DATA.catalog);
    }
    return request("/catalog");
  },

  /** @returns {Promise<import('./api-contract.js').AuditEvent[]>} */
  async listAudit({ limit = 50 } = {}) {
    if (!LIVE) {
      await sleep(120);
      return clone(KRYSTAL_DATA.auditLog).slice(0, limit);
    }
    return request(`/audit?limit=${limit}`);
  },

  /**
   * Lifecycle action on a server.
   * @param {string} id
   * @param {"start"|"stop"|"restart"} action
   */
  async serverAction(id, action) {
    if (!LIVE) {
      await sleep(500);
      // Optimistic local transition so the demo feels alive.
      const srv = KRYSTAL_DATA.servers.find((s) => s.id === id);
      if (srv) srv.status = action === "stop" ? "offline" : "online";
      return { ok: true, status: srv ? srv.status : "unknown" };
    }
    return request(`/servers/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  },
};

export const isLiveMode = LIVE;

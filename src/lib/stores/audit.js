// stores/audit.js — the audit log, aggregated over the cluster.

import { api } from "../apiClient.js";
import { CONNECTIONS } from "../config.js";
import * as merge from "../merge.js";
import { createStore } from "../store.js";
import { serversStore } from "./servers.js";

// ---- Node attribution -----------------------------------------------------
// An event's node is a property OF THE EVENT: the node that recorded it, or the
// node the server it names runs on. Nothing here scopes the app — these resolve
// the node dimension so a surface can label a row or a list can filter itself.
const serverHostId = (serverId) => {
  const s = serversStore.find(serverId);
  return s ? s.hostId : null;
};

const auditEventHost = (ev) => ev.hostId || (ev.serverId ? serverHostId(ev.serverId) : null);
// Does this event belong to `hostId`? A LIST filter, applied by the list that
// owns the choice. An event with no resolvable node (account/auth events are
// cluster-wide) belongs to every view — it is never hidden by a node filter.
const auditInScope = (ev, hostId) => {
  if (!hostId || hostId === "all") return true;
  const h = auditEventHost(ev);
  if (!h) return true;
  return h === hostId;
};

// ---- Audit log ----
const _withHost = (e) => ({ ...e });
const auditStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
  nextCursor: null,
  loadingMore: false,
  filterParams: {},
});
auditStore.prepend = (entry) =>
  auditStore.setState(s => ({ ...s, list: [_withHost(entry), ...s.list] }));

const AUDIT_BATCH = 200;
// How far one refresh walks the keyset before it stops and leaves the rest behind the cursor. A log
// grows without bound, so a walk that ran to the end would grow with it; stopping is what the page's
// incompleteness note and its Load-older affordance exist to disclose.
const AUDIT_CAP = 1000;
let _auditGen = 0;
const _fetchAuditPage = (cursor, params) => {
  const qs = new URLSearchParams({ limit: String(AUDIT_BATCH) });
  if (cursor) qs.set("cursor", cursor);
  for (const k in (params || {})) { const v = params[k]; if (v != null && v !== "") qs.set(k, v); }
  return api.fanOut("/audit?" + qs.toString()).then(results => {
    const ok = results.filter(r => r.ok);
    const rows = merge.mergeAuditRows(ok.flatMap(r => ((r.data && r.data.rows) || []).map(_withHost)));
    const nextCursor = ok.length === 1 ? ((ok[0].data && ok[0].data.nextCursor) || null) : null;
    return { rows, nextCursor };
  });
};

auditStore.refresh = (params) => {
  const gen = ++_auditGen;
  const filterParams = params || {};
  auditStore.setState(s => ({ ...s, status: "loading", error: null, filterParams }));
  if (CONNECTIONS.length > 1) {
    const qs = new URLSearchParams({ limit: String(AUDIT_BATCH) });
    for (const k in filterParams) { const v = filterParams[k]; if (v != null && v !== "") qs.set(k, v); }
    return api.fanOut("/audit?" + qs.toString()).then(results => {
      if (gen !== _auditGen) return [];
      const okr = results.filter(r => r.ok);
      if (results.length && !okr.length) { const err = results[0].err; auditStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
      const rows = merge.mergeAuditRows(okr.flatMap(r => ((r.data && r.data.rows) || []).map(_withHost)));
      auditStore.setState(s => ({ ...s, list: rows, nextCursor: null, filterParams, status: "ready", error: null, everLoaded: true, loadingMore: false }));
      return rows;
    });
  }
  return _fetchAuditPage(null, filterParams).then(async (page) => {
    let rows = page.rows;
    let next = page.nextCursor;
    while (next && rows.length < AUDIT_CAP) {
      const more = await _fetchAuditPage(next, filterParams);
      rows = rows.concat(more.rows);
      next = more.nextCursor;
    }
    if (gen !== _auditGen) return rows;
    auditStore.setState(s => ({ ...s, list: rows, nextCursor: next, filterParams, status: "ready", error: null, everLoaded: true, loadingMore: false }));
    return rows;
  }, err => {
    if (gen === _auditGen) auditStore.setState(s => ({ ...s, status: "error", error: err }));
    throw err;
  });
};

auditStore.loadMore = () => {
  const st = auditStore.getState();
  if (!st.nextCursor || st.loadingMore) return Promise.resolve();
  const gen = _auditGen;
  const cursor = st.nextCursor;
  const filterParams = st.filterParams || {};
  auditStore.setState(s => ({ ...s, loadingMore: true }));
  return _fetchAuditPage(cursor, filterParams).then(page => {
    if (gen !== _auditGen) return;
    auditStore.setState(s => {
      const seen = new Set(s.list.map(e => e.id));
      const fresh = page.rows.filter(e => !seen.has(e.id));
      return { ...s, list: s.list.concat(fresh), nextCursor: page.nextCursor, loadingMore: false };
    });
  }, () => {
    if (gen === _auditGen) auditStore.setState(s => ({ ...s, loadingMore: false }));
  });
};

api.stream.subscribe(["audit"], (m) => {
  if (m.type === "audit.append" && m.data) auditStore.prepend(m.data);
});

export {
  serverHostId, auditEventHost, auditInScope,
  auditStore, AUDIT_CAP,
};

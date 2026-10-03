// stores/access.js — what the caller may do, as every member they reach has answered it.
//
// One answer per member, kept apart: each node's `GET /api/v1/me/access` (its own actions, at the
// cluster, at itself and at each of its instances), the auth anchor's `GET /me/access` (`auth:*`,
// wherever the caller holds a role), and each other anchor's own (`dns:*`, `assistant:*`, read from the
// capability's holder by `../anchorAccess.js`). `../access.js` looks an action up across them; this
// store only holds them and keeps them fresh.
//
// Fresh by two routes. A node pushes `me.access` on the `me` topic whenever its replica takes a change,
// and the frame replaces that node's answer. An anchor pushes nothing to a browser, so its answer is
// read again whenever this tab comes back into view, after every change made from this panel, and —
// for the other anchors — whenever a capability changes holder.
//
// Beside each answer, the operations that member publishes (`../operations.js`) — which action each of
// its requests needs — so a control is gated on the request it would make, and this panel names no
// action of its own.
//
// A member's answer is one of: `ok` with its report; `unavailable` (it could not read its replica —
// an outage, never "you may do nothing"); `refused` (it has no account for this session, or the
// account is switched off); `unreachable`. Only `ok` carries a report, and a member that has not
// answered answers nothing, so every control it would gate stays closed.
//
// `settled` is true once the first round has answered, whatever it said. The shell holds its first
// paint until then, because a route resolved against no answers would bounce a deep link home.

import { api } from "../apiClient.js";
import { ANCHOR_SOURCE, anchorSource, nodeSource } from "../access.js";
import { ANCHORED_NAMESPACES, readAnchorAccess, readAnchorOperations } from "../anchorAccess.js";
import { readProvider } from "../provider.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";
import { clusterStore } from "./cluster.js";
import { hostsStore } from "./hosts.js";

const accessStore = createStore({ sources: {}, settled: false });

// What a report says, without the version it was evaluated at: two answers granting the same things
// at different versions are the same access, and a person is told only when what they hold moved.
const grantsOf = (r) => (r ? JSON.stringify([!!r.owner, !!r.current, r.cluster, r.nodes, r.instances]) : "");

const listeners = new Set();
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// An entry carries the member's report and the operations it publishes (`../operations.js`): which
// action each of its requests needs. A pushed report arrives without the operations, which are a fact
// about the member's build rather than about the caller, so they are kept.
function put(key, entry) {
  const before = accessStore.getState().sources[key];
  const merged = entry.operations === undefined ? { ...entry, operations: before ? before.operations : null } : entry;
  accessStore.setState((s) => ({ ...s, sources: { ...s.sources, [key]: merged } }));
  if (!accessStore.getState().settled || !before || !before.report || !entry.report) return;
  if (grantsOf(before.report) === grantsOf(entry.report)) return;
  for (const fn of listeners) { try { fn(key); } catch { /* one listener must not stop the rest */ } }
}

function outcomeOf(err) {
  const status = err && (err.status || err.code);
  if (status === 503) return { state: "unavailable", report: null, reason: (err && err.userMessage) || null };
  if (status === 401 || status === 403) return { state: "refused", report: null, reason: (err && err.envCode) || null };
  return { state: "unreachable", report: null, reason: null };
}

// A member's answer and its operations, read together and kept together. Operations that could not be
// read are null, which closes every control gated on that member rather than guessing at one.
function answer(key, reportRead, operationsRead) {
  return Promise.all([reportRead, Promise.resolve(operationsRead).catch(() => null)]).then(
    ([report, operations]) => put(key, { state: "ok", report, reason: null, operations: operations || null }),
    (err) => put(key, outcomeOf(err)),
  );
}

// One read per node at a time: the roster emits on every change it takes, and a node that has not
// answered yet would otherwise be asked again on each one.
const asking = new Map();

function refreshNode(hostId) {
  if (!hostId) return Promise.resolve();
  if (asking.has(hostId)) return asking.get(hostId);
  const p = answer(nodeSource(hostId), api.host(hostId).get("/me/access"), api.host(hostId).get("/operations"))
    .finally(() => asking.delete(hostId));
  asking.set(hostId, p);
  return p;
}

// The anchor is asked only where there is one: a host run with auth switched off names no provider,
// and its nodes answer for everything there is.
function refreshAnchor() {
  if (!readProvider()) return Promise.resolve();
  return answer(ANCHOR_SOURCE, api.authority().access(), api.authority().operations());
}

// The other anchors — each capability's holder answering for its own namespace. A capability nobody
// holds leaves no answer behind, so a holder that moves away stops answering for it.
function refreshAnchors() {
  return Promise.allSettled(ANCHORED_NAMESPACES.map((ns) => Promise.all([
    readAnchorAccess(ns),
    readAnchorOperations(ns).catch(() => null),
  ]).then(
    ([report, operations]) => {
      if (report) put(anchorSource(ns), { state: "ok", report, reason: null, operations: operations || null });
      else forgetSource(anchorSource(ns));
    },
    (err) => put(anchorSource(ns), outcomeOf(err)),
  )));
}

function forgetSource(key) {
  if (!(key in accessStore.getState().sources)) return;
  accessStore.setState((s) => {
    const next = { ...s.sources };
    delete next[key];
    return { ...s, sources: next };
  });
}

function refresh() {
  const ids = (hostsStore.getState().list || []).map((h) => h.id).filter(Boolean);
  return Promise.allSettled([...ids.map(refreshNode), refreshAnchor(), refreshAnchors()]).then(() => {
    if (!accessStore.getState().settled) accessStore.setState((s) => ({ ...s, settled: true }));
  });
}

// A node that has left the roster answers for nothing any more.
function forgetMissing(list) {
  const ids = new Set((list || []).map((h) => h.id).filter(Boolean));
  const sources = accessStore.getState().sources;
  const gone = Object.keys(sources).filter((k) => k.startsWith("node:") && !ids.has(k.slice(5)));
  if (!gone.length) return;
  accessStore.setState((s) => {
    const next = { ...s.sources };
    gone.forEach((k) => { delete next[k]; });
    return { ...s, sources: next };
  });
}

let stopFns = [];

function start() {
  if (stopFns.length) return;
  stopFns.push(api.stream.subscribe(["me"], (m) => {
    if (m && m.type === "me.access" && m.hostId && m.data) {
      put(nodeSource(m.hostId), { state: "ok", report: m.data, reason: null });
    }
  }));
  // A node joining the roster is asked the first time it appears.
  stopFns.push(hostsStore.subscribe(() => {
    const list = hostsStore.getState().list || [];
    forgetMissing(list);
    const sources = accessStore.getState().sources;
    list.forEach((h) => { if (h.id && !sources[nodeSource(h.id)] && !asking.has(h.id)) refreshNode(h.id); });
  }));
  // A capability changing holder is a different member answering for it.
  let holders = "";
  stopFns.push(clusterStore.subscribe(() => {
    const now = ANCHORED_NAMESPACES.map((ns) => clusterStore.holderOf(ns) || "").join("|");
    if (now === holders) return;
    holders = now;
    refreshAnchors();
  }));
  if (typeof document !== "undefined" && document.addEventListener) {
    const visible = () => { if (document.visibilityState === "visible") { refreshAnchor(); refreshAnchors(); } };
    document.addEventListener("visibilitychange", visible);
    stopFns.push(() => document.removeEventListener("visibilitychange", visible));
  }
}

function stop() {
  stopFns.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
  stopFns = [];
}

accessStore.refresh = refresh;
accessStore.refreshNode = refreshNode;
accessStore.refreshAnchor = refreshAnchor;
accessStore.refreshAnchors = refreshAnchors;
accessStore.onChange = onChange;
accessStore.start = start;
accessStore.stop = stop;

export { accessStore };

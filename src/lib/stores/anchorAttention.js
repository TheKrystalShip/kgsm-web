// stores/anchorAttention.js — what the auth anchor is waiting on a person for.
//
// Four things the cluster's access does not settle on its own, each counted only for somebody who
// can act on it — asked as the request that acts on it: accounts awaiting approval (approving one),
// the cluster's own actions nobody has filed into a permission yet (filing one — until then only an
// Owner performs it; an outside application's are not the panel's, `clusterUnmapped`),
// service requirements waiting for a person (deciding one), and the requirements the anchor approved on
// its own this past week (Owners — a grant nobody chose is still a grant somebody sees).
//
// Read, never inferred: the accounts and the authority from the anchor, the automatic approvals from
// the audit feed, which carries the anchor's journal. The anchor pushes nothing to a browser, so the
// items are read again when the tab comes back into view, on a slow cadence, and after an edit made
// here. The anchor's overview card lists them and the sidebar's anchor row counts them.
//
// Started by its consumers and REFCOUNTED, like `fleet.js`: balance every start with one stop.

import { api } from "../apiClient.js";
import { isOwner } from "../persona.js";
import { readProvider } from "../provider.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";
import { authorityStore, clusterUnmapped, editRefusal, userRefusal } from "./authority.js";
const WEEK_MS = 7 * 24 * 3600 * 1000;
const CADENCE_MS = 5 * 60 * 1000;
const APPROVED = "auth.service.requirement.approved";

// `items` is null until a read has answered; an empty list is "nothing waiting".
const anchorAttentionStore = createStore({ items: null });

// What this person can act on, asked as the requests that act on it: approving an account, filing an
// action into a permission, deciding a service's requirement.
const approves = () => !userRefusal("PATCH", "/_", { status: "active" });
const files = () => !editRefusal("permission.actions");
const decides = () => !editRefusal("requirement.approve");

// Whether this person can act on any of it — what decides whether anything is read at all.
function concerned() {
  return isOwner() || approves() || files() || decides();
}

function automaticApprovals() {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  return api.fanOut("/audit?category=auth.service&limit=200&since=" + encodeURIComponent(since)).then((results) => {
    const ok = results.filter((r) => r.ok);
    if (!ok.length) return null;
    const seen = new Set();
    return ok.flatMap((r) => (r.data && r.data.rows) || [])
      .filter((e) => e && e.action === APPROVED && e.meta && e.meta.automatic === "true")
      .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  });
}

function itemsFrom({ accounts, view, approvals }) {
  const items = [];
  if (accounts && approves()) {
    for (const a of accounts.filter((x) => x.status === "pending")) {
      items.push({
        key: "pending:" + (a.id || a.username), page: "accounts", tone: "warn", icon: "hourglass",
        title: (a.username || a.displayName || a.id) + " awaits approval",
        detail: a.displayName && a.displayName !== a.username ? a.displayName : null,
      });
    }
  }
  if (view && files()) {
    const unmapped = clusterUnmapped(view);
    if (unmapped.length) {
      items.push({
        key: "unmapped", page: "catalog", tone: "warn", icon: "list-checks",
        title: unmapped.length + " unmapped action" + (unmapped.length === 1 ? "" : "s"),
        detail: unmapped.slice(0, 4).map((c) => c.action).join(", ") + (unmapped.length > 4 ? ", …" : ""),
      });
    }
  }
  if (view && decides()) {
    for (const svc of view.accounts.filter((a) => a.kind === "service")) {
      const waiting = (svc.requirements || []).filter((q) => q.state === "waiting");
      if (!waiting.length) continue;
      items.push({
        key: "waiting:" + svc.id, page: "services", tone: "warn", icon: "bot",
        title: svc.username + " waits on " + waiting.length + " requirement" + (waiting.length === 1 ? "" : "s"),
        detail: waiting.map((q) => q.action).join(", "),
      });
    }
  }
  for (const e of approvals || []) {
    items.push({
      key: "auto:" + e.id, page: "services", tone: "info", icon: "shield-check",
      title: e.summary || ((e.meta.service || "a service") + " allowed " + e.meta.action),
      at: e.ts,
    });
  }
  return items;
}

let inflight = null;
// What the last read answered, so a change to the authority — an edit made on one of the access
// pages — is reflected without reading the rest again.
let last = { accounts: null, view: null, approvals: null };

function recompute() {
  anchorAttentionStore.setState({ items: itemsFrom(last) });
}

function refresh() {
  if (!readProvider() || !concerned()) {
    anchorAttentionStore.setState({ items: [] });
    return Promise.resolve();
  }
  if (inflight) return inflight;
  const accounts = approves() ? api.users().list().catch(() => null) : Promise.resolve(null);
  const view = files() || decides()
    ? authorityStore.refresh().catch(() => null)
    : Promise.resolve(null);
  const approvals = isOwner() ? automaticApprovals().catch(() => null) : Promise.resolve(null);
  inflight = Promise.all([accounts, view, approvals])
    .then(([a, v, ap]) => { last = { accounts: a, view: v, approvals: ap }; recompute(); })
    .finally(() => { inflight = null; });
  return inflight;
}

let refs = 0;
let stopFns = [];

function startAnchorAttention() {
  refs++;
  if (refs > 1) return;
  refresh();
  const t = setInterval(refresh, CADENCE_MS);
  stopFns.push(() => clearInterval(t));
  stopFns.push(authorityStore.subscribe(() => {
    const view = authorityStore.getState().view;
    if (view && view !== last.view && last.view) { last = { ...last, view }; recompute(); }
  }));
  if (typeof document !== "undefined" && document.addEventListener) {
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    stopFns.push(() => document.removeEventListener("visibilitychange", visible));
  }
}

function stopAnchorAttention() {
  if (refs === 0) return;
  refs--;
  if (refs > 0) return;
  stopFns.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
  stopFns = [];
}

anchorAttentionStore.refresh = refresh;
anchorAttentionStore.concerned = concerned;

export { anchorAttentionStore, startAnchorAttention, stopAnchorAttention };

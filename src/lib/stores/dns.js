// stores/dns.js — the cluster's DNS anchor, as one reactive slot shared by every dns.* widget.
//
// The whole page and every card key on the CAPABILITY, not a member id (see `../dnsClient.js`), so
// this store holds exactly one instance no matter how many surfaces read it. Acquired through
// `useKeyedResource` under the constant key below, the same mechanism a per-target store uses to
// share one hydrate between several mounts of the same target — a pin on the dashboard and the
// anchor's own open page must not fight each other over one fetch.

import { dnsEvents, dnsStatus } from "../dnsClient.js";
import { createStore } from "../store.js";

// The one key every dns.* widget and the anchor's own page acquire this store under.
const DNS_KEY = "dns";

const dnsStore = createStore({
  status: "idle",   // idle | loading | ready | error
  data: null,        // the DnsStatus document, or null
  error: null,
  events: [],
  everLoaded: false,
});

function refresh() {
  dnsStore.setState((s) => ({ ...s, status: s.everLoaded ? s.status : "loading", error: null }));
  return dnsStatus().then(
    (data) => {
      dnsStore.setState((s) => ({ ...s, status: "ready", data, error: null, everLoaded: true }));
      return data;
    },
    (err) => {
      dnsStore.setState((s) => ({ ...s, status: "error", error: err, everLoaded: true }));
      throw err;
    },
  );
}

// The event lane degrades to whatever it last held on a failed read — it is a supplementary feed,
// not the document the page's own states are keyed on.
function refreshEvents(limit) {
  return dnsEvents(limit).then(
    (rows) => { dnsStore.setState((s) => ({ ...s, events: rows })); return rows; },
    () => {},
  );
}

// Refreshed on a slow poll while at least one dns.* widget or the anchor's own page is mounted.
// Nothing here streams — the anchor answers one document per request rather than pushing one, so a
// poll is the honest way to keep it current.
const POLL_MS = 30000;
let timer = null;
function follow() {
  if (timer) return () => {};
  timer = setInterval(() => { refresh().catch(() => {}); }, POLL_MS);
  return () => { clearInterval(timer); timer = null; };
}

dnsStore.refresh = refresh;
dnsStore.refreshEvents = refreshEvents;
dnsStore.follow = follow;

export { DNS_KEY, dnsStore };

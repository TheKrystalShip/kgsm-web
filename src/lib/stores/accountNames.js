// stores/accountNames.js — the username behind an account id, as a node's replica names it.
//
// Surfaces record a person by account id wherever they keep who did something: the engine beside a
// server's maintenance windows, the reactor on a rule, a leaf beside an automation setting. An id is
// what an access check takes and nobody can read, so a surface showing an author asks the node it read
// the id from (`GET /api/v1/accounts/names?id=…`) and shows the name.
//
// Kept per node, because each node answers from its own replica. An id the node does not hold is
// stored as `null` — asked and unknown, which a surface shows as the id itself rather than a guess — and
// never asked about again in this tab. Ids asked for in the same tick go out as one request.

import { api } from "../apiClient.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";

const accountNamesStore = createStore({ byHost: {} });

// hostId -> Set of ids waiting for the next request.
const queued = new Map();
// hostId -> Set of ids already asked about, answered or in flight.
const asked = new Map();

function setNames(hostId, entries) {
  accountNamesStore.setState((s) => ({
    ...s,
    byHost: { ...s.byHost, [hostId]: { ...(s.byHost[hostId] || {}), ...entries } },
  }));
}

function flush(hostId) {
  const ids = [...(queued.get(hostId) || [])];
  queued.delete(hostId);
  if (!ids.length) return;
  const query = ids.map((id) => "id=" + encodeURIComponent(id)).join("&");
  api.host(hostId).get("/accounts/names?" + query).then(
    (res) => {
      const names = (res && res.names) || {};
      setNames(hostId, Object.fromEntries(ids.map((id) => [id, names[id] || null])));
    },
    // An unanswered request names nobody; the ids may be asked about again.
    () => { const held = asked.get(hostId); ids.forEach((id) => held && held.delete(id)); },
  );
}

// Ask `hostId` for the names of `ids` it has not been asked about yet.
function resolveAccountNames(hostId, ids) {
  if (!hostId) return;
  if (!asked.has(hostId)) asked.set(hostId, new Set());
  const held = asked.get(hostId);
  const fresh = (ids || []).filter((id) => id && !held.has(id));
  if (!fresh.length) return;
  fresh.forEach((id) => held.add(id));
  const first = !queued.has(hostId);
  if (first) queued.set(hostId, new Set());
  fresh.forEach((id) => queued.get(hostId).add(id));
  if (first) Promise.resolve().then(() => flush(hostId));
}

export { accountNamesStore, resolveAccountNames };

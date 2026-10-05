// stores/authority.js — the cluster's authority as the auth anchor serves it to whoever administers
// some of it: roles, permissions (with the roles holding each), the catalog (with its declarers and
// what is unmapped), assignments, and accounts (services with their requirements).
//
// Read here for what the panel reports about the anchor — its overview's figures and what it is
// waiting on a person for. Changing any of it is the provider's own admin pages' (`sessionStore.adminPage`);
// this store only reads, at the provider through `api.authority()`, when a surface wants it.

import { ANCHOR_PATHS, api } from "../apiClient.js";
import { callRefusal } from "../persona.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";

const authorityStore = createStore({
  status: "idle",   // idle | loading | ready | error
  view: null,
  error: null,
});

function refresh() {
  authorityStore.setState((s) => ({ ...s, status: s.view ? s.status : "loading", error: null }));
  return api.authority().read().then(
    (view) => { authorityStore.setState({ status: "ready", view, error: null }); return view; },
    (error) => { authorityStore.setState((s) => ({ ...s, status: "error", error })); throw error; },
  );
}

authorityStore.refresh = refresh;

// Why the caller cannot make an authority edit of `kind`, or null when they can — the edits request
// asked of the anchor, which publishes the action each kind needs. An assignment edit is asked at the
// scope it is about (`target`, as `persona.js` takes one).
function editRefusal(kind, target) {
  return callRefusal("auth", "POST", ANCHOR_PATHS.edits, { body: { kind }, target });
}

// The same question for a request on the accounts: `sub` under the users route (`/_` for any account)
// and the body it would carry.
function userRefusal(method, sub, body) {
  return callRefusal("auth", method, ANCHOR_PATHS.users + (sub || ""), { body });
}

export { authorityStore, editRefusal, userRefusal };

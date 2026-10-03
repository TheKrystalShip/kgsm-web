// stores/authority.js — the cluster's authority as the auth anchor serves it to whoever administers
// some of it: roles, permissions (with the roles holding each), the catalog (with its declarers and
// what is unmapped), assignments, and accounts (services with their requirements).
//
// One slot, shared by every management page, read at the provider through `api.authority()`. It
// changes only when somebody changes it, so it is read when a page opens and again after every change
// made from here; the version it was read at is what every change names.
//
// A change made against an older version is refused `409 stale_authority` with the authority as it
// stands, which is adopted here so the page redraws on what is now true before anybody tries again.
// Every other refusal is the rules' own — `code`, the anchor's sentence, and for a subset refusal the
// actions not held — and is handed back to the page that asked, to show beside the control.

import { ANCHOR_PATHS, api } from "../apiClient.js";
import { callRefusal } from "../persona.js";
import { createStore } from "@thekrystalship/krystal-ui/lib/store";
import { accessStore } from "./access.js";

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

// A refusal, in the shape every page shows it.
function refusalOf(e) {
  return {
    code: (e && e.envCode) || null,
    message: (e && e.userMessage) || "The change was refused.",
    actions: (e && e.body && Array.isArray(e.body.actions)) ? e.body.actions : null,
  };
}

// Make one change against the version on screen. Resolves `{ ok: true, createdId }` or
// `{ ok: false, refusal }`; never throws. What the caller may do can move with it — assigning
// themselves a role, editing a role they hold — so their own access is read again too.
function edit(change) {
  const view = authorityStore.getState().view;
  if (!view) return Promise.resolve({ ok: false, refusal: { code: null, message: "Access has not loaded yet.", actions: null } });
  return api.authority().edit(view.version, change).then(
    (result) => {
      refresh().catch(() => {});
      accessStore.refreshAnchor();
      accessStore.refreshAnchors();
      return { ok: true, createdId: (result && result.createdId) || null };
    },
    (e) => {
      if (e && e.status === 409 && e.body && e.body.authority) {
        authorityStore.setState({ status: "ready", view: e.body.authority, error: null });
      }
      return { ok: false, refusal: refusalOf(e) };
    },
  );
}

// The rules' verdict on edits nobody has made, in order: `{ allowed, code, message, actions }` each.
// A failed ask answers nothing rather than "allowed", so a page keeps its controls as they were.
function check(edits) {
  if (!edits || !edits.length) return Promise.resolve([]);
  return api.authority().check(edits).catch(() => edits.map(() => null));
}

authorityStore.refresh = refresh;
authorityStore.edit = edit;
authorityStore.check = check;

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

export { authorityStore, editRefusal, refusalOf, userRefusal };

import React from "react";

// store.js — the spine of the client data layer.
//
// A domain store is a tiny reactive container: it holds server truth (hydrated
// from REST, kept live by WebSocket) and notifies subscribers on change.
// Components never read the API directly — they subscribe to a store slice with
// useStore and call store actions. See architecture.html (§4).
//
// Framework-agnostic core (createStore) + React binding (useStore via
// useSyncExternalStore, the canonical React 18 external-store hook).

function createStore(initial) {
  let state = initial;
  const subs = new Set();
  const emit = () => subs.forEach(fn => fn());
  return {
    getState() { return state; },
    // Object patch (merged), array (replaced), or updater fn (prev => next).
    setState(next) {
      if (typeof next === "function") state = next(state);
      else if (Array.isArray(next) || typeof next !== "object" || next === null) state = next;
      else state = { ...state, ...next };
      emit();
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

// useStore(store) -> whole state; useStore(store, s => s.slice) -> a slice.
// The selector MUST return a stable reference when nothing changed (return a
// state slice, don't build a new array/object inline) — derive with useMemo in
// the component if you need to transform.
function useStore(store, selector) {
  // Same snapshot for client + server (getServerSnapshot) so the hook is safe
  // under renderToString / prerender as well as in the browser.
  const snapshot = () => (selector ? selector(store.getState()) : store.getState());
  return React.useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

export { createStore, useStore };

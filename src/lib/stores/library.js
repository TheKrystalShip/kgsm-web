// stores/library.js — Game library (installable catalog).
// Mostly static; hydrate from api.get("/library").

import { api } from "../apiClient.js";
import * as merge from "../merge.js";
import { createStore } from "../store.js";

const libraryStore = createStore({
  list: [],
  status: "loading",
  error: null,
  everLoaded: false,
});

libraryStore.refresh = () => {
  libraryStore.setState(s => ({ ...s, status: "loading", error: null }));
  return api.fanOut("/library").then(results => {
    const okr = results.filter(r => r.ok);
    if (results.length && !okr.length) { const err = results[0].err; libraryStore.setState(s => ({ ...s, status: "error", error: err })); throw err; }
    const list = merge.mergeLibrary(okr.map(r => ({ hostId: r.conn && r.conn.id, list: r.data })));
    libraryStore.setState(s => ({ ...s, list, status: "ready", error: null, everLoaded: true }));
    return list;
  });
};

libraryStore.setOffering = (id, hosts) =>
  libraryStore.setState(s => ({
    ...s,
    list: s.list.map(g => {
      if (g.id !== id) return g;
      if (hosts == null) { const { hosts: _drop, ...rest } = g; return rest; }
      return { ...g, hosts };
    }),
  }));

export { libraryStore };

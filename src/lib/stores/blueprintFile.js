// stores/blueprintFile.js — Blueprint file I/O (load/save/revert) for the
// library editor. Keyed by host+name; caches the last-loaded content + etag
// so the editor re-enters instantly on tab/page switches.

import { api } from "../apiClient.js";
import { createStore } from "../store.js";

const _bpKey = (hostId, name) => (hostId || "_") + "/" + name;
const _empty = () => ({
  content: null, etag: null, sizeBytes: null, mtime: null,
  tier: null, overridesSystem: false, canRevert: false,
  readOnly: true, runtime: null, hostId: null,
  status: "idle", error: null, everLoaded: false,
});

const blueprintFileStore = createStore({ byKey: {} });

blueprintFileStore.entry = (hostId, name) =>
  blueprintFileStore.getState().byKey[_bpKey(hostId, name)] || null;

const _patch = (key, fn) =>
  blueprintFileStore.setState(s => ({
    ...s,
    byKey: { ...s.byKey, [key]: fn(s.byKey[key] || _empty()) },
  }));

blueprintFileStore.load = (hostId, name) => {
  const key = _bpKey(hostId, name);
  _patch(key, e => ({ ...e, status: "loading", error: null }));
  return api.host(hostId).get("/library/" + encodeURIComponent(name) + "/file").then(
    (res) => {
      _patch(key, () => ({
        content: res.content,
        etag: res.etag,
        sizeBytes: res.sizeBytes,
        mtime: res.mtime,
        tier: res.tier,
        overridesSystem: res.overridesSystem,
        canRevert: res.canRevert,
        readOnly: res.readOnly,
        runtime: res.runtime,
        hostId: res.hostId,
        status: "ready",
        error: null,
        everLoaded: true,
      }));
      return blueprintFileStore.entry(hostId, name);
    },
    (err) => {
      _patch(key, e => ({ ...e, status: "error", error: err }));
      throw err;
    }
  );
};

blueprintFileStore.save = (hostId, name, content, etag) => {
  const key = _bpKey(hostId, name);
  _patch(key, e => ({ ...e, status: "saving", error: null }));
  return api.host(hostId).put(
    "/library/" + encodeURIComponent(name) + "/file",
    { content, etag, origin: "ui" },
  ).then(
    (res) => {
      _patch(key, e => ({
        ...e,
        content,
        etag: res.etag,
        sizeBytes: res.sizeBytes,
        mtime: res.mtime,
        overridesSystem: res.overridesSystem,
        canRevert: res.overridesSystem,
        status: "ready",
        error: null,
      }));
      return blueprintFileStore.entry(hostId, name);
    },
    (err) => {
      _patch(key, e => ({ ...e, status: "ready", error: err }));
      throw err;
    }
  );
};

blueprintFileStore.revert = (hostId, name) => {
  const key = _bpKey(hostId, name);
  _patch(key, e => ({ ...e, status: "reverting", error: null }));
  return api.host(hostId).del(
    "/library/" + encodeURIComponent(name) + "/file?origin=ui",
  ).then(
    () => blueprintFileStore.load(hostId, name),
    (err) => {
      _patch(key, e => ({ ...e, status: "ready", error: err }));
      throw err;
    }
  );
};

export { blueprintFileStore };

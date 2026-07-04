// stores/files.js — File browser store (per-server working-dir tree + editor cache).
// Self-contained: only depends on api.host(). No WS channel.

import { api } from "../apiClient.js";
import { createStore } from "../store.js";

const filesKey = (hostId, serverId) => (hostId || "_") + "/" + serverId;
const _emptyFilesEntry = () => ({ dirs: {}, expanded: {}, open: null, everLoaded: false });
const _filesClient = (hostId) => {
  if (!hostId) throw new Error("_filesClient: hostId required");
  return api.host(hostId);
};
const filesStore = createStore({ byServer: {} });
filesStore.entry = (hostId, serverId) =>
  filesStore.getState().byServer[filesKey(hostId, serverId)] || null;
const _patchFiles = (key, fn) =>
  filesStore.setState(s => ({ ...s, byServer: { ...s.byServer, [key]: fn(s.byServer[key] || _emptyFilesEntry()) } }));

filesStore.loadDir = (hostId, serverId, path) => {
  const key = filesKey(hostId, serverId);
  const cur = ((filesStore.getState().byServer[key] || {}).dirs || {})[path] || null;
  const keptEntries = cur && cur.entries ? cur.entries : null;
  const keptTrunc = !!(cur && cur.truncated);
  _patchFiles(key, e => ({ ...e, dirs: { ...e.dirs, [path]: { entries: keptEntries, truncated: keptTrunc, status: "loading", error: null } } }));
  const url = "/servers/" + serverId + "/files" + (path ? "?path=" + encodeURIComponent(path) : "");
  return _filesClient(hostId).get(url).then(
    (res) => {
      _patchFiles(key, e => ({
        ...e,
        everLoaded: path === "" ? true : e.everLoaded,
        dirs: { ...e.dirs, [path]: { entries: (res && res.entries) || [], truncated: !!(res && res.truncated), status: "ready", error: null } },
      }));
    },
    (err) => {
      _patchFiles(key, e => ({
        ...e,
        dirs: { ...e.dirs, [path]: { entries: keptEntries || [], truncated: keptTrunc, status: "error", error: err } },
      }));
    }
  );
};

filesStore.toggleDir = (hostId, serverId, path) => {
  const key = filesKey(hostId, serverId);
  const entry = filesStore.getState().byServer[key] || _emptyFilesEntry();
  const willOpen = !entry.expanded[path];
  _patchFiles(key, e => ({ ...e, expanded: { ...e.expanded, [path]: willOpen } }));
  const d = entry.dirs[path];
  if (willOpen && (!d || (d.status !== "ready" && d.status !== "loading"))) filesStore.loadDir(hostId, serverId, path);
};

filesStore.enter = (hostId, serverId) => {
  const entry = filesStore.entry(hostId, serverId);
  filesStore.loadDir(hostId, serverId, "");
  if (entry) Object.keys(entry.expanded).forEach((p) => {
    if (p !== "" && entry.expanded[p]) filesStore.loadDir(hostId, serverId, p);
  });
};

filesStore.openFile = (hostId, serverId, path) => {
  const key = filesKey(hostId, serverId);
  return _filesClient(hostId).get("/servers/" + serverId + "/files/content?path=" + encodeURIComponent(path)).then((res) => {
    const open = { path: res.path, content: res.content, etag: res.etag, sizeBytes: res.sizeBytes };
    _patchFiles(key, e => ({ ...e, open }));
    return open;
  });
};

filesStore.saveFile = (hostId, serverId, path, content, etag) => {
  const key = filesKey(hostId, serverId);
  return _filesClient(hostId).put("/servers/" + serverId + "/files/content?path=" + encodeURIComponent(path), { content, etag, origin: "ui" }).then((res) => {
    const open = { path, content, etag: res.etag, sizeBytes: res.sizeBytes };
    _patchFiles(key, e => ({ ...e, open }));
    return open;
  });
};

export { filesKey, filesStore };

import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { api } from "../lib/apiClient.js";

// File browser & editor — a VSCode-like lazy tree on the left, a plain editor on
// the right. Wired to GET/PUT /servers/{id}/files (Tier 3 #12): the root listing
// loads on mount, a folder's children load on first expand (one directory per
// request), a file opens raw into the editor, and Save does an etag PUT.
//
// Honesty: sizes/mtimes are measured (blank when the backend reports null);
// binary/too-large files are SHOWN in the tree but refuse to open with a reason
// (never rendered as garbage); a truncated directory shows a banner, never a
// silent gap.

// Human-readable byte size; null/undefined => "" (the backend's honest "unknown").
function formatBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let v = n, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
}

const joinPath = (parent, name) => (parent ? parent + "/" + name : name);
const errText = (e, fallback) => (e && (e.userMessage || e.message)) || fallback;
const enc = encodeURIComponent;

// One row in the tree. A folder lazily fetches its own children on first expand
// and keeps them in local state; a file/symlink/special is a leaf that opens (or,
// when not openable, shows why on hover and stays dimmed).
function FileTreeRow({ entry, parent, depth, client, serverId, activePath, onOpenFile }) {
  const path = joinPath(parent, entry.name);
  const [open, setOpen] = React.useState(false);
  const [children, setChildren] = React.useState(null); // null = not loaded
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const pad = 8 + depth * 14;

  if (entry.kind === "dir") {
    const toggle = () => {
      const next = !open;
      setOpen(next);
      if (next && children === null && !loading) {
        setLoading(true); setErr(null);
        client.get("/servers/" + serverId + "/files?path=" + enc(path)).then(
          (res) => { setChildren((res && res.entries) || []); setTruncated(!!(res && res.truncated)); setLoading(false); },
          (e) => { setErr(errText(e, "Couldn't open folder.")); setChildren([]); setLoading(false); }
        );
      }
    };
    return (
      <>
        <div className="fb-row fb-row--folder" style={{ paddingLeft: pad }} onClick={toggle}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          <Icon name={open ? "folder-open" : "folder"} size={15} />
          <span>{entry.name}</span>
        </div>
        {open && (
          <>
            {loading && <div className="fb-row" style={{ paddingLeft: pad + 30, color: "var(--fg-4)" }}>Loading…</div>}
            {err && <div className="fb-row" style={{ paddingLeft: pad + 30, color: "var(--danger)" }}>{err}</div>}
            {children && children.map((c) => (
              <FileTreeRow key={c.name} entry={c} parent={path} depth={depth + 1}
                client={client} serverId={serverId} activePath={activePath} onOpenFile={onOpenFile} />
            ))}
            {truncated && (
              <div className="fb-row" style={{ paddingLeft: pad + 30, color: "var(--warning-fg)", fontSize: 11, cursor: "default" }}>
                Showing first entries — folder too large to list fully
              </div>
            )}
          </>
        )}
      </>
    );
  }

  // Leaf: file / symlink / special. Only a regular, editable file opens.
  const openable = entry.kind === "file" && entry.editable !== false;
  const isActive = activePath === path;
  const icon = entry.kind === "file" ? "file-text" : entry.kind === "symlink" ? "link" : "file-lock";
  const reasonLabel = {
    "symlink-out-of-scope": "Symlink — outside the editable area",
    "special": "Special file — can't be opened",
    "too-large": "Too large to edit",
    "binary": "Binary — can't be edited",
  };
  const title = openable ? path : (reasonLabel[entry.reason] || entry.reason || "Can't open this file");
  return (
    <div className={"fb-row" + (isActive ? " fb-row--active" : "")}
      style={{ paddingLeft: pad + 16, opacity: openable ? 1 : 0.5, cursor: openable ? "pointer" : "default" }}
      title={title}
      onClick={openable ? () => onOpenFile(path) : undefined}>
      <Icon name={icon} size={14} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
      <span style={{ color: "var(--fg-4)", fontSize: 11 }}>{formatBytes(entry.sizeBytes)}</span>
    </div>
  );
}

function FileBrowser({ server }) {
  // Server-scoped client (per-host bearer/base) — the BackupsList convention.
  const client = (server && server.hostId && api.host) ? api.host(server.hostId) : api;
  const serverId = server.id;

  const [roots, setRoots] = React.useState(null);  // null = loading, [] = empty
  const [rootTruncated, setRootTruncated] = React.useState(false);
  const [treeError, setTreeError] = React.useState(null);

  const [active, setActive] = React.useState(null); // { path, content, etag, sizeBytes }
  const [draft, setDraft] = React.useState("");
  const [opening, setOpening] = React.useState(false);
  const [openIssue, setOpenIssue] = React.useState(null); // { path, message } — binary/too-large/etc
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState(null);
  const [staleReload, setStaleReload] = React.useState(false);

  // Load the root directory on mount / when the server changes.
  React.useEffect(() => {
    let alive = true;
    setRoots(null); setTreeError(null); setRootTruncated(false);
    setActive(null); setOpenIssue(null); setSaveError(null);
    client.get("/servers/" + serverId + "/files").then(
      (res) => { if (!alive) return; setRoots((res && res.entries) || []); setRootTruncated(!!(res && res.truncated)); },
      (e) => { if (!alive) return; setRoots([]); setTreeError(errText(e, "Couldn't load files.")); }
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, server && server.hostId]);

  const dirty = !!active && draft !== active.content;

  const openFile = (path) => {
    setOpening(true); setSaveError(null); setStaleReload(false); setOpenIssue(null);
    client.get("/servers/" + serverId + "/files/content?path=" + enc(path)).then(
      (res) => { setActive({ path: res.path, content: res.content, etag: res.etag, sizeBytes: res.sizeBytes }); setDraft(res.content); setOpening(false); },
      (e) => {
        setActive(null); setOpening(false);
        const code = e && e.envCode;
        setOpenIssue({
          path,
          message: code === "file_binary" ? "This file is binary — it can't be opened in the editor."
            : code === "file_too_large" ? "This file is too large to open in the editor."
            : errText(e, "Couldn't open this file."),
        });
      }
    );
  };

  // Picking a file from the tree warns before discarding unsaved edits; the
  // reload-after-412 path calls openFile directly (no guard — the user chose it).
  const pickFile = (path) => {
    if (dirty && active && !window.confirm("Discard unsaved changes to " + active.path + "?")) return;
    openFile(path);
  };
  const reload = () => { if (active) openFile(active.path); };
  const reset = () => { if (active) setDraft(active.content); };

  const save = () => {
    if (!active || saving) return;
    setSaving(true); setSaveError(null); setStaleReload(false);
    client.put("/servers/" + serverId + "/files/content?path=" + enc(active.path),
      { content: draft, etag: active.etag, origin: "ui" }).then(
      (res) => { setActive((a) => ({ ...a, content: draft, etag: res.etag, sizeBytes: res.sizeBytes })); setSaving(false); },
      (e) => {
        setSaving(false);
        if (e && (e.code === 412 || e.envCode === "precondition_failed")) {
          setSaveError("This file changed on disk since you opened it."); setStaleReload(true);
        } else {
          setSaveError(errText(e, "Couldn't save."));
        }
      }
    );
  };

  return (
    <BriefCard icon="folder" title="Files" meta={"Working directory · " + serverId}>
      <div className="fb-card">
        {/* ---- tree ---- */}
        <div className="fb-tree">
          {roots == null ? (
            <div className="fb-row" style={{ color: "var(--fg-4)", cursor: "default" }}>Loading…</div>
          ) : treeError ? (
            <div className="fb-row" style={{ color: "var(--danger)", cursor: "default" }}>{treeError}</div>
          ) : roots.length === 0 ? (
            <div className="fb-row" style={{ color: "var(--fg-4)", cursor: "default" }}>Empty directory</div>
          ) : (
            roots.map((e) => (
              <FileTreeRow key={e.name} entry={e} parent="" depth={0}
                client={client} serverId={serverId} activePath={active && active.path} onOpenFile={pickFile} />
            ))
          )}
          {rootTruncated && (
            <div className="fb-row" style={{ color: "var(--warning-fg)", fontSize: 11, cursor: "default" }}>
              Showing first entries — directory too large to list fully
            </div>
          )}
        </div>

        {/* ---- editor ---- */}
        <div className="fb-editor">
          {opening ? (
            <div className="fb-editor__empty"><span className="oauth-spinner" /> Opening…</div>
          ) : openIssue ? (
            <div className="fb-editor__empty">
              <Icon name="file-lock" size={26} strokeWidth={1.6} />
              <div style={{ fontSize: 13.5, color: "var(--fg-2)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>{openIssue.path}</div>
              <div style={{ fontSize: 12.5 }}>{openIssue.message}</div>
            </div>
          ) : !active ? (
            <div className="fb-editor__empty">
              <Icon name="file-text" size={26} strokeWidth={1.6} />
              <div style={{ fontSize: 13 }}>Select a file to view or edit.</div>
            </div>
          ) : (
            <>
              <div className="fb-editor__bar">
                <Icon name="file-text" size={14} />
                <span className="fb-editor__path"><b>{active.path}</b></span>
                {dirty && <span className="fb-editor__dirty"><span className="dot" />unsaved changes</span>}
                <span className="fb-editor__spacer" />
                <span style={{ color: "var(--fg-4)", fontSize: 11 }}>{formatBytes(active.sizeBytes)}</span>
              </div>
              <textarea
                className="fb-editor__textarea"
                value={draft}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="fb-editor__foot">
                {saveError && (
                  <span className="fb-editor__err">
                    <Icon name="alert-triangle" size={13} /> {saveError}
                    {staleReload && <button className="fb-editor__btn fb-editor__btn--secondary fb-editor__btn--sm" style={{ marginLeft: 8 }} onClick={reload}>Reload</button>}
                  </span>
                )}
                <span className="fb-editor__spacer" />
                <button className="fb-editor__btn fb-editor__btn--secondary" type="button" onClick={reset} disabled={!dirty || saving}>
                  <Icon name="rotate-ccw" size={14} /> Reset
                </button>
                <button className="fb-editor__btn" type="button" onClick={save} disabled={!dirty || saving}>
                  {saving ? <><span className="oauth-spinner" /> Saving…</> : <><Icon name="check" size={14} strokeWidth={2.4} /> Save changes</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </BriefCard>
  );
}

export { FileBrowser };

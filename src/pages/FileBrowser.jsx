import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { useStore } from "../lib/store.js";
import { filesKey, filesStore } from "../lib/stores.js";

// File browser & editor — a VSCode-like lazy tree on the left, a plain editor on
// the right. Wired to GET/PUT /servers/{id}/files (Tier 3 #12), but the tree,
// expansion state and last-opened file all live in `filesStore` (keyed by
// host+server), NOT component state — so re-entering the Files tab paints
// instantly from cache and revalidates in the background (stale-while-revalidate).
// The root + expanded folders refetch on enter; clicking a file always re-GETs.
//
// Honesty: sizes/mtimes are measured (blank when the backend reports null);
// binary/too-large files are SHOWN in the tree but refuse to open with a reason
// (never rendered as garbage); a truncated directory shows a banner, never a
// silent gap. A cached listing is last-known-real, not fabricated.

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

// Stable empty slice — the selector returns undefined until a server's entry
// exists, so this gives the render a constant-shaped fallback.
const EMPTY_FILES = { dirs: {}, expanded: {}, open: null, everLoaded: false };

// One row in the tree. A folder reads its expanded flag + lazily-loaded children
// from filesStore (passed down as `dirs`/`expanded` maps), so the whole tree —
// including which folders are open — survives a tab switch. A file/symlink/
// special is a leaf that opens (or, when not openable, shows why on hover).
function FileTreeRow({ entry, parent, depth, dirs, expanded, activePath, onOpenFile, onToggle }) {
  const path = joinPath(parent, entry.name);
  const pad = 8 + depth * 14;

  if (entry.kind === "dir") {
    const open = !!expanded[path];
    const d = dirs[path] || null;
    const children = open && d ? d.entries : null;
    // "Loading…" only on a COLD expand (no cached children) — a background
    // revalidate keeps the cached children visible and never flashes.
    const loading = open && d && d.status === "loading" && !d.entries;
    // Surface a folder error only when there's nothing cached to show; a failed
    // revalidate keeps the last-known children (SWR).
    const err = open && d && d.status === "error" && !(d.entries && d.entries.length) ? d.error : null;
    const truncated = !!(d && d.truncated);
    return (
      <>
        <div className="fb-row fb-row--folder" style={{ paddingLeft: pad }} onClick={() => onToggle(path)}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          <Icon name={open ? "folder-open" : "folder"} size={15} />
          <span>{entry.name}</span>
        </div>
        {open && (
          <>
            {loading && <div className="fb-row" style={{ paddingLeft: pad + 30, color: "var(--fg-4)" }}>Loading…</div>}
            {err && <div className="fb-row" style={{ paddingLeft: pad + 30, color: "var(--danger)" }}>{errText(err, "Couldn't open folder.")}</div>}
            {children && children.map((c) => (
              <FileTreeRow key={c.name} entry={c} parent={path} depth={depth + 1}
                dirs={dirs} expanded={expanded} activePath={activePath} onOpenFile={onOpenFile} onToggle={onToggle} />
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
  const serverId = server.id;
  const hostId = (server && server.hostId) || null;

  // The cached tree + open file for this server (survives tab switches). The
  // selector returns a stable ref until this server's slice changes.
  const fs = useStore(filesStore, s => s.byServer[filesKey(hostId, serverId)]) || EMPTY_FILES;
  const root = fs.dirs[""] || null;
  const open = fs.open;                 // cached { path, content, etag, sizeBytes } or null

  // The editor draft is the one piece kept local — an in-progress edit is
  // transient and not preserved across a tab switch (the saved content IS,
  // restored from cache below). dirty = draft diverged from the cached content.
  const [draft, setDraft] = React.useState(open ? open.content : "");
  const [opening, setOpening] = React.useState(false);
  const [openIssue, setOpenIssue] = React.useState(null); // { path, message } — binary/too-large/etc
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState(null);
  const [staleReload, setStaleReload] = React.useState(false);

  // Enter the tab / switch server: paint the cache, revalidate the tree in the
  // background, and reset the transient editor UI (restoring the draft from the
  // cached file so re-entry shows what you were looking at instantly).
  React.useEffect(() => {
    filesStore.enter(hostId, serverId);
    const cached = filesStore.entry(hostId, serverId);
    setDraft((cached && cached.open && cached.open.content) || "");
    setOpenIssue(null); setSaveError(null); setStaleReload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, hostId]);

  const dirty = !!open && draft !== open.content;

  const openFile = (path) => {
    setOpening(true); setSaveError(null); setStaleReload(false); setOpenIssue(null);
    filesStore.openFile(hostId, serverId, path).then(
      (o) => { setDraft(o.content); setOpening(false); },
      (e) => {
        setOpening(false);
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
    if (dirty && open && !window.confirm("Discard unsaved changes to " + open.path + "?")) return;
    openFile(path);
  };
  const onToggle = (path) => filesStore.toggleDir(hostId, serverId, path);
  const reload = () => { if (open) openFile(open.path); };
  const reset = () => { if (open) setDraft(open.content); };

  const save = () => {
    if (!open || saving) return;
    setSaving(true); setSaveError(null); setStaleReload(false);
    filesStore.saveFile(hostId, serverId, open.path, draft, open.etag).then(
      () => { setSaving(false); },   // store now has content === draft + new etag → dirty clears
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

  // Root listing state. entries == null → cold load (never held data) → skeleton;
  // a background revalidate keeps entries non-null so it never flashes.
  const rootEntries = root ? root.entries : null;
  const rootCold = rootEntries == null;
  const treeError = root && root.status === "error" && !(root.entries && root.entries.length) ? root.error : null;
  const rootTruncated = !!(root && root.truncated);

  return (
    <BriefCard icon="folder" title="Files" meta={"Working directory · " + serverId}>
      <div className="fb-card">
        {/* ---- tree ---- */}
        <div className="fb-tree">
          {rootCold ? (
            <div className="fb-row" style={{ color: "var(--fg-4)", cursor: "default" }}>Loading…</div>
          ) : treeError ? (
            <div className="fb-row" style={{ color: "var(--danger)", cursor: "default" }}>{errText(treeError, "Couldn't load files.")}</div>
          ) : rootEntries.length === 0 ? (
            <div className="fb-row" style={{ color: "var(--fg-4)", cursor: "default" }}>Empty directory</div>
          ) : (
            rootEntries.map((e) => (
              <FileTreeRow key={e.name} entry={e} parent="" depth={0}
                dirs={fs.dirs} expanded={fs.expanded} activePath={open && open.path} onOpenFile={pickFile} onToggle={onToggle} />
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
          ) : !open ? (
            <div className="fb-editor__empty">
              <Icon name="file-text" size={26} strokeWidth={1.6} />
              <div style={{ fontSize: 13 }}>Select a file to view or edit.</div>
            </div>
          ) : (
            <>
              <div className="fb-editor__bar">
                <Icon name="file-text" size={14} />
                <span className="fb-editor__path"><b>{open.path}</b></span>
                {dirty && <span className="fb-editor__dirty"><span className="dot" />unsaved changes</span>}
                <span className="fb-editor__spacer" />
                <span style={{ color: "var(--fg-4)", fontSize: 11 }}>{formatBytes(open.sizeBytes)}</span>
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

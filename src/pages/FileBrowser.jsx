import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";

// File browser — tree on the left, editor on the right.
//
// NOT WIRED YET: there is no file API on the host, so the tab renders a
// work-in-progress state. The full tree + editor UI below is kept ready — flip
// FILES_WIRED to true and hydrate `tree`/`file` from the files endpoint when it
// lands.
const FILES_WIRED = false;

function FileTreeRow({ node, depth = 0, activePath, onPick }) {
  const [open, setOpen] = React.useState(node.open || false);
  if (node.type === "folder") {
    return (
      <>
        <div className="fb-row fb-row--folder" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen(o => !o)}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          <Icon name={open ? "folder-open" : "folder"} size={15} />
          <span>{node.name}</span>
        </div>
        {open && node.children.map((c, i) => (
          <FileTreeRow key={i} node={c} depth={depth + 1} activePath={activePath} onPick={onPick} />
        ))}
      </>
    );
  }
  const isActive = activePath && activePath.endsWith(node.name);
  return (
    <div className={"fb-row" + (isActive ? " fb-row--active" : "")} style={{ paddingLeft: 8 + depth * 14 + 16 }} onClick={() => onPick(node)}>
      <Icon name="file-text" size={14} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
      <span style={{ color: "var(--fg-4)", fontSize: 11 }}>{node.size}</span>
    </div>
  );
}

function FileBrowser() {
  const tree = [];                          // TODO: hydrate from the files endpoint when FILES_WIRED
  const file = { path: "", lines: [] };     // TODO: hydrate the open file when FILES_WIRED
  const [activePath, setActivePath] = React.useState(file.path);

  // Download the file currently open in the editor. Reconstructs the text from
  // the editor's line model and hands it to the browser as a Blob download,
  // named after the open file.
  const downloadCurrent = () => {
    const text = file.lines.map(ln => ln.c || "").join("\n");
    const name = (activePath.split("/").pop()) || "file.txt";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!FILES_WIRED) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "var(--fg-3)" }}>
        <Icon name="folder" size={26} strokeWidth={1.6} />
        <div style={{ marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>Work in progress — not available yet</div>
        <div style={{ marginTop: 4, fontSize: 12.5 }}>There's no file API on this host yet — the browser lights up when it lands.</div>
      </div>
    );
  }

  return (
    <BriefCard icon="folder" title="Files">
    <div className="fb-card">
      <div className="fb-tree">
        {tree.map((n, i) => <FileTreeRow key={i} node={n} activePath={activePath} onPick={(f) => setActivePath("config/" + f.name)} />)}
      </div>
      <div className="fb-editor">
        <div className="fb-editor__bar">
          <Icon name="file-text" size={14} />
          <span className="fb-editor__path">install/<b>{activePath}</b></span>
          <span className="fb-editor__dirty"><span className="dot"></span>unsaved changes</span>
          <span style={{ flex: 1 }} />
          <button className="fb-editor__btn fb-editor__btn--secondary fb-editor__btn--sm" type="button" onClick={downloadCurrent} title={"Download " + activePath}>
            <Icon name="download" size={14} />
            Download
          </button>
        </div>
        <div className="fb-editor__body">
          <div className="fb-editor__gutter">{file.lines.map((_, i) => (i + 1) + "\n")}</div>
          <div className="fb-editor__code">
            {file.lines.map((ln, i) => (
              <div key={i} className={ln.k ? ln.k : ""}>{ln.c || "\u00A0"}</div>
            ))}
          </div>
        </div>
        <div className="fb-editor__foot">
          <button className="fb-editor__btn fb-editor__btn--secondary" type="button">
            <Icon name="rotate-ccw" size={14} />
            Reset
          </button>
          <span style={{ flex: 1 }} />
          <button className="fb-editor__btn" type="button">
            <Icon name="check" size={14} strokeWidth={2.4} />
            Save changes
          </button>
        </div>
      </div>
    </div>
    </BriefCard>
  );
}

export { FileBrowser };

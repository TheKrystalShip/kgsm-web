import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { LIVE } from "../lib/config.js";
import { api } from "../lib/apiClient.js";
import { awaitJob } from "../lib/stores.js";
import { KRYSTAL_DATA } from "../lib/data.js";

// Backups list — one row per snapshot. Rendered through the shared BriefCard
// shell; each entry uses the same .chat-brief__item row style as the dashboard's
// Alerts / Recent activity cards. The whole tab is operator-gated upstream
// (App.ServerDetailPage hides it for viewers), so the create/restore actions are
// safe to show here without a second gate.
//
// LIVE vs mock: the live backend (GET /servers/{id}/backups) reports a backup's
// NAME ONLY — no size / timestamp / type, and there is no download or delete
// endpoint. So the live row is honest-thin (name + Restore), never a fabricated
// size/age. The bundled fixture keeps the richer demo for offline mode.

// ---- live: one server's real backups ------------------------------------
function BackupsLive({ server }) {
  const [list, setList] = React.useState(null);   // null = loading, [] = none
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(null);   // "create" | "restore:<name>" | null
  const client = (server && server.hostId && api.host) ? api.host(server.hostId) : api;

  const load = React.useCallback(() => {
    setError(null);
    return client.get("/servers/" + server.id + "/backups").then(
      (res) => setList(Array.isArray(res && res.backups) ? res.backups : []),
      (err) => { setList([]); setError(err && (err.userMessage || err.message) || "Could not load backups."); }
    );
  }, [server.id, server.hostId]);

  React.useEffect(() => { setList(null); load(); }, [load]);

  // Create / restore are async jobs (202 + { job }); the snapshot is taken off
  // request and shows up on a re-list once the job settles. We await the job over
  // the `jobs` WS (the shared awaitJob), then refetch — never fabricating a row.
  const runJob = (label, call) => {
    setBusy(label);
    setError(null);
    call().then(
      (resp) => {
        const job = resp && resp.job;
        const done = (job && job.id) ? awaitJob(job.id, server.hostId) : Promise.resolve();
        return done.then(() => load()).finally(() => setBusy(null));
      },
      (err) => { setError(err && (err.userMessage || err.message) || "Action failed."); setBusy(null); }
    );
  };
  const createBackup = () => runJob("create", () => client.post("/servers/" + server.id + "/backups", { origin: "ui" }));
  const restoreBackup = (name) => runJob("restore:" + name, () => client.post("/servers/" + server.id + "/backups/restore", { backup: name, origin: "ui" }));

  const count = list == null ? "—" : (list.length + (list.length === 1 ? " snapshot" : " snapshots"));
  return (
    <BriefCard
      icon="database"
      title="Backups"
      count={count}
      countTone="neutral"
      meta="Snapshots taken by the engine · newest first"
      action={
        <button className="fb-editor__btn" onClick={createBackup} disabled={busy === "create"}>
          {busy === "create"
            ? (<><span className="oauth-spinner" /> &nbsp;Backing up…</>)
            : (<><Icon name="plus" size={14} strokeWidth={2.2} /> &nbsp;Back up now</>)}
        </button>
      }
    >
      {error && (
        <div className="chat-brief__detail" style={{ color: "var(--danger)", padding: "4px 2px 10px" }}>
          <Icon name="alert-triangle" size={13} /> {error}
        </div>
      )}
      {list == null ? (
        <div className="chat-brief__detail" style={{ padding: "8px 2px" }}>Loading backups…</div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--fg-3)" }}>
          <Icon name="database" size={22} strokeWidth={1.6} />
          <div style={{ marginTop: 10, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 }}>No backups yet</div>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>Take a snapshot with “Back up now”.</div>
        </div>
      ) : (
        <div className="chat-brief__list">
          {list.map((b) => {
            const restoring = busy === ("restore:" + b.name);
            return (
              <div className="chat-brief__item chat-brief__item--static" key={b.name}>
                <span className="chat-brief__icon"><Icon name="database" size={14} /></span>
                <div className="chat-brief__body">
                  <span className="chat-brief__item-title chat-brief__item-title--mono">
                    <span className="chat-brief__titletext">{b.name}</span>
                  </span>
                </div>
                <div className="backup-row__actions">
                  <button className="icon-btn" title="Restore" onClick={() => restoreBackup(b.name)} disabled={!!busy}>
                    {restoring ? <span className="oauth-spinner" /> : <Icon name="rotate-ccw" size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

// ---- mock: the bundled offline demo (richer fixture) --------------------
function BackupsMock() {
  const backups = KRYSTAL_DATA.backups;
  return (
    <BriefCard
      icon="database"
      title="Backups"
      count={backups.length + " / 10 slots"}
      countTone="neutral"
      meta="Auto-snapshot every 6h · retained 14 days"
      action={<button className="fb-editor__btn"><Icon name="plus" size={14} strokeWidth={2.2} /> &nbsp;Back up now</button>}
    >
      <div className="chat-brief__list">
        {backups.map((b, i) => (
          <div className="chat-brief__item chat-brief__item--static" key={i}>
            <span className="chat-brief__icon"><Icon name="database" size={14} /></span>
            <div className="chat-brief__body">
              <span className="chat-brief__item-title chat-brief__item-title--mono">
                <span className="chat-brief__titletext">{b.name}</span>
              </span>
              <span className="chat-brief__detail">{b.when} · {b.size}</span>
            </div>
            <span className={"backup-row__tag backup-row__tag--" + b.type}>{b.type}</span>
            <div className="backup-row__actions">
              <button className="icon-btn" title="Restore"><Icon name="rotate-ccw" size={14} /></button>
              <button className="icon-btn" title="Download"><Icon name="download" size={14} /></button>
              <button className="icon-btn icon-btn--danger" title="Delete"><Icon name="trash-2" size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </BriefCard>
  );
}

function BackupsList({ server }) {
  return (LIVE && server) ? <BackupsLive server={server} /> : <BackupsMock />;
}

export { BackupsList };

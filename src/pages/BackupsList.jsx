import React from "react";
import { BriefCard } from "../components/BriefCard.jsx";
import { Icon } from "../components/Icon.jsx";
import { KRYSTAL_DATA } from "../lib/data.js";

// Backups list — one row per snapshot, with Restore / Download / Delete actions.
// Renders through the shared BriefCard shell (BriefCard), and each entry
// uses the same .chat-brief__item row style as the dashboard's Alerts and Recent
// activity cards: a rounded icon chip, a two-line title/detail body, and trailing
// affordances (here the type tag + action buttons). Rows stay neutral and
// non-clickable since a backup carries no severity.

function BackupsList() {
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

export { BackupsList };

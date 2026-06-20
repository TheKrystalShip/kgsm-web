import React from "react";
import { Icon } from "./Icon.jsx";

// BriefCard — the shared "briefing card" shell used across the panel. A titled
// header (icon + label + optional count chip + optional action) sitting over a
// bordered surface-1 card. The dashboard's Alerts (NeedsAttention) and Recent
// activity cards, plus the server-detail Backups list, all render through this
// one component so the card family stays visually identical and never drifts.
//
// The body is passed as children — a `.chat-brief__list` of rows, a
// `.chat-brief__empty` placeholder, or any custom content (e.g. a grid).
//
// Props:
//   icon, title            — header (icon + label)
//   count, countTone       — optional pill after the title; countTone "neutral"
//                            for a quiet grey chip, omit for the default accent
//   meta                   — optional muted sub-strip under the header (cadence,
//                            retention, "5 of 10 slots used", …)
//   onViewAll, viewAllLabel— convenience right-side affordance ("View all →")
//   action                 — custom header-right node; when provided it wins
//                            over onViewAll (pass null for nothing)
//   className, children
function BriefCard({ icon, title, count, countTone, meta, onViewAll, viewAllLabel = "View all", action, className = "", children }) {
  const right = action !== undefined
    ? action
    : (onViewAll
        ? (
          <button className="dash-section__more" onClick={onViewAll}>
            {viewAllLabel} <Icon name="arrow-right" size={11} strokeWidth={2.2} />
          </button>
        )
        : null);
  return (
    <div className={"chat-brief" + (className ? " " + className : "")}>
      <div className="chat-brief__head">
        <span className="chat-brief__title">
          {icon && <Icon name={icon} size={13} />} {title}
          {count != null && count !== false && (
            <span className={"chat-brief__count" + (countTone ? " chat-brief__count--" + countTone : "")}>{count}</span>
          )}
        </span>
        {right}
      </div>
      {meta && <div className="chat-brief__meta">{meta}</div>}
      {children}
    </div>
  );
}

export { BriefCard };

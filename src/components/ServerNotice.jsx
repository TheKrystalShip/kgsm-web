import React from "react";
import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";
import { serversStore } from "../lib/stores.js";

// ServerNotice — the operator-authored "server note" (MOTD). A sticky note for
// players: mods, rules, a heads-up before they join. Edited by anyone who can
// operate the host (single-tenant → same Discord crew); read-only for everyone
// else, and hidden entirely for players when empty (no dead box). The text is
// rendered as plain text (white-space preserved, no HTML) so a note can't smuggle
// markup onto a player-facing surface. Production persists via the backend, which
// also writes the audit entry — this prototype patches the store in place.
//
// Renders through the shared BriefCard shell so it sits in the same card family
// as Alerts / Recent activity / Backups and never drifts from them.

function ServerNotice({ server, canEdit }) {
  const notice = server.notice || "";
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(notice);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- resync the draft only when switching servers, not on every notice change (would clobber an in-progress edit)
  React.useEffect(() => { setDraft(server.notice || ""); setEditing(false); }, [server.id]);

  const save = () => {
    const v = draft.trim().slice(0, 600);
    // Production: PATCH /servers/:id { notice: v } — the backend writes the value
    // AND an audit event (motd.update, actor + timestamp) so a public-facing note
    // is always traceable. Here we patch the reactive store.
    if (serversStore) serversStore.patch(server.id, { notice: v });
    setEditing(false);
  };
  const cancel = () => { setDraft(notice); setEditing(false); };

  // Player + empty → render nothing at all.
  if (!canEdit && !notice) return null;

  if (editing) {
    return (
      <BriefCard icon="megaphone" title="Server note" className="motd" action={null}>
        <div className="motd__edit">
          <textarea
            className="motd__input"
            value={draft}
            maxLength={600}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything players should know before they join — mods to expect, rules, a splash-screen heads-up, where to get help…" />
          <div className="motd__foot">
            <span className="motd__count">{draft.length}/600</span>
            <div className="motd__actions">
              <button className="motd__btn" onClick={cancel}>Cancel</button>
              <button className="motd__btn motd__btn--primary" onClick={save}>
                <Icon name="check" size={13} strokeWidth={2.4} /> Save note
              </button>
            </div>
          </div>
        </div>
      </BriefCard>
    );
  }

  // Operator, no note yet → an invitation to add one.
  if (!notice && canEdit) {
    return (
      <BriefCard
        icon="megaphone" title="Server note" className="motd"
        action={
          <button className="dash-section__more" onClick={() => setEditing(true)}>
            <Icon name="plus" size={11} strokeWidth={2.4} /> Add note
          </button>
        }>
        <button className="motd__empty" onClick={() => setEditing(true)}>
          A heads-up players see before they join — mods, rules, a splash-screen note…
        </button>
      </BriefCard>
    );
  }

  // Display.
  return (
    <BriefCard
      icon="megaphone" title="Server note" className="motd"
      action={canEdit
        ? (
          <button className="dash-section__more" onClick={() => setEditing(true)}>
            <Icon name="pencil" size={11} strokeWidth={2.2} /> Edit
          </button>
        )
        : null}>
      <div className="motd__body">{notice}</div>
    </BriefCard>
  );
}

export { ServerNotice };

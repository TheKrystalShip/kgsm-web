import React from "react";
import { BriefCard } from "./BriefCard.jsx";
import { Icon } from "./Icon.jsx";
import { fmtRelative } from "../lib/formatting.js";
import { saveServerNote } from "../lib/stores.js";

// ServerNotice — the operator-authored "server note" (MOTD). A sticky note for
// players: mods, rules, a heads-up before they join. Edited by anyone who can
// operate the host (single-tenant → same Discord crew); read-only for everyone
// else, and hidden entirely for players when empty (no dead box). The text is
// rendered as plain text (white-space preserved, no HTML) so a note can't smuggle
// markup onto a player-facing surface.
//
// The note lives in the kgsm instance's own config, so it travels with the server
// and every surface reads one value. Saving goes through PUT/DELETE
// /servers/{id}/note (never the config PATCH, which refuses the note's keys) —
// the backend owns the encoding, stamps who wrote it, and emits the audit event.
// The byline below the text is that stamp, honestly blank for a note written by
// hand into the config file rather than through a surface.
//
// Renders through the shared BriefCard shell so it sits in the same card family
// as Alerts / Recent activity / Backups and never drifts from them.

const MAX = 600;

function ServerNotice({ server, canEdit }) {
  const notice = server.notice || "";
  const meta = server.note || null;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(notice);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- resync the draft only when switching servers, not on every notice change (would clobber an in-progress edit)
  React.useEffect(() => { setDraft(server.notice || ""); setEditing(false); setErr(null); }, [server.id]);

  const save = () => {
    const v = draft.trim().slice(0, MAX);
    if (v === notice) { setEditing(false); setErr(null); return; }
    setSaving(true);
    setErr(null);
    // An empty value is a CLEAR — saveServerNote routes it to DELETE, since the
    // backend deliberately refuses an empty write.
    saveServerNote(server.hostId, server.id, v).then(
      () => { setSaving(false); setEditing(false); },
      (e) => { setSaving(false); setErr(e?.message || "Could not save the note"); },
    );
  };
  const cancel = () => { setDraft(notice); setEditing(false); setErr(null); };

  // Player + empty → render nothing at all.
  if (!canEdit && !notice) return null;

  if (editing) {
    return (
      <BriefCard icon="megaphone" title="Server note" className="motd" action={null}>
        <div className="motd__edit">
          <textarea
            className="motd__input"
            value={draft}
            maxLength={MAX}
            autoFocus
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Anything players should know before they join — mods to expect, rules, a splash-screen heads-up, where to get help…" />
          {err && <div className="motd__error">{err}</div>}
          <div className="motd__foot">
            <span className="motd__count">{draft.length}/{MAX}</span>
            <div className="motd__actions">
              <button className="motd__btn" onClick={cancel} disabled={saving}>Cancel</button>
              <button className="motd__btn motd__btn--primary" onClick={save} disabled={saving}>
                <Icon name="check" size={13} strokeWidth={2.4} /> {saving ? "Saving…" : "Save note"}
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
      <NoticeByline meta={meta} />
    </BriefCard>
  );
}

// "edited by X · 2h ago" — only what the backend actually recorded. A note with no
// stored author (hand-written into the instance config) shows no byline at all
// rather than a guessed one, and a timestamp we can't parse is simply omitted.
function NoticeByline({ meta }) {
  if (!meta || !meta.updatedBy) return null;
  const when = meta.updatedAt ? new Date(meta.updatedAt) : null;
  const ago = when && !isNaN(when) ? fmtRelative(when) : null;
  // The actor is stored as the audit's principal string ("discord:someone").
  const who = meta.updatedBy.replace(/^discord:/, "");
  return (
    <div className="motd__byline">
      edited by {who}{ago ? " · " + ago : ""}
    </div>
  );
}

export { ServerNotice };

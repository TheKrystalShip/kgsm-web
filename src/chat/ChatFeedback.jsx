// ChatFeedback — the thumbs under an assistant answer. The only place the SPA asks whether a reply was
// any GOOD; everything else it shows about a turn (how long it took, which tools it called, whether it
// errored) describes how the answer was produced, not whether it helped.
//
// Two rules shape the interaction:
//
//   * The vote lands on click, before any note is written. A note is worth more than a rating, but a
//     note form that had to be submitted for the vote to count would lose the vote every time someone
//     changed their mind about explaining — and the rating is the part that is always available.
//   * The note is offered on a thumbs-DOWN only, and is skippable. "What went wrong" is the sentence a
//     tuning pass acts on; there is no equivalent question for an answer that worked.
//
// Read-only mode renders the recorded verdict as a plain badge with no controls, because it is used
// where the reader is not the person who received the answer — a reviewer's opinion of someone else's
// conversation is a different fact, and this surface does not collect it.

import React from "react";

import { Icon } from "../components/Icon.jsx";

const NOTE_MAX = 400;

function ChatFeedback({ turnId, feedback, onRate, readOnly }) {
  // No id means the turn was never persisted, so there is nothing to attach a verdict to. Showing
  // controls that cannot record anything would be worse than showing none.
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const rating = feedback ? feedback.rating : null;

  if (!turnId) return null;

  if (readOnly) {
    if (!rating) return null;
    return (
      <div className="chat-fb chat-fb--ro">
        <span className={"chat-fb__badge chat-fb__badge--" + rating}>
          <Icon name={rating === "up" ? "thumbs-up" : "thumbs-down"} size={12} strokeWidth={2.2} />
          {rating === "up" ? "Marked helpful" : "Marked unhelpful"}
        </span>
        {feedback.note && <span className="chat-fb__note">“{feedback.note}”</span>}
      </div>
    );
  }

  const rate = (next) => {
    // Clicking the thumb that is already lit withdraws the verdict — the same affordance that set it.
    const withdrawing = rating === next;
    const value = withdrawing ? null : next;
    onRate(value, null);
    setNoteOpen(!withdrawing && next === "down");
    setNote("");
  };

  const saveNote = () => {
    onRate("down", note.trim() || null);
    setNoteOpen(false);
  };

  return (
    <div className="chat-fb">
      <div className="chat-fb__row">
        <button
          type="button"
          className={"chat-fb__btn" + (rating === "up" ? " is-on is-up" : "")}
          onClick={() => rate("up")}
          title={rating === "up" ? "Undo" : "This answer helped"}
          aria-pressed={rating === "up"}
          aria-label="This answer helped">
          <Icon name="thumbs-up" size={13} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className={"chat-fb__btn" + (rating === "down" ? " is-on is-down" : "")}
          onClick={() => rate("down")}
          title={rating === "down" ? "Undo" : "This answer didn’t help"}
          aria-pressed={rating === "down"}
          aria-label="This answer didn’t help">
          <Icon name="thumbs-down" size={13} strokeWidth={2.2} />
        </button>
        {feedback && feedback.note && !noteOpen && (
          <span className="chat-fb__note">“{feedback.note}”</span>
        )}
        {rating === "down" && !noteOpen && !(feedback && feedback.note) && (
          <button type="button" className="chat-fb__link" onClick={() => setNoteOpen(true)}>
            Say what went wrong
          </button>
        )}
      </div>

      {noteOpen && (
        <div className="chat-fb__note-form">
          <input
            className="chat-fb__input"
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            autoFocus
            placeholder="What went wrong? (optional)"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); saveNote(); }
              // Escape abandons the note, not the vote — the thumbs-down is already recorded.
              if (e.key === "Escape") { e.preventDefault(); setNoteOpen(false); setNote(""); }
            }} />
          <button type="button" className="chat-fb__save" onClick={saveNote} disabled={!note.trim()}>
            Send
          </button>
          <button type="button" className="chat-fb__link" onClick={() => { setNoteOpen(false); setNote(""); }}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

export { ChatFeedback };

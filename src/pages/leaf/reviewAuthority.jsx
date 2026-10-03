// reviewAuthority — how the two assistant review tabs read a failed request, shared so they cannot
// tell the operator two different stories about the same failure.
//
// The leaf's review surface is gated on `assistant:conversations.read-any`, evaluated from the
// assistant's replica of the cluster's authority. A replica the assistant cannot read is therefore a
// way for these tabs to fail that has nothing to do with the caller's access — and rendering it as
// "the assistant didn't answer" sends someone to check a service that is running.
//
// So the leaf reports that case apart, as 502 + `authority_unavailable`, and this module is where the
// SPA agrees to keep the distinction: an outage says "couldn't check" and offers a retry, a denial
// says what it is, and only a genuinely unexplained failure gets the generic message.

import { Icon } from "@thekrystalship/krystal-ui";

// The leaf's wire code for "the access could not be checked". Matches AssistantActionFilter's
// UnavailableCode; it is a stable part of that contract precisely so this branch can exist.
const AUTHORITY_UNAVAILABLE = "authority_unavailable";

/// Classify a rejected review request into the state its tab should render.
///
/// The envelope code is what's checked, not the 502 alone: a reverse proxy in front of a leaf that is
/// genuinely down answers 502 as well, with no JSON body behind it, and that one really is "the
/// assistant isn't answering".
function reviewErrorState(e) {
  if (e && e.code === 404) return "none";
  if (e && e.envCode === AUTHORITY_UNAVAILABLE) return "unavailable";
  if (e && e.code === 403) return "forbidden";
  return "error";
}

/// The assistant couldn't read its replica of the cluster's authority, so it couldn't check the
/// caller's access. Says which thing failed and offers the retry.
function ReviewAuthorityUnavailable({ onRetry }) {
  return (
    <div className="chat-brief">
      <div className="chat-brief__empty chat-brief__empty--neutral">
        <div className="chat-brief__empty-title">Couldn’t check your access</div>
        <div className="chat-brief__empty-sub">
          The assistant couldn’t read who may do what.
        </div>
        {onRetry && (
          <button className="chip" style={{ marginTop: 10 }} onClick={onRetry}>
            <Icon name="rotate-cw" size={14} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

/// A real denial: the caller is authenticated, and the answer is no. Named apart from the outage so
/// neither can be mistaken for the other.
function ReviewForbidden() {
  return (
    <div className="chat-brief">
      <div className="chat-brief__empty chat-brief__empty--neutral">
        <div className="chat-brief__empty-title">You don’t have access to this</div>
        <div className="chat-brief__empty-sub">
          Needs assistant:conversations.read-any
        </div>
      </div>
    </div>
  );
}

export { AUTHORITY_UNAVAILABLE, ReviewAuthorityUnavailable, ReviewForbidden, reviewErrorState };

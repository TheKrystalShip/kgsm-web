// AnchorLogs — this anchor's journal, live, read from the anchor.
//
// A node's journal is read and followed by the API running on that node. An anchor has no node above
// it — on the ordinary topology not even one beside it — so it serves both halves itself, and this
// consumes them the way every other log surface here does: hydrate the scrollback over REST, then
// apply lines from the stream as they happen.
//
// It renders through the same ConsoleView as a leaf's journal, the host log and the game console, so
// a journal reads identically wherever it is opened — same gutter, same levels, same find, same
// pop-out.
//
// The live pill follows the STREAM, not the fetch. A tail that has stopped is shown as stopped: an
// idle journal and a dropped connection look identical on screen, and only one of them means what is
// on screen is current.

import React from "react";

import { ConsoleView } from "../../components/ConsoleView.jsx";
import { followLogs, readLogs } from "../../lib/anchor.js";
import { sessionStore } from "../../lib/sessionStore.js";

// What one console holds. The journal on disk is the durable record — a viewer that has been open
// for a day does not need a day of lines in memory, and a reload re-reads the scrollback anyway.
const MAX_LINES = 3000;

function AnchorLogs({ anchor }) {
  const [lines, setLines] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [live, setLive] = React.useState(false);

  React.useEffect(() => {
    const token = sessionStore.tokenOf();
    if (!anchor || !token) { setError("This browser holds no session for the anchor."); return undefined; }

    let alive = true;
    let follow = null;
    setError(null);

    // Scrollback first, then the follow. The other way round drops whatever arrives while the read
    // is in flight, which is exactly the window a person is watching when something goes wrong.
    readLogs(anchor, token).then(
      (rows) => {
        if (!alive) return;
        setLines(rows);
        follow = followLogs(anchor, token, (line) => {
          if (!alive) return;
          setLines((prev) => {
            const next = [...(prev || []), line];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        });
        setLive(true);
        // The stream ending is a fact worth showing. It ends when the journal becomes unreadable,
        // when the anchor restarts, or when the connection drops — and in all three what is on
        // screen has stopped being current.
        follow.stopped.catch(() => {}).finally(() => { if (alive) setLive(false); });
      },
      (e) => {
        if (!alive) return;
        setLines([]);
        // 503 is the anchor saying it could not read its own journal, which is a different thing
        // from a unit that has logged nothing — and the two must not read alike.
        setError(e && e.status === 503
          ? "This anchor could not read its own journal on that host."
          : "Couldn’t read the anchor’s logs.");
      });

    return () => { alive = false; if (follow) follow.stop(); };
  }, [anchor]);

  if (error) {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">No journal</div>
          <div className="chat-brief__empty-sub">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <ConsoleView
      title="Journal"
      icon="scroll-text"
      lines={lines || []}
      count={(lines || []).length}
      loading={lines === null}
      pill={{ live, label: live ? "live" : "not following" }}
      emptyText="— nothing logged —" />
  );
}

export { AnchorLogs };

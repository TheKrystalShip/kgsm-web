// AnchorLogs — this anchor's journal, read from the anchor.
//
// A node's journal is read by the API running on that node. An anchor has no node above it, so it
// reads its own and serves it in the shape every KGSM log surface renders — which is why this
// renders through the same ConsoleView as a leaf's journal and the game console, and a journal reads
// identically wherever it is opened.
//
// Read on demand rather than followed. A leaf's journal streams because the API holds a socket to
// the node and can push; this is a cross-origin read against a daemon that has no stream to offer,
// so the honest surface is one that says when it last looked and can be asked again.

import React from "react";

import { ConsoleView } from "../../components/ConsoleView.jsx";
import { Icon } from "../../components/Icon.jsx";
import { readLogs } from "../../lib/anchor.js";
import { sessionStore } from "../../lib/sessionStore.js";

function AnchorLogs({ anchor }) {
  const [lines, setLines] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    const token = sessionStore.tokenOf();
    if (!anchor || !token) { setError("This browser holds no session for the anchor."); return; }
    setBusy(true);
    setError(null);
    readLogs(anchor, token).then(
      (rows) => { setLines(rows); setBusy(false); },
      (e) => {
        setBusy(false);
        setLines([]);
        // The anchor says 503 when journalctl is not there or the read was refused, which is a
        // different thing from a unit that has logged nothing — and the two must not read alike.
        setError(e && e.status === 503
          ? "This anchor could not read its own journal on that host."
          : "Couldn’t read the anchor’s logs.");
      });
  }, [anchor]);

  React.useEffect(() => { load(); }, [load]);

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

  if (lines === null) {
    return <div className="settings-users__empty">Loading…</div>;
  }

  if (!lines.length) {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Nothing logged</div>
          <div className="chat-brief__empty-sub">This anchor’s journal is empty on that host.</div>
        </div>
      </div>
    );
  }

  return (
    <ConsoleView
      title="Journal"
      icon="scroll-text"
      lines={lines}
      count={lines.length}
      /* The console's header slot. This surface is read on demand rather than followed, so asking
         again is the control it needs where a leaf's journal has a pin. */
      pin={(
        <button type="button" className="settings-link__btn" disabled={busy} onClick={load}>
          <Icon name="refresh-cw" size={13} /> {busy ? "Reading…" : "Refresh"}
        </button>
      )} />
  );
}

export { AnchorLogs };

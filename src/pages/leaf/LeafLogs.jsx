// LeafLogs — one leaf's journal, on the leaf's own page. The host's Logs tab merges every leaf and
// offers a source picker; this one is already scoped by the page it sits on, so it asks journald for
// that single source and shows it with no picker to set.
//
// It renders through the same ConsoleView as the host logs and the game console, so a journal reads
// identically wherever you open it — same gutter, same levels, same full-screen pop-out.

import React from "react";

import { ConsoleView } from "../../components/ConsoleView.jsx";
import { Icon } from "../../components/Icon.jsx";
import { useStore } from "../../lib/store.js";
import { leafLogsStore, subscribeLeafLogs } from "../../lib/stores.js";

function LeafLogs({ hostId, leafId, svc }) {
  const list = useStore(leafLogsStore, s => s.list);
  const status = useStore(leafLogsStore, s => s.status);
  const error = useStore(leafLogsStore, s => s.error);
  const forHost = useStore(leafLogsStore, s => s.hostId);
  const forLeaf = useStore(leafLogsStore, s => s.leaf);

  React.useEffect(() => {
    if (!hostId || !leafId) return undefined;
    leafLogsStore.refresh(hostId, leafId).catch(() => {});
    return subscribeLeafLogs(hostId, leafId);
  }, [hostId, leafId]);

  const ready = forHost === hostId && forLeaf === leafId;
  const lines = ready && Array.isArray(list) ? list.slice().reverse() : [];
  const label = (svc && svc.displayName) || leafId;

  if (ready && lines.length) {
    return (
      <ConsoleView
        title={label + " · journal"}
        icon="scroll-text"
        lines={lines}
        count={lines.length}
        pill={{ label: "Live", live: true }}
        resetKey={hostId + "/" + leafId} />
    );
  }

  // A host whose log source map is configured by hand can leave a leaf out of it — the API answers
  // 400 for a source it doesn't carry, which is a different fact from "this leaf has been quiet".
  const unmapped = ready && status === "error" && error && error.status === 400;
  const phase = !ready || status === "loading" ? "loading"
    : unmapped ? "unmapped"
      : status === "error" ? "error" : "quiet";

  const TITLE = {
    loading: "Loading " + label + " logs…",
    unmapped: "No journal source for " + label,
    error: label + " logs unavailable",
    quiet: "No recent log lines",
  };
  const SUB = {
    loading: "Reading this leaf’s systemd journal" + (svc && svc.unit ? " (" + svc.unit + ")." : "."),
    unmapped: "This host doesn’t publish a log source for this leaf, so there is no journal to read.",
    error: "Couldn’t read the journal — the host’s log source didn’t respond.",
    quiet: label + " hasn’t logged anything in the recent window.",
  };
  const TAG = { loading: "loading", unmapped: "no log source", error: "unavailable", quiet: "quiet" };

  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="scroll-text" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">{TITLE[phase]}</div>
      <div className="proc-unavailable__sub">{SUB[phase]}</div>
      <span className="proc-unavailable__tag"><Icon name="activity" size={12} /> {TAG[phase]}</span>
    </div>
  );
}

export { LeafLogs };

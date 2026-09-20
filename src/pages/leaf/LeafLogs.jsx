// LeafLogs — one leaf's journal, read through the node that runs it. The host's Logs tab merges
// every leaf and offers a source picker; this one is already scoped by what it was bound to, so it
// asks journald for that single source and shows it with no picker to set.
//
// The rendering is `ComponentJournal`, which is what every component's journal is drawn with. What
// this file adds is the read: a leaf's journal comes off a KEYED store, which is what lets it be
// pinned — two of these can be on screen at once, two leaves side by side on the dashboard or one
// pinned while its own page is open, sharing one hydrate and one live subscription per (host, leaf)
// rather than fighting over a single slot. See lib/keyedResource.js.

import { PinButton } from "../../components/widgets/PinButton.jsx";
import { useKeyedResource } from "../../lib/keyedResource.js";
import { useStore } from "../../lib/store.js";
import { leafLogsKey, leafLogsStore, subscribeLeafLogs } from "../../lib/stores.js";
import { ComponentJournal } from "../component/ComponentJournal.jsx";

function LeafLogs({ hostId, leafId, svc }) {
  const key = hostId && leafId ? leafLogsKey(hostId, leafId) : null;
  const entry = useStore(leafLogsStore, s => (key ? s.byKey[key] : null));

  useKeyedResource(
    key,
    () => leafLogsStore.refresh(hostId, leafId).catch(() => {}),
    () => subscribeLeafLogs(hostId, leafId));

  const label = (svc && svc.displayName) || leafId;
  const ready = !!entry;
  const lines = ready && Array.isArray(entry.list) ? entry.list.slice().reverse() : [];

  // A host whose log source map is configured by hand can leave a leaf out of it — the API answers
  // 400 for a source it doesn't carry, which is a different fact from "this leaf has been quiet".
  const unmapped = ready && entry.status === "error" && entry.error && entry.error.status === 400;
  const status = !ready || entry.status === "loading" ? "loading"
    : lines.length ? "ready"
      : unmapped ? "unmapped"
        : entry.status === "error" ? "error" : "quiet";

  return (
    <ComponentJournal
      label={label}
      unit={svc && svc.unit}
      lines={lines}
      status={status}
      live
      pin={<PinButton type="leaf.logs" params={{ hostId, leafId }} label={label + "'s journal"} />}
      resetKey={hostId + "/" + leafId} />
  );
}

export { LeafLogs };
export default LeafLogs;

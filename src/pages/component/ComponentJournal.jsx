// ComponentJournal — one component's journal, however the lines reached this browser.
//
// The body is the same either way and takes the lines already in hand: a node reads its leaves'
// journals and follows them, a component with no node above it reads its own, and neither fact
// changes what a log looks like. It renders through the same ConsoleView as the host logs and the
// game console, so a journal reads identically wherever it is opened — same gutter, same levels,
// same find, same pop-out.
//
// The live pill follows the STREAM, not the fetch. A tail that has stopped is shown as stopped: an
// idle journal and a dropped connection look identical on screen, and only one of them means what is
// on screen is current.

import React from "react";

import { ConsoleView } from "../../components/ConsoleView.jsx";
import { Icon } from "../../components/Icon.jsx";

// What one console holds. The journal on disk is the durable record — a viewer that has been open
// for a day does not need a day of lines in memory, and a reload re-reads the scrollback anyway.
const MAX_LINES = 3000;

/**
 * The journal of a component that serves its own, read at its address.
 *
 * Scrollback first, then the follow. The other way round drops whatever arrives while the read is in
 * flight, which is exactly the window a person is watching when something goes wrong.
 */
function useServedJournal(surface) {
  const [lines, setLines] = React.useState(null);
  const [live, setLive] = React.useState(false);
  const [error, setError] = React.useState(null);

  const key = surface ? surface.key : null;
  const ref = React.useRef(surface);
  ref.current = surface;

  React.useEffect(() => {
    if (!key) { setError("no_surface"); return undefined; }

    let alive = true;
    let follow = null;
    setError(null); setLines(null); setLive(false);

    ref.current.readLogs().then(
      (rows) => {
        if (!alive) return;
        setLines(rows);
        follow = ref.current.followLogs((line) => {
          if (!alive) return;
          setLines((prev) => {
            const next = [...(prev || []), line];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        });
        setLive(true);
        // The stream ending is a fact worth showing. It ends when the journal becomes unreadable,
        // when the component restarts, and when the connection drops — and in all three what is on
        // screen has stopped being current.
        follow.stopped.catch(() => {}).finally(() => { if (alive) setLive(false); });
      },
      (e) => {
        if (!alive) return;
        setLines([]);
        // 503 is the component saying it could not read its own journal, which is a different thing
        // from a unit that has logged nothing — and the two must not read alike.
        setError(e && e.status === 503 ? "unreadable" : "failed");
      });

    return () => { alive = false; if (follow) follow.stop(); };
  }, [key]);

  return {
    lines,
    live,
    error,
    status: error ? "error" : lines === null ? "loading" : lines.length ? "ready" : "quiet",
  };
}

const TITLE = {
  loading: (l) => "Loading " + l + " logs…",
  unmapped: (l) => "No journal source for " + l,
  error: (l) => l + " logs unavailable",
  quiet: () => "No recent log lines",
};

// Why there is nothing on screen. `unreadable` is the component answering that it could not read its
// own journal on that host, which is not the same fact as a quiet unit and does not read like one.
const SUB = {
  loading: (l, unit) => "Reading this component’s systemd journal" + (unit ? " (" + unit + ")." : "."),
  unmapped: () => "This host doesn’t publish a log source for this component, so there is no journal to read.",
  unreadable: () => "The component could not read its own journal on that host.",
  failed: () => "Couldn’t read the journal — the source didn’t respond.",
  error: () => "Couldn’t read the journal — the source didn’t respond.",
  quiet: (l) => l + " hasn’t logged anything in the recent window.",
};

const TAG = { loading: "loading", unmapped: "no log source", error: "unavailable", quiet: "quiet" };

/**
 * @param status  loading | ready | quiet | unmapped | error
 * @param error   which error, where the caller knows: `unreadable` | `failed` | `no_surface`.
 * @param live    whether a follow is currently carrying lines, which drives the pill.
 * @param pin     the pin control, where this journal can be pinned. A component reached at its own
 *                address has no pinnable widget, so it passes none.
 */
function ComponentJournal({ label, unit, lines, status, error, live = true, pin = null, resetKey }) {
  const name = label || "This component";

  if (status === "ready") {
    return (
      <ConsoleView
        title={name + " · journal"}
        icon="scroll-text"
        lines={lines}
        count={lines.length}
        pill={{ live, label: live ? "Live" : "not following" }}
        pin={pin}
        resetKey={resetKey} />
    );
  }

  // A component that has been quiet is exactly the one somebody wants in front of them, so the pin
  // belongs on this branch too. It is dropped only for `unmapped`, where there is no journal to
  // follow at all and pinning would add a widget that can never say anything.
  const sub = (error && SUB[error]) || SUB[status] || SUB.error;

  return (
    <div className="proc-unavailable">
      <span className="proc-unavailable__icon"><Icon name="scroll-text" size={26} strokeWidth={1.9} /></span>
      <div className="proc-unavailable__title">{(TITLE[status] || TITLE.error)(name)}</div>
      <div className="proc-unavailable__sub">{sub(name, unit)}</div>
      <span className="proc-unavailable__tag"><Icon name="activity" size={12} /> {TAG[status] || TAG.error}</span>
      {pin && status !== "unmapped" && <div className="proc-unavailable__pin">{pin}</div>}
    </div>
  );
}

export { ComponentJournal, useServedJournal };
export default ComponentJournal;

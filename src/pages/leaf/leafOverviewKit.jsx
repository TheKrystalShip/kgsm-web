// leafOverviewKit — the parts every leaf Overview needs and none of them should own: the fetch, the
// four states that fetch can land in, and the label/value fact rows.
//
// A leaf Overview is always the same shape — ask the leaf one question, then render the answer or say
// honestly why there isn't one — and the interesting part is only ever the last step. Everything before
// it lives here, so six bodies differ in what they show rather than in how they load, and so a leaf that
// can't answer says the same thing on every page.
//
// The four states are kept apart on purpose, because they send an operator to four different places:
// `loading` is nothing yet, `none` is a leaf this host doesn't serve, `error` is a leaf that wouldn't
// answer, and `ready` with empty data is a leaf that answered "nothing" — which is a measurement, not a
// failure, and each body words that one for itself.

import React from "react";

import { Icon } from "../../components/Icon.jsx";

/// The fetch behind a leaf Overview, with its own retry and optional polling.
///
/// `fetcher(hostId, leafId)` resolves the leaf's payload, or null for "this host doesn't serve it".
/// A rejection lands in `error` carrying the reason, so a body can tell a 403 from a leaf that is down.
///
/// `pollMs` re-fetches on an interval. Pass it when the payload contains something whose MEANING decays
/// with wall-clock — the monitor's newest-frame timestamp is the live case: rendering its age against a
/// clock that ticks while the timestamp behind it stays frozen turns a healthy sampler into a fake
/// "stalled" warning within a minute of opening the page. A payload of absolute future times (the
/// scheduler's next-fire) does not need this; a local clock tick is enough and costs no request.
///
/// A poll never shows the loading state — the page already has an answer, and flashing a spinner over
/// good data every few seconds is worse than showing it a moment stale. A poll that FAILS is likewise
/// swallowed: the last good payload stands rather than being replaced by an error for one bad tick.
/// Only the initial load and an explicit `reload()` can move the page into loading or error.
///
/// The fetcher is deliberately NOT a dependency: every call site passes an inline arrow (it closes over
/// the store function it needs), which would be a new identity on every render and re-fetch forever.
function useLeafResource(hostId, leafId, fetcher, pollMs = 0) {
  const [state, setState] = React.useState("loading");
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Held in a ref so the polling effect can call the current fetcher without taking it as a dependency
  // (and therefore without restarting the interval on every render).
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    if (!hostId || !leafId) return undefined;
    let cancelled = false;
    setState("loading");
    setError(null);
    Promise.resolve()
      .then(() => fetcherRef.current(hostId, leafId))
      .then(
        (d) => { if (!cancelled) { setData(d); setState(d == null ? "none" : "ready"); } },
        (e) => { if (!cancelled) { setError(e); setState("error"); } },
      );
    return () => { cancelled = true; };
  }, [hostId, leafId, reloadKey]);

  React.useEffect(() => {
    if (!pollMs || !hostId || !leafId) return undefined;
    let cancelled = false;
    const id = setInterval(() => {
      Promise.resolve()
        .then(() => fetcherRef.current(hostId, leafId))
        .then(
          (d) => { if (!cancelled && d != null) setData(d); },
          () => { /* a single failed tick keeps the last good payload — see the note above */ },
        );
    }, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [hostId, leafId, pollMs]);

  const reload = React.useCallback(() => setReloadKey(k => k + 1), []);
  return { state, data, error, reload };
}

/// The card-level placeholder the states below are all built from — the same `chat-brief` shell the rest
/// of the page uses, so a leaf that can't answer still looks like part of the page rather than a hole
/// punched in it.
function LeafNotice({ title, children, onRetry, retryLabel = "Try again" }) {
  return (
    <div className="chat-brief">
      <div className="chat-brief__empty chat-brief__empty--neutral">
        <div className="chat-brief__empty-title">{title}</div>
        {children && <div className="chat-brief__empty-sub">{children}</div>}
        {onRetry && (
          <button className="chip" style={{ marginTop: 10 }} onClick={onRetry}>
            <Icon name="rotate-cw" size={14} /> {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/// Nothing has come back yet. Says what is being read rather than "Loading…", because on this page the
/// answer to "loading what?" is the only part that differs between six otherwise identical waits.
function LeafLoading({ what }) {
  return <div className="chat-brief"><div className="chat-brief__empty">{what}</div></div>;
}

/// The leaf answered, and the answer is that it isn't here. Not a failure — this host simply doesn't
/// serve it, and no amount of retrying changes that, so this state offers none.
function LeafAbsent({ leafId, what }) {
  return (
    <LeafNotice title={"No " + leafId + " on this node"}>
      This host doesn’t serve {what}, so there is nothing to report.
    </LeafNotice>
  );
}

/// The leaf was asked and wouldn't answer. Distinct from absent in the one way that matters: this one is
/// worth trying again, and the leaf being up while its data isn't readable is a real state worth naming
/// rather than flattening into "unavailable".
function LeafUnreadable({ what, error, onRetry }) {
  const detail = error && (error.userMessage || error.message);
  return (
    <LeafNotice title={what + " unavailable"} onRetry={onRetry}>
      {detail || "This host didn’t answer. The leaf may be restarting — this usually clears in a moment."}
    </LeafNotice>
  );
}

/// The label/value rows the System tab established, shared so an Overview that has a handful of facts to
/// state renders them identically rather than inventing a second fact layout beside the first.
///
/// A row is [label, value, hint?] — the hint explains a value that would otherwise invite the wrong
/// reading, and is the reason this is a component rather than a `<dl>`.
function LeafFacts({ rows }) {
  return (
    <div className="leaf-facts">
      {rows.filter(Boolean).map(([label, value, hint]) => (
        <div className="leaf-facts__row" key={label}>
          <span className="leaf-facts__label">{label}</span>
          <span className="leaf-facts__value">{value}</span>
          {hint && <span className="leaf-facts__hint">{hint}</span>}
        </div>
      ))}
    </div>
  );
}

/// A row in a BriefCard's list — the "needs a look" idiom the assistant Overview established, lifted out
/// so every leaf's attention lane looks the same and reads the same way: a tone, an icon, what happened,
/// and what about it.
function LeafBriefItem({ tone = "info", icon, title, detail, onClick, action }) {
  return (
    <div className={"chat-brief__item chat-brief__item--" + tone} onClick={onClick}>
      <span className="chat-brief__icon"><Icon name={icon} size={14} /></span>
      <div className="chat-brief__body">
        <span className="chat-brief__item-title"><span className="chat-brief__titletext">{title}</span></span>
        {detail && <span className="chat-brief__detail">{detail}</span>}
      </div>
      {action && (
        <span className="chat-brief__ask">{action} <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
      )}
    </div>
  );
}

/// The empty state INSIDE a card whose leaf answered normally — "we asked, and the answer is none".
/// Separate from the page-level states above because it is a measurement, and the wording is the card's.
function LeafBriefEmpty({ title, children }) {
  return (
    <div className="chat-brief__empty chat-brief__empty--neutral">
      <div className="chat-brief__empty-title">{title}</div>
      {children && <div className="chat-brief__empty-sub">{children}</div>}
    </div>
  );
}

export {
  useLeafResource,
  LeafNotice, LeafLoading, LeafAbsent, LeafUnreadable,
  LeafFacts, LeafBriefItem, LeafBriefEmpty,
};

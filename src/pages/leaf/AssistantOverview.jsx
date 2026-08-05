// AssistantOverview — the assistant leaf's Overview: how this assistant is actually behaving, ordered
// by how often a panel would make you do something about it.
//
// Everything shown is DERIVED FROM THE CONVERSATION LOG by the leaf and relayed verbatim. Nothing is
// computed here beyond formatting, and nothing is filled in: the leaf distinguishes a count (0 because
// it did not happen) from an unmeasured distribution (null because nothing was measured), and this
// surface renders the second as "—". A zero median would read as "instant", which would be a
// fabricated measurement.
//
// The panel order is a judgement about this corpus, not a default: turn outcomes are overwhelmingly
// clean, so an error count leads with a 0 and tells you nothing. What varies — and what an operator
// can act on — is answer time and tool behaviour.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { Icon } from "../../components/Icon.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { fetchAssistantConversations, fetchAssistantReviewUsers, fetchAssistantStats } from "../../lib/stores.js";

// A duration a person can read at a glance. Null in → "—" out; never 0.
function fmtMs(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return Math.round(ms) + " ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + " s";
  // Keeps a decimal past the minute mark: rounding 63.6s to "1 min" throws away the part that made
  // it worth showing, and a tail figure is the whole reason this column exists.
  return (ms / 60000).toFixed(1) + " min";
}

function pct(n) {
  return n == null ? "—" : n + "%";
}

// Turns that reached a final reply, as a share of every recorded turn. Null (not 0) for an empty
// corpus — "0% clean" would be a damning claim about an assistant nobody has talked to.
function cleanPercent(stats) {
  if (!stats || !stats.turns) return null;
  return Math.round(stats.okTurns / stats.turns * 100);
}

function AssistantOverview({ hostId, onReviewConversation }) {
  const [stats, setStats] = React.useState(null);
  const [state, setState] = React.useState("loading");
  const [recent, setRecent] = React.useState([]);

  React.useEffect(() => {
    if (!hostId) return undefined;
    let cancelled = false;
    setState("loading");
    fetchAssistantStats(hostId).then(
      (s) => { if (!cancelled) { setStats(s); setState(s ? "ready" : "none"); } },
      (e) => { if (!cancelled) setState(e && e.code === 404 ? "none" : "error"); },
    );
    return () => { cancelled = true; };
  }, [hostId]);

  // The recency lane. Built by asking the busiest few people for their conversations and taking the
  // newest across them: the review endpoints are per-user by design (a reviewer picks a person), so
  // "latest overall" is a client-side merge rather than an endpoint that does not exist.
  React.useEffect(() => {
    if (!hostId) return undefined;
    let cancelled = false;
    fetchAssistantReviewUsers(hostId).then(async (users) => {
      const busiest = [...users]
        .sort((a, b) => (parseTs(b.lastActivityAt) || 0) - (parseTs(a.lastActivityAt) || 0))
        .slice(0, 4);
      const lists = await Promise.all(busiest.map(u =>
        fetchAssistantConversations(hostId, u.userId)
          .then(cs => cs.map(c => ({ ...c, user: u })))
          .catch(() => [])));
      if (cancelled) return;
      setRecent(lists.flat()
        .sort((a, b) => (parseTs(b.lastActivityAt) || 0) - (parseTs(a.lastActivityAt) || 0))
        .slice(0, 5));
    }).catch(() => { /* the lane is additive — the page stands without it */ });
    return () => { cancelled = true; };
  }, [hostId]);

  if (state === "loading") {
    return <div className="chat-brief"><div className="chat-brief__empty">Reading the assistant’s conversation log…</div></div>;
  }
  if (state === "none") {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">No assistant on this node</div>
          <div className="chat-brief__empty-sub">This host doesn’t serve an assistant, so there is no conversation log to summarize.</div>
        </div>
      </div>
    );
  }
  if (state === "error" || !stats) {
    return (
      <div className="chat-brief">
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Statistics unavailable</div>
          <div className="chat-brief__empty-sub">The assistant didn’t answer for its conversation statistics.</div>
        </div>
      </div>
    );
  }

  const clean = cleanPercent(stats);
  const invented = stats.tools.filter(t => !t.known);
  const inventedCalls = invented.reduce((n, t) => n + t.calls, 0);
  const failedToolCalls = stats.tools.reduce((n, t) => n + t.failedCalls, 0);
  // An invented tool's call also lands in failedCalls (the dispatcher answers "not a known tool" with
  // an Error: string), so the two are reported apart rather than summed — counting it twice would
  // overstate the problem, and folding it in would hide the more serious of the two.
  const inventedFailures = invented.reduce((n, t) => n + t.failedCalls, 0);
  const plainToolErrors = Math.max(0, failedToolCalls - inventedFailures);
  const toolProblems = plainToolErrors + inventedCalls;
  const runtime = stats.runtime;

  // "Needs a look" — the tuning queue. Deliberately built from what the ROLL-UP can prove, so every
  // row names a measured problem rather than a hunch.
  const attention = [];
  if (invented.length > 0) {
    attention.push({
      key: "invented",
      tone: "danger", icon: "circle-x",
      title: invented.map(t => t.name).join(", "),
      detail: "called a tool that does not exist — the prompt implies a capability it doesn’t have",
    });
  }
  for (const t of stats.tools.filter(t => t.failedCalls > 0).slice(0, 3)) {
    attention.push({
      key: "failed:" + t.name,
      tone: "warn", icon: "wrench",
      title: t.name,
      detail: t.failedCalls + " of " + t.calls + " call" + (t.calls === 1 ? "" : "s") + " returned an error",
    });
  }
  const slowest = [...stats.tools].filter(t => t.medianMs != null).sort((a, b) => b.medianMs - a.medianMs)[0];
  if (slowest && slowest.medianMs >= 10000) {
    attention.push({
      key: "slow:" + slowest.name,
      tone: "warn", icon: "timer",
      title: slowest.name,
      detail: "median " + fmtMs(slowest.medianMs) + " — it dominates the answer-time tail",
    });
  }
  if (stats.errorTurns > 0) {
    attention.push({
      key: "errors", tone: "danger", icon: "triangle-alert",
      title: stats.errorTurns + " turn" + (stats.errorTurns === 1 ? "" : "s") + " failed",
      detail: "the assistant could not produce an answer",
    });
  }
  if (stats.capHitTurns > 0) {
    attention.push({
      key: "cap", tone: "warn", icon: "list-ordered",
      title: stats.capHitTurns + " turn" + (stats.capHitTurns === 1 ? "" : "s") + " hit the step limit",
      detail: "ran out of tool steps before answering" + (runtime && runtime.maxIterations ? " (cap " + runtime.maxIterations + ")" : ""),
    });
  }

  return (
    <>
      {runtime && (
        <div className="players-toolbar">
          <div className="svc-summary">
            <span className="svc-summary__stat">model <b>{runtime.model || "unknown"}</b></span>
            {runtime.contextWindow != null && <><span className="svc-summary__sep">&middot;</span>
              <span className="svc-summary__stat">context <b>{Math.round(runtime.contextWindow / 1024)}k</b></span></>}
            {runtime.maxIterations != null && <><span className="svc-summary__sep">&middot;</span>
              <span className="svc-summary__stat">step cap <b>{runtime.maxIterations}</b></span></>}
          </div>
          <span style={{ flex: 1 }}></span>
          <span className={"cluster-chip cluster-chip--" + (runtime.actionsEnabled ? "ok" : "muted")}>
            {runtime.actionsEnabled ? "actions on" : "actions off"}
          </span>
        </div>
      )}

      <div className="dash-summary">
        <KPI icon="circle-check" label="Answered cleanly"
          value={clean == null ? "—" : clean} unit={clean == null ? null : "%"}
          tone={clean == null ? "muted" : clean >= 95 ? "ok" : clean >= 80 ? "warn" : "danger"}
          sub={stats.turns
            ? stats.okTurns + " of " + stats.turns + " turns · " + stats.errorTurns + " errors, " + stats.capHitTurns + " cap hits"
            : "no turns recorded yet"} />
        <KPI icon="timer" label="Median answer"
          value={fmtMs(stats.medianTurnMs)}
          sub={"p95 " + fmtMs(stats.p95TurnMs) + " · slowest " + fmtMs(stats.maxTurnMs)} />
        <KPI icon="wrench" label="Tool problems"
          value={toolProblems} tone={toolProblems > 0 ? "warn" : "ok"}
          sub={plainToolErrors + " errored · " + inventedCalls + " call" + (inventedCalls === 1 ? "" : "s")
            + " to " + invented.length + " invented tool" + (invented.length === 1 ? "" : "s")} />
        <KPI icon="users" label="People"
          value={stats.actors}
          sub={stats.conversations + " conversations · " + stats.deletedConversations + " deleted"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="triangle-alert" title="Needs a look" count={attention.length || null}
          meta="Measured problems in the corpus — a tool that failed, ran long, or never existed.">
          {attention.length === 0 ? (
            <div className="chat-brief__empty chat-brief__empty--neutral">
              <div className="chat-brief__empty-title">Nothing flagged</div>
              <div className="chat-brief__empty-sub">No failed turns, no step-limit hits, and no tool the catalog doesn’t define.</div>
            </div>
          ) : (
            <div className="chat-brief__list">
              {attention.map(a => (
                <div key={a.key} className={"chat-brief__item chat-brief__item--" + a.tone}>
                  <span className="chat-brief__icon"><Icon name={a.icon} size={14} /></span>
                  <div className="chat-brief__body">
                    <span className="chat-brief__item-title"><span className="chat-brief__titletext">{a.title}</span></span>
                    <span className="chat-brief__detail">{a.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="message-square" title="Latest conversations"
          count={stats.conversations || null} countTone="neutral"
          meta="Opens read-only in the assistant dock — exactly as the person saw it.">
          {recent.length === 0 ? (
            <div className="chat-brief__empty">No conversations recorded yet.</div>
          ) : (
            <div className="chat-brief__list">
              {recent.map(c => (
                <div key={c.id} className="chat-brief__item chat-brief__item--info"
                  onClick={() => onReviewConversation && onReviewConversation(c)}>
                  <span className="chat-brief__icon"><Icon name="message-square" size={14} /></span>
                  <div className="chat-brief__body">
                    <span className="chat-brief__item-title">
                      <span className="chat-brief__titletext">{c.title || "Untitled conversation"}</span>
                    </span>
                    <span className="chat-brief__detail">
                      {/* The raw id when no name was recorded — never a name derived from it. */}
                      {c.user.displayName || c.user.userId}
                      {" · " + c.turnCount + " turn" + (c.turnCount === 1 ? "" : "s")}
                      {c.deleted ? " · deleted" : ""}
                      {c.lastActivityAt ? " · " + fmtRelative(parseTs(c.lastActivityAt)) : ""}
                    </span>
                  </div>
                  <span className="chat-brief__ask">Read <Icon name="arrow-right" size={12} strokeWidth={2.2} /></span>
                </div>
              ))}
            </div>
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="wrench" title="Tools" count={stats.tools.length}
        columns={[
          {
            key: "name", label: "Tool", width: "minmax(0,1.6fr)", sort: r => r.name,
            render: r => (
              <span style={r.known ? undefined : { color: "var(--danger-fg)" }}>
                {r.name}{!r.known && <span className="cluster-chip cluster-chip--danger" style={{ marginLeft: 8 }}>invented</span>}
              </span>
            ),
          },
          { key: "calls", label: "Calls", width: "80px", align: "right", sort: r => r.calls, defaultDir: "desc" },
          { key: "medianMs", label: "Median", width: "100px", align: "right", sort: r => r.medianMs || 0, render: r => fmtMs(r.medianMs) },
          { key: "maxMs", label: "Slowest", width: "100px", align: "right", sort: r => r.maxMs || 0, render: r => fmtMs(r.maxMs) },
          {
            key: "failedCalls", label: "Failed", width: "90px", align: "right", sort: r => r.failedCalls,
            render: r => (r.failedCalls > 0
              ? <span className="cluster-chip cluster-chip--danger">{r.failedCalls}</span>
              : "—"),
          },
        ]}
        rows={stats.tools}
        getKey={r => r.name}
        defaultSort={{ key: "calls", dir: "desc" }}
        empty="No tool has been called yet." />

      <div className="dash-summary">
        <KPI icon="git-commit-horizontal" label="Prompt versions"
          value={stats.promptVersions.length}
          sub={stats.promptVersions.length
            ? "largest: " + (stats.promptVersions[0].hash || "unversioned") + " · " + stats.promptVersions[0].turns + " turns"
            : "no turns recorded yet"} />
        <KPI icon="gauge" label="Context used"
          value={pct(stats.medianContextPercent)} sub={
            stats.contextWindow
              ? "peak " + pct(stats.maxContextPercent) + " of a " + Math.round(stats.contextWindow / 1024) + "k window"
              // Null window = the corpus spans more than one; one percentage over two denominators
              // would describe neither, so the denominator is simply not claimed.
              : "peak " + pct(stats.maxContextPercent)}
          barPct={stats.maxContextPercent == null ? undefined : stats.maxContextPercent} />
        <KPI icon="list-ordered" label="Tool steps"
          value={stats.medianIterations == null ? "—" : stats.medianIterations}
          sub={stats.maxIterations == null ? "nothing recorded" :
            "max " + stats.maxIterations + (runtime && runtime.maxIterations ? " of a " + runtime.maxIterations + " cap" : "")}
          barPct={stats.maxIterations != null && runtime && runtime.maxIterations
            ? (stats.maxIterations / runtime.maxIterations) * 100 : undefined} />
        <KPI icon="brain" label="Thinking mode"
          value={stats.turns ? Math.round(stats.thinkingTurns / stats.turns * 100) : "—"}
          unit={stats.turns ? "%" : null}
          sub={"on for " + stats.thinkingTurns + " of " + stats.turns + " turns"}
          barPct={stats.turns ? (stats.thinkingTurns / stats.turns) * 100 : undefined} />
      </div>
    </>
  );
}

export { AssistantOverview };

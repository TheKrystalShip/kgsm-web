// SpeechOverview — what this host's voice is doing, and what it costs to have it doing that.
//
// The page turns on one distinction the backend is at pains to make: this leaf is socket-activated and
// idle-exits, so an engine that is NOT running is the normal resting state and not a fault. The api
// refuses to connect to a resting daemon — connecting is what starts one — so `resting` arrives with
// the live half of the payload absent by design. Rendering that as "unavailable" would report a
// perfectly healthy leaf as broken, so resting gets its own reading throughout: what can still be known
// without asking (the models on disk, the configured voice, the idle window) is shown, and everything
// that would need the daemon is left out rather than guessed at.
//
// There are three engine states, not two, and they are three different answers to "why is nothing
// speaking": resting (no process), running with nothing loaded (a process, no models yet — the next
// request pays a few seconds), and loaded. A page that collapsed the middle one would leave somebody
// staring at "active" wondering why the first sentence was slow.
//
// Every figure is the leaf's own measurement relayed by the api. In particular `runtime` is what each
// half ACTUALLY loaded on, not what the setting asked for: both fall back to the processor when the
// card cannot be had, silently and by design, and that fallback is forty times slower for recognition
// and eight for synthesis. It is reported without a verdict, because a host deliberately configured for
// the processor looks identical from here and this page has no business calling that a fault.
//
// The counters are since the daemon process started, and the process ends on its own — so the window
// they cover is named everywhere they appear.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fmtBytes, fmtRelative, fmtUntil, parseTs } from "../../lib/formatting.js";
import { fetchLeafSpeechStatus } from "../../lib/stores.js";
import {
  LeafBriefEmpty, LeafFacts, LeafLoading, LeafAbsent, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// A parsed timestamp or null — an unparseable stamp is treated as absent rather than rendered as
// "Invalid Date", the same rule the scheduler board follows.
function at(ts) {
  if (!ts) return null;
  const d = parseTs(ts);
  return isNaN(d.getTime()) ? null : d;
}

// A pass duration. Sub-second work is the normal case here and reads better in milliseconds; anything
// longer is a wait somebody noticed, so it gets seconds.
function ms(n) {
  if (n == null) return null;
  return n < 1000 ? n + "ms" : (n / 1000).toFixed(1) + "s";
}

// Seconds of audio, as a length rather than a number.
function audio(seconds) {
  if (!seconds) return "0s";
  if (seconds < 60) return seconds.toFixed(1) + "s";
  const m = Math.floor(seconds / 60);
  return m + "m " + String(Math.round(seconds % 60)).padStart(2, "0") + "s";
}

// How each half's compute placement reads. Deliberately untoned: `cpu` is a fallback on one host and a
// deliberate setting on another, and this payload cannot tell them apart — so it states the cost and
// leaves the verdict to somebody who knows which it is.
const RUNTIME = {
  gpu: { label: "GPU", hint: "on the graphics card" },
  cpu: { label: "CPU", hint: "on the processor — many times slower than the card" },
  unknown: { label: "—", hint: "nothing loaded yet, so there is nothing to place" },
};

function SpeechOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafSpeechStatus(h));

  // The unload countdown is the point of that KPI, so it ticks rather than freezing at the moment of
  // the fetch. `unloadsAt` is an absolute time, so a local clock tick is enough and costs no request —
  // deliberately NOT a poll, because polling this leaf is what would keep it alive.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setClock(c => c + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (state === "loading") return <LeafLoading what="Reading the speech engine…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a speech engine" />;
  if (state === "error") return <LeafUnreadable what="Speech engine" error={error} onRetry={reload} />;

  const now = new Date();
  const resting = !!data.resting;
  const hearing = data.hearing || null;
  const speaking = data.speaking || null;
  const models = data.models || [];
  const voice = data.voice || {};

  const started = at(data.startedAt);
  const loadedAt = at(data.loadedAt);
  const unloadsAt = at(data.unloadsAt);

  // The three engine states, each with the thing somebody actually wants to know about it. A lane that
  // loaded and came up unavailable is the one genuine fault here — the models are in memory and one half
  // of the engine still cannot work.
  const broken = data.loaded && ((hearing && !hearing.available) || (speaking && !speaking.available));
  const engine = resting
    ? { label: "Resting", tone: "muted", icon: "moon", sub: "models unloaded — nothing resident" }
    : broken
      ? { label: "Impaired", tone: "danger", icon: "triangle-alert",
          sub: (hearing && !hearing.available ? "cannot hear" : "cannot speak") }
      : data.loaded
        ? { label: "Loaded", tone: "ok", icon: "audio-lines",
            sub: loadedAt ? "loaded " + fmtRelative(loadedAt, now) : "models in memory" }
        : { label: "Idle", tone: "info", icon: "circle-dashed",
            sub: "running, models not loaded yet" };

  // The idle window, which is three different statements. A configured zero is not a missing value: it
  // means this host keeps the models resident until something restarts the daemon, which is the OPPOSITE
  // of the countdown a blank would imply — and only a genuinely unreadable configuration is "—".
  const stays = data.idleMinutes === 0;
  const idle = resting
    ? {
        label: "Idle window",
        value: data.idleMinutes == null ? "—" : stays ? "stays loaded" : data.idleMinutes + "m",
        sub: data.idleMinutes == null
          ? "this leaf’s configuration couldn’t be read"
          : stays
            ? "once loaded it stays until the daemon restarts"
            : "quiet before it exits again",
      }
    : {
        label: data.loaded ? "Unloads in" : "Idle window",
        // A deadline already in the past is real rather than a rendering fault — the daemon checks every
        // half minute, so it says "any moment" instead of counting up past zero.
        value: unloadsAt ? (unloadsAt <= now ? "any moment" : fmtUntil(unloadsAt, now)) : "stays loaded",
        // Short enough to survive a phone's KPI line: both facts, no clause to lose.
        sub: unloadsAt
          ? data.idleMinutes + "m of quiet frees ~1.6GB"
          : "configured never to unload",
      };

  // Waiting counts only mean something once there is an engine to queue for.
  const queued = (hearing ? hearing.waiting : 0) + (speaking ? speaking.waiting : 0);
  const busy = !!((hearing && hearing.busy) || (speaking && speaking.busy));

  // Two processes with the same name are two connections, and both are real — the panel's own backend
  // is often two of them (the operator's api and a dev one). Grouped rather than listed twice, because
  // repeating an identical row reads as a rendering fault and says nothing the count doesn't.
  const attached = [];
  for (const name of data.surfaces || []) {
    const already = attached.find(a => a.name === name);
    if (already) already.count += 1;
    else attached.push({ name, count: 1 });
  }

  const lanes = [
    hearing && { ...hearing, id: "hearing", label: "Hearing", icon: "ear", what: "recognition" },
    speaking && { ...speaking, id: "speaking", label: "Speaking", icon: "volume-2", what: "synthesis" },
  ].filter(Boolean);

  return (
    <>
      <div className="dash-summary">
        <KPI icon={engine.icon} label="Engine" value={engine.label} tone={engine.tone} sub={engine.sub} />

        {/* A voice changed on the running daemon lasts until it restarts and is never written back, so
            the two values disagreeing is a real state with a real consequence — and this is the only
            place on the host it is visible. */}
        <KPI icon="mic-vocal" label="Voice"
          value={voice.speaking || voice.configured || "—"}
          tone={voice.overridden ? "warn" : "muted"}
          sub={voice.overridden
            ? "changed on the running engine · configured " + voice.configured
            : resting
              ? "what it will speak in"
              : (voice.installed != null ? voice.installed + " voices installed" : "this host’s voice")} />

        {/* Not toned: unloading is this leaf working as designed, not a countdown to a problem. */}
        <KPI icon="timer" label={idle.label} value={idle.value} tone="muted" sub={idle.sub} />

        <KPI icon="layers" label="Queue"
          value={resting ? "—" : busy ? (queued ? queued + " waiting" : "working") : "idle"}
          tone={queued ? "warn" : "muted"}
          sub={resting
            ? "nothing to queue for"
            : "one pass at a time, per half"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="activity" title="What it can do"
          meta={resting
            ? "Not asked — the engine is resting, and asking would start it."
            : "What each half loaded, and where it actually ran."}>
          {resting ? (
            <LeafBriefEmpty title="Nothing loaded to report on">
              This leaf gives back the ~1.6GB its models cost by ending, and systemd holds its socket
              either way — so the next thing that needs a voice starts it again in a few seconds.
              Reading this page deliberately isn’t enough to wake it.
            </LeafBriefEmpty>
          ) : (
            <LeafFacts rows={lanes.map(l => [
              l.label,
              l.available
                ? (RUNTIME[l.runtime] || RUNTIME.unknown).label
                : (data.loaded ? "unavailable" : "not loaded"),
              // The leaf's own words for what it is doing, or for why it can do nothing. Passed through
              // rather than reworded: a missing model names the path it looked at.
              l.detail || (RUNTIME[l.runtime] || RUNTIME.unknown).hint,
            ])} />
          )}
        </BriefCard>

        <BriefCard icon="hard-drive" title="Models" count={models.length || null} countTone="neutral"
          meta="Measured on disk, whether or not the engine is running.">
          {models.length === 0 ? (
            <LeafBriefEmpty title="No models declared">
              This leaf’s configuration names no model files, so there is nothing to look for.
            </LeafBriefEmpty>
          ) : (
            <LeafFacts rows={models.map(m => [
              m.kind === "recognition" ? "Recognition" : "Synthesis",
              m.present ? (m.bytes != null ? fmtBytes(m.bytes) : "present") : "missing",
              m.present
                ? m.name
                // The one failure that looks like a broken engine and is not: the daemon loads fine and
                // simply has nothing to load. The path is what somebody needs.
                : "nothing at " + m.path,
            ])} />
          )}
        </BriefCard>

        <BriefCard icon="plug" title="Attached" count={(data.surfaces || []).length || null} countTone="neutral"
          meta="Processes holding a connection right now, named by the kernel’s own credentials.">
          {attached.length === 0 ? (
            <LeafBriefEmpty title={resting ? "Nothing is connected" : "No surface is attached"}>
              {resting
                ? "Nothing on this host is holding a connection — which is why it is resting."
                : "Nothing holds a connection right now. A surface opens one when it has something to say."}
            </LeafBriefEmpty>
          ) : (
            <LeafFacts rows={attached.map(a => [
              a.name,
              a.count === 1 ? "connected" : a.count + " connections",
              // Worth saying plainly: the panel's own backend appears here because looking at this page
              // is itself a connection, and an operator should not read that as a surface using speech.
              a.name === "kgsm-api"
                ? "the Control Panel API — this page’s own connection"
                : "holds an open connection",
            ])} />
          )}
        </BriefCard>
      </div>

      {/* The window every figure in this table belongs to is named in its own title: these counters
          die with the process, and a total with no window is a measurement of nothing. */}
      <CardTable
        icon="gauge"
        title={started ? "Work done since the engine started " + fmtRelative(started, now) : "Work done"}
        count={resting ? null : lanes.reduce((n, l) => n + l.done, 0)}
        columns={[
          // No runtime column: where each half ran is stated once, in the card above, and a table this
          // wide has to spend its width on the figures that differ row to row.
          { key: "label", label: "Half", width: "110px", sort: r => r.label, defaultDir: "asc" },
          { key: "done", label: "Passes", width: "90px", align: "right", sort: r => r.done },
          {
            key: "failed", label: "Failed", width: "90px", align: "right", sort: r => r.failed,
            render: r => (r.failed > 0
              ? <span className="cluster-chip cluster-chip--danger">{r.failed}</span>
              : "—"),
          },
          {
            // Turned away rather than failed: the caller said it would not wait. Only recognition ever
            // does this, so the other row is honestly empty rather than zero.
            key: "rejected", label: "Turned away", width: "110px", align: "right", sort: r => r.rejected,
            render: r => (r.rejected > 0 ? r.rejected : <span className="svc-fact svc-fact--unit">—</span>),
          },
          {
            key: "audio", label: "Audio", width: "110px", align: "right", sort: r => r.audioSeconds,
            render: r => audio(r.audioSeconds),
          },
          {
            key: "mean", label: "Mean", width: "90px", align: "right", sort: r => r.meanMs ?? null,
            render: r => ms(r.meanMs) || <span className="svc-fact svc-fact--unit">—</span>,
          },
          {
            key: "p95", label: "p95", width: "90px", align: "right", sort: r => r.p95Ms ?? null,
            render: r => ms(r.p95Ms) || <span className="svc-fact svc-fact--unit">—</span>,
          },
          {
            // The one number that says whether the card is really being used: many times faster than
            // real time is what a GPU looks like, and barely faster is what a processor looks like.
            key: "rtf", label: "vs realtime", width: "105px", align: "right",
            sort: r => r.realtimeFactor ?? null,
            render: r => (r.realtimeFactor
              ? r.realtimeFactor.toFixed(1) + "×"
              : <span className="svc-fact svc-fact--unit">—</span>),
          },
          {
            key: "last", label: "Last pass", width: "minmax(120px,1fr)", sort: r => at(r.lastAt),
            render: r => {
              const when = at(r.lastAt);
              if (!when) return <span className="svc-fact svc-fact--unit">nothing yet</span>;
              return (
                <span title={r.lastOutcome ? "outcome: " + r.lastOutcome : undefined}>
                  {fmtRelative(when, now)}{r.lastOutcome && r.lastOutcome !== "done" ? " · " + r.lastOutcome : ""}
                </span>
              );
            },
          },
        ]}
        rows={lanes}
        getKey={r => r.id}
        defaultSort={{ key: "label", dir: "asc" }}
        empty={resting
          ? "The engine is resting. Its tallies belong to a process that has ended — the next one starts its own."
          : "This engine hasn’t been asked for anything yet."} />
    </>
  );
}

export { SpeechOverview };

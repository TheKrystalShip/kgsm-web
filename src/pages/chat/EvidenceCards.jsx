// Evidence cards — the rich diagnostic result renderers shown beneath an
// assistant's answer. Each card deep-links to the full context. Pure
// props-in, JSX-out — no local state, no parent coupling.

import { Icon } from "../../components/Icon.jsx";
import { AuditEventRow } from "../../components/AuditEventRow.jsx";
import { TimeSeriesChart } from "../../components/TimeSeriesChart.jsx";
import { useStore } from "../../lib/store.js";
import { hostsStore } from "../../lib/stores.js";
import { formatBytes, formatBps } from "../../lib/formatting.js";

function ChatEvidence({ cards, onOpenServer, onOpenView }) {
  if (!cards || !cards.length) return null;
  return (
    <div className="chat-evidence">
      <div className="chat-evidence__label">
        <Icon name="search-check" size={12} /> Evidence
      </div>
      {cards.map((c, i) => {
        if (c.kind === "performance") return <EvidencePerformance key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "performance")} />;
        if (c.kind === "console")     return <EvidenceConsole     key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "console")} />;
        if (c.kind === "config")      return <EvidenceConfig      key={i} c={c} onOpen={() => onOpenServer && onOpenServer(c.serverId, "files")} />;
        if (c.kind === "host")        return <EvidenceHost        key={i} c={c} onOpen={() => onOpenView && onOpenView("cluster")} />;
        if (c.kind === "fleet")       return <EvidenceFleet       key={i} c={c} />;
        if (c.kind === "network")     return <EvidenceNetwork     key={i} c={c} onOpen={() => onOpenView && onOpenView("cluster")} />;
        if (c.kind === "health")      return <EvidenceHealth      key={i} c={c} />;
        if (c.kind === "search")      return <EvidenceSearch      key={i} c={c} />;
        if (c.kind === "rootcause")   return <EvidenceRootCause   key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "changes")     return <EvidenceChanges     key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "audit")       return <EvidenceAudit          key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "timeline")    return <EvidenceChangeTimeline key={i} c={c} onOpenServer={onOpenServer} />;
        return null;
      })}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  if (!level) return null;
  const meta = {
    confirmed: { label: "Confirmed", icon: "badge-check", title: "Directly measured" },
    likely:    { label: "Likely",    icon: "trending-up", title: "Inferred from correlation" },
    possible:  { label: "Possible",  icon: "help-circle", title: "Can\u2019t be measured directly" },
  }[level];
  if (!meta) return null;
  return (
    <span className={"ev-conf ev-conf--" + level} title={meta.title}>
      <Icon name={meta.icon} size={10} strokeWidth={2.4} />
      {meta.label}
    </span>
  );
}

function EvidenceCardShell({ icon, title, sub, onOpen, openLabel, children, confidence }) {
  return (
    <div className="ev-card">
      <div className="ev-card__head">
        <span className="ev-card__icon"><Icon name={icon} size={13} /></span>
        <div className="ev-card__titles">
          <span className="ev-card__title">{title}</span>
          {sub && <span className="ev-card__sub">{sub}</span>}
        </div>
        {confidence && <span className="ev-card__conf-label">Confidence:</span>}
        <ConfidenceBadge level={confidence} />
        {onOpen && (
          <button className="ev-card__open" onClick={onOpen}>
            {openLabel} <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// The primary axes worth charting on a trend card, in display order. Keyed by the
// monitor's metric names; each gets a label, a token color, and a value formatter.
const PERF_TREND_METRICS = [
  { metric: "cpuPctCore", icon: "cpu",          label: "CPU",    color: "var(--krystal-teal)", fmt: (v) => (v == null || !isFinite(v) ? "\u2014" : v.toFixed(1) + "%") },
  { metric: "memBytes",   icon: "memory-stick", label: "Memory", color: "var(--info)",         fmt: (v) => (v == null || !isFinite(v) ? "\u2014" : formatBytes(v)) },
];

function EvidencePerformance({ c, onOpen }) {
  // Trend read: the card carries a per-metric time series \u2192 render a chart per
  // primary axis (honest now that the monitor owns history). A metric with no
  // points is simply omitted (never a fabricated flat line).
  if (c.mode === "trend") {
    const charts = PERF_TREND_METRICS
      .map((m) => ({ ...m, points: Array.isArray(c.series?.[m.metric]) ? c.series[m.metric] : [] }))
      .filter((m) => m.points.length > 0);
    return (
      <EvidenceCardShell icon="activity" title={"Resource trend \u00b7 " + c.serverName}
        sub={c.range ? "last " + c.range : "trend"}
        confidence={c.confidence} onOpen={onOpen} openLabel="Open Performance">
        <div className="ev-perf-trend">
          {charts.length === 0 ? (
            <div className="ev-perf__na">no trend recorded for this window</div>
          ) : charts.map((ch) => (
            <div className="ev-perf-trend__chart" key={ch.metric}>
              <div className="ev-perf-trend__head">
                <Icon name={ch.icon} size={12} /> <span>{ch.label}</span>
              </div>
              <TimeSeriesChart
                series={[{ key: ch.metric, color: ch.color, fill: true, label: ch.label, fmt: ch.fmt,
                           values: ch.points.map((p) => p.value) }]}
                times={ch.points.map((p) => Date.parse(p.ts))}
                range={c.range || "24h"}
                height={90} />
            </div>
          ))}
        </div>
      </EvidenceCardShell>
    );
  }

  // A live snapshot readout. A null field is "not measured" (muted), never rendered as 0.
  const na = <span className="ev-perf__na">not measured</span>;
  const pair = (a, b) => {
    if (a == null && b == null) return na;
    return (
      <span className="ev-perf__pair">
        <Icon name="arrow-down" size={10} strokeWidth={2.2} /> {a == null ? "\u2014" : formatBps(a)}
        <Icon name="arrow-up" size={10} strokeWidth={2.2} style={{ marginLeft: 4 }} /> {b == null ? "\u2014" : formatBps(b)}
      </span>
    );
  };
  const rows = [
    { icon: "cpu",          label: "CPU",            value: c.cpuPctCore == null ? na : c.cpuPctCore + "% of one core" },
    { icon: "memory-stick", label: "Memory",         value: c.memBytes == null ? na : formatBytes(c.memBytes) },
    { icon: "arrow-down-up",label: "Network",        value: pair(c.rxBps, c.txBps) },
    { icon: "hard-drive",   label: "Disk I/O",       value: pair(c.ioReadBps, c.ioWriteBps) },
    { icon: "list",         label: "Processes",      value: c.pids == null ? na : String(c.pids) },
  ];
  if (c.diskBytes != null) rows.push({ icon: "database", label: "Disk footprint", value: formatBytes(c.diskBytes) });
  return (
    <EvidenceCardShell icon="activity" title={"Resource usage \u00b7 " + c.serverName} sub="live snapshot"
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Performance">
      <div className="ev-perf">
        {rows.map((r, i) => (
          <div className="ev-perf__row" key={i}>
            <span className="ev-perf__icon"><Icon name={r.icon} size={12} /></span>
            <span className="ev-perf__label">{r.label}</span>
            <span className="ev-perf__value">{r.value}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceConsole({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="terminal-square" title={"Console \u00b7 " + c.serverName} sub={c.lines.length + " flagged line" + (c.lines.length === 1 ? "" : "s")}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Console">
      <div className="ev-console">
        {c.lines.map((l, i) => (
          <div className={"ev-console__line ev-console__line--" + l.tag} key={i}>
            <span className="ev-console__ts">{l.ts}</span>
            <span className="ev-console__tag">[{l.tag}]</span>
            <span className="ev-console__text">{l.text}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceConfig({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="file-text" title={c.file + " \u00b7 " + c.serverName} sub="relevant settings"
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Files">
      <div className="ev-config">
        {c.rows.map((r, i) => (
          <div className={"ev-config__row" + (r.flagged ? " ev-config__row--hi" : "")} key={i}>
            <span className="ev-config__key">{r.key}</span>
            <span className="ev-config__val">{r.value}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceHost({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="server" title={"Host \u00b7 " + c.hostName} sub={c.problems.length + " issue" + (c.problems.length === 1 ? "" : "s")}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Diagnostics">
      <div className="ev-host">
        {c.problems.map((p, i) => (
          <div className={"ev-host__row ev-host__row--" + p.tone} key={i}>
            <Icon name={p.icon} size={12} />
            <span>{p.text}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceChanges({ c, onOpenServer }) {
  const TONE = { info: "var(--info)", warn: "var(--warning)", update: "var(--update)" };
  return (
    <EvidenceCardShell icon="history" title={"What changed \u00b7 " + c.serverName} sub={c.windowLabel + " \u00b7 " + c.changes.length + " change" + (c.changes.length === 1 ? "" : "s")}
      confidence="confirmed"
      onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      <div className="ev-changes">
        {c.changes.map((ch, i) => (
          <div className="ev-changes__row" key={i}>
            <span className="ev-changes__icon" style={{ color: TONE[ch.tone] || "var(--fg-3)" }}><Icon name={ch.icon} size={12} /></span>
            <div className="ev-changes__body">
              <span className="ev-changes__label">{ch.label}<span className="ev-changes__by"> · {ch.by}</span></span>
              <span className="ev-changes__detail">{ch.detail}</span>
            </div>
            <span className="ev-changes__rel">{ch.rel}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

// Shared dot color for get_audit_log / get_change_timeline rows — same 5-tone vocabulary as
// EvidenceRootCause's TONE_DOT (danger/warn/update/info/success), driven by chatUtils'
// EVENT_TYPE_META rather than a health-check verdict.
const EVENT_TONE_DOT = { danger: "var(--danger)", warn: "var(--warning)", update: "var(--update)", info: "var(--info)", success: "var(--success)" };

// The row list both get_audit_log and get_change_timeline render, plus the two HONEST
// non-list states: the monitor couldn't be read (never narrated as "nothing happened"/
// "nothing changed"), and a real empty read (a measured "nothing recorded" — reuses the
// existing `.ev-changes` row layout, just with nothing to show).
function EventTimelineBody({ available, rows, emptyLabel, unavailableLabel }) {
  if (!available) {
    return <div className="ev-changes__empty">{unavailableLabel}</div>;
  }
  if (!rows.length) {
    return <div className="ev-changes__empty">{emptyLabel}</div>;
  }
  return (
    <div className="ev-changes">
      {rows.map((r, i) => (
        <div className="ev-changes__row" key={i}>
          <span className="ev-changes__icon" style={{ color: EVENT_TONE_DOT[r.tone] || "var(--fg-3)" }}>
            <Icon name={r.icon} size={12} />
          </span>
          <div className="ev-changes__body">
            <span className="ev-changes__label">{r.label}<span className="ev-changes__by"> · {r.by}</span></span>
            {r.detail && <span className="ev-changes__detail">{r.detail}</span>}
          </div>
          <span className="ev-changes__rel">{r.rel}</span>
        </div>
      ))}
    </div>
  );
}

// "Recent events" renders the SAME shared AuditEventRow the Audit page and dashboard use, so chat
// activity is visually consistent with the rest of the app — not a bespoke list. The two honest
// non-list states are kept: the monitor couldn't be read (never narrated as "nothing happened"), and
// a measured empty read ("nothing recorded"). `now` is a static snapshot — an evidence card is a
// point-in-time record in the conversation, so relative times don't tick (matching the other cards).
// "Recent events" renders the SAME shared AuditEventRow the Audit page and dashboard use, so chat
// activity is visually consistent with the rest of the app — not a bespoke list. The two honest
// non-list states are kept: the monitor couldn't be read (never narrated as "nothing happened"), and
// a measured empty read ("nothing recorded"). `now` is a static snapshot — an evidence card is a
// point-in-time record in the conversation, so relative times don't tick (matching the other cards).
function EvidenceAudit({ c, onOpenServer }) {
  const hosts = useStore(hostsStore, s => s.list);
  const scope = c.serverId ? "for " + c.serverName + " " : "";
  const now = new Date();
  return (
    <EvidenceCardShell icon="history" title={"Recent events" + (c.serverId ? " · " + c.serverName : "")}
      sub={[c.windowLabel, c.available && c.events.length ? c.events.length + " event" + (c.events.length === 1 ? "" : "s") : null]
        .filter(Boolean).join(" · ")}
      confidence={c.confidence}
      onOpen={c.serverId ? () => onOpenServer && onOpenServer(c.serverId, "overview") : undefined}
      openLabel="Open server">
      {!c.available ? (
        <div className="ev-changes__empty">
          Event history is unavailable right now — the metrics monitor isn’t reachable. That isn’t a
          sign nothing happened; the events just couldn’t be read.
        </div>
      ) : !c.events.length ? (
        <div className="ev-changes__empty">{"No events recorded " + scope + c.windowLabel + "."}</div>
      ) : (
        <div className="ev-audit">
          {c.events.map((ev) => (
            <AuditEventRow key={ev.id} ev={ev} now={now} hosts={hosts} avatarSize={24} showMeta={false} />
          ))}
        </div>
      )}
    </EvidenceCardShell>
  );
}

function EvidenceChangeTimeline({ c, onOpenServer }) {
  const scope = c.serverId ? "for " + c.serverName + " " : "";
  return (
    <EvidenceCardShell icon="git-commit-vertical" title={"What changed" + (c.serverId ? " · " + c.serverName : "")}
      sub={[c.windowLabel, c.available && c.changes.length ? c.changes.length + " change" + (c.changes.length === 1 ? "" : "s") : null]
        .filter(Boolean).join(" · ")}
      confidence={c.confidence}
      onOpen={c.serverId ? () => onOpenServer && onOpenServer(c.serverId, "overview") : undefined}
      openLabel="Open server">
      <EventTimelineBody
        available={c.available}
        rows={c.changes}
        emptyLabel={"No changes recorded " + scope + c.windowLabel +
          " (routine starts/stops and player activity don’t count as changes)."}
        unavailableLabel={"The change timeline is unavailable right now — the metrics monitor isn’t reachable. " +
          "That isn’t a sign nothing changed; the timeline just couldn’t be read."} />
    </EvidenceCardShell>
  );
}

function EvidenceRootCause({ c, onOpenServer }) {
  const TONE_DOT = { danger: "var(--danger)", warn: "var(--warning)", update: "var(--update)", info: "var(--info)", success: "var(--success)" };
  const steps = Array.isArray(c.steps) ? c.steps : [];
  return (
    <EvidenceCardShell icon="git-merge" title={"Root cause \u00b7 " + c.serverName} sub={c.headline}
      confidence={c.confidence} onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      {steps.length === 0 ? (
        // Honest: no matched signature AND nothing to correlate (or every source was
        // unavailable) \u2014 the headline already says so; there is no evidence chain to draw.
        <div className="ev-changes__empty">No supporting evidence to show.</div>
      ) : (
        <div className="ev-chain">
          {steps.map((s, i) => (
            <div className={"ev-chain__step ev-chain__step--" + s.tone} key={i}>
              <span className="ev-chain__rail">
                <span className="ev-chain__dot" style={{ background: TONE_DOT[s.tone] || "var(--fg-3)" }}></span>
                {i < steps.length - 1 && <span className="ev-chain__line"></span>}
              </span>
              <span className="ev-chain__icon"><Icon name={s.icon} size={12} /></span>
              <div className="ev-chain__body">
                <span className="ev-chain__label">{s.label}</span>
                <span className="ev-chain__detail">{s.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </EvidenceCardShell>
  );
}

function EvidenceHealth({ c }) {
  const verdict = c.fails ? "danger" : c.warns ? "warn" : "success";
  const headline = c.fails
    ? `${c.fails} issue${c.fails === 1 ? "" : "s"} found`
    : c.warns ? `${c.warns} thing${c.warns === 1 ? "" : "s"} to watch` : "All clear";
  const ICON = { pass: "check", warn: "alert-triangle", fail: "x", skip: "minus" };
  return (
    <EvidenceCardShell icon="stethoscope" title={"Health check \u00b7 " + c.serverName}
      sub={`${c.passes}/${c.checks.length} passed`}
      confidence={c.confidence}>
      <div className={"ev-health__verdict ev-health__verdict--" + verdict}>
        <Icon name={verdict === "success" ? "circle-check-big" : "alert-triangle"} size={13} />
        {headline}
      </div>
      <div className="ev-health">
        {c.checks.map((ck, i) => (
          <div className={"ev-health__row ev-health__row--" + ck.status} key={i}>
            <span className="ev-health__icon"><Icon name={ICON[ck.status]} size={11} strokeWidth={2.6} /></span>
            <span className="ev-health__label">{ck.label}</span>
            <span className="ev-health__detail">{ck.detail}</span>
          </div>
        ))}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceSearch({ c }) {
  const ORIGIN = { local: "file-text", web: "globe" };
  const title = c.provenance === "web" ? "Web search"
    : c.provenance === "mixed" ? "Docs & web"
    : "Indexed docs";
  const weak = c.state === "localWeak";
  const q = c.query ? "“" + c.query + "”" : "";
  return (
    <EvidenceCardShell icon="search" title={title}
      sub={weak ? "closest matches for " + q : q}
      confidence={c.confidence}>
      <div className="ev-search">
        {c.passages.map((p, i) => {
          const label = p.title || p.source || "source";
          return (
            <div className={"ev-search__row ev-search__row--" + p.origin} key={i}>
              <span className="ev-search__icon"><Icon name={ORIGIN[p.origin] || "file-text"} size={11} /></span>
              <div className="ev-search__body">
                {p.origin === "web" && p.source
                  ? <a className="ev-search__src" href={p.source} target="_blank" rel="noopener noreferrer">{label}</a>
                  : <span className="ev-search__src" title={p.source}>{label}</span>}
                {p.text && <span className="ev-search__snippet">{p.text}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceFleet({ c }) {
  const STATE = {
    running: { icon: "check",          label: "Running" },
    stopped: { icon: "minus",          label: "Stopped" },
    unknown: { icon: "alert-triangle", label: "Status unavailable" },
  };
  return (
    <EvidenceCardShell icon="layout-grid" title="Cluster status" sub={c.summary}
      confidence={c.confidence}>
      <div className="ev-fleet">
        {c.servers.map((s, i) => {
          const meta = STATE[s.state] || STATE.unknown;
          return (
            <div className={"ev-fleet__row ev-fleet__row--" + s.tone} key={i}>
              <span className="ev-fleet__icon"><Icon name={meta.icon} size={11} strokeWidth={2.6} /></span>
              <span className="ev-fleet__name">{s.instance}</span>
              <span className="ev-fleet__state">{s.reason || meta.label}</span>
            </div>
          );
        })}
      </div>
    </EvidenceCardShell>
  );
}

function EvidenceNetwork({ c, onOpen }) {
  const closed = c.closedCount > 0;
  return (
    <EvidenceCardShell icon="network" title={"Network \u00b7 " + c.serverName}
      sub={closed ? c.closedCount + " required port" + (c.closedCount === 1 ? "" : "s") + " closed" : "all required ports open"}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Diagnostics">
      <div className="ev-net">
        <div className="ev-net__ports">
          {c.rows.map((r, i) => (
            <div className={"ev-net__port ev-net__port--" + (r.open ? "open" : "closed")} key={i}>
              <Icon name={r.open ? "check" : "x"} size={11} strokeWidth={2.6} />
              <code>{r.port}/{r.proto}</code>
              <span>{r.open ? "open" : "closed"}</span>
            </div>
          ))}
        </div>
        {c.iface && (
          <div className="ev-net__traffic">
            <Icon name="arrow-down" size={11} /> {c.iface.rx} kbps
            <Icon name="arrow-up" size={11} style={{ marginLeft: 10 }} /> {c.iface.tx} kbps
            <span className={"ev-net__err" + (c.iface.errors > 0 ? " ev-net__err--bad" : "")} style={{ marginLeft: 10 }}>
              {c.iface.errors} errors
            </span>
          </div>
        )}
      </div>
    </EvidenceCardShell>
  );
}

export { ChatEvidence, ConfidenceBadge, EvidenceCardShell };

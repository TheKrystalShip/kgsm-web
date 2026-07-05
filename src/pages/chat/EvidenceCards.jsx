// Evidence cards — the rich diagnostic result renderers shown beneath an
// assistant's answer. Each card deep-links to the full context. Pure
// props-in, JSX-out — no local state, no parent coupling.

import { Icon } from "../../components/Icon.jsx";
import { TimeSeriesChart } from "../../components/TimeSeriesChart.jsx";
import { ACTION_META } from "../../lib/formatting.js";

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
        if (c.kind === "host")        return <EvidenceHost        key={i} c={c} onOpen={() => onOpenView && onOpenView("fleet")} />;
        if (c.kind === "fleet")       return <EvidenceFleet       key={i} c={c} />;
        if (c.kind === "network")     return <EvidenceNetwork     key={i} c={c} onOpen={() => onOpenView && onOpenView("fleet")} />;
        if (c.kind === "health")      return <EvidenceHealth      key={i} c={c} />;
        if (c.kind === "rootcause")   return <EvidenceRootCause   key={i} c={c} onOpenServer={onOpenServer} />;
        if (c.kind === "changes")     return <EvidenceChanges     key={i} c={c} onOpenServer={onOpenServer} />;
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

function EvidencePerformance({ c, onOpen }) {
  return (
    <EvidenceCardShell icon="line-chart" title={c.metric.label + " \u00b7 " + c.serverName} sub={c.caption}
      confidence={c.confidence} onOpen={onOpen} openLabel="Open Performance">
      <div className="ev-chart">
        <TimeSeriesChart
          range="1h"
          height={96}
          yMin={0}
          yMax={c.yMax || undefined}
          series={[{ key: c.metric.key, color: c.metric.color, fill: true, values: c.values }]}
          anomalies={[c.anomaly]} />
      </div>
      {c.correlated && (
        <div className="ev-correlate">
          <Icon name="link-2" size={11} />
          <span className="ev-correlate__text">
            Lines up with <b>{c.correlated.summary}</b>
          </span>
          {ACTION_META[c.correlated.action] && (
            <span className={"audit-pill audit-pill--" + ACTION_META[c.correlated.action].tone}>
              <Icon name={ACTION_META[c.correlated.action].icon} size={10} strokeWidth={2.2} className="audit-pill__icon" />
              {c.correlated.action}
            </span>
          )}
        </div>
      )}
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

function EvidenceRootCause({ c, onOpenServer }) {
  const TONE_DOT = { danger: "var(--danger)", warn: "var(--warning)", update: "var(--update)", info: "var(--info)", success: "var(--success)" };
  return (
    <EvidenceCardShell icon="git-merge" title={"Root cause \u00b7 " + c.serverName} sub={c.headline}
      confidence={c.confidence} onOpen={() => onOpenServer && onOpenServer(c.serverId, "overview")} openLabel="Open server">
      <div className="ev-chain">
        {c.steps.map((s, i) => (
          <div className={"ev-chain__step ev-chain__step--" + s.tone} key={i}>
            <span className="ev-chain__rail">
              <span className="ev-chain__dot" style={{ background: TONE_DOT[s.tone] || "var(--fg-3)" }}></span>
              {i < c.steps.length - 1 && <span className="ev-chain__line"></span>}
            </span>
            <span className="ev-chain__icon"><Icon name={s.icon} size={12} /></span>
            <div className="ev-chain__body">
              <span className="ev-chain__label">{s.label}</span>
              <span className="ev-chain__detail">{s.detail}</span>
            </div>
          </div>
        ))}
      </div>
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

function EvidenceFleet({ c }) {
  const STATE = {
    running: { icon: "check",          label: "Running" },
    stopped: { icon: "minus",          label: "Stopped" },
    unknown: { icon: "alert-triangle", label: "Status unavailable" },
  };
  return (
    <EvidenceCardShell icon="layout-grid" title="Fleet status" sub={c.summary}
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

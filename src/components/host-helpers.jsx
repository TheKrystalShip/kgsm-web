import { Icon } from "./Icon.jsx";
import { OAuthIcon, providerLabel } from "./oauth-icons.jsx";
import { reachStore } from "../lib/apiClient.js";
import { CONNECTIONS } from "../lib/config.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { sessionStore, TIER_LABEL } from "../lib/sessionStore.js";
import { statusTone } from "../lib/formatting.js";

// host-helpers.jsx — shared host-related UI components extracted from page files.
//
// These were previously co-located in DiagnosticsPage.jsx, HostAccess.jsx, and
// the sign-in screen. They are reusable components consumed across pages and components.

// ---------- Fan-out reach disclosure ----------

const REACH_TEXT = {
  unreachable: "didn't answer",
  unauthenticated: "couldn't be signed in to",
  unauthorized: "refused this session",
  error: "returned an error",
};

// The honest footnote on an aggregated surface: which nodes did NOT contribute
// to what you are looking at. Without it, a node dropping out of the fan-out is
// indistinguishable from its servers having been deleted.
//
// Silent when every node answered, and silent at N=1 — a lone node's failure is
// already the app-wide connectivity banner's story, and repeating it here would
// be noise. A node with no recorded read yet is not counted against anything.
function ClusterReach({ className = "" }) {
  const byHost = useStore(reachStore, s => s.byHost);
  const hosts = useStore(hostsStore, s => s.list);
  // The denominator is the connection set — the nodes we drive — so a stale
  // entry for a node no longer connected can never be counted against it.
  const known = CONNECTIONS.filter(c => byHost[c.url]);
  if (CONNECTIONS.length <= 1 || known.length <= 1) return null;
  const degraded = known.filter(c => !byHost[c.url].ok);
  if (!degraded.length) return null;
  const labelOf = (conn) => {
    const rec = byHost[conn.url];
    const id = conn.id || (rec && rec.id);
    const h = id && hosts.find(x => x.id === id);
    return (h && h.name) || conn.name || (rec && rec.name) || id || conn.url;
  };
  return (
    <div className={"cluster-reach " + className}>
      <Icon name="triangle-alert" size={13} />
      <span>
        {known.length - degraded.length} of {known.length} nodes reported
        {degraded.map(c => " · " + labelOf(c) + " " + (REACH_TEXT[byHost[c.url].reason] || "is degraded")).join("")}
      </span>
    </div>
  );
}

// ---------- Per-node access degradation ----------

// The nodes that refuse this session, reported as a list rather than as a gate.
//
// A node can refuse in two ways, and they are not the same thing: `denied` is
// terminal (your Discord role grants nothing there — re-logging in changes
// nothing), `expired` is recoverable with one gesture. Neither is a reason to
// take the whole panel away: sessions are per node, so the rest of the cluster
// is still yours to use, and the surfaces already disclose the rows that node
// would have contributed (ClusterReach). What is owed is naming the node and
// offering the one action that fixes it.
//
// A node we couldn't REACH is not a node that refused us, so it is not reported
// here — its session lands on `expired/unreachable`, which says nothing about
// whether we'd be let in. That is ClusterReach's story ("didn't answer"), and
// offering "Re-authorize" for it would be a diagnosis we never measured.
//
// The expired rows read `reauthDue`, not the raw status: an access token lapses
// every 15 minutes and the seam rotates it away in one round-trip, and a notice
// that asks for a sign-in the user doesn't owe is worse than no notice at all.
// A lapse that outlives the surfacing delay is reported as it always was.
//
// Driven by the SESSION records, not by the host list: a node that refuses us
// contributes no row to `GET /hosts`, so reading the host list would silently
// drop the very nodes this exists to name. The list is only consulted for a
// display name, with the connection's own label behind it.
//
// Silent when every node accepts us.
// ---------- The Node list-filter ----------

// Option list for a toolbar's "Node" field. This is a LIST filter: it narrows
// the rows on its own page and touches nothing outside it. The options are every
// node the panel drives, because every node's rows are on the page, and a filter
// with nothing to choose between hides itself (`nodeFilterOptions(...).length
// <= 2` — "All nodes" plus a lone node).
function nodeFilterOptions(hosts) {
  return [{ value: "all", label: "All nodes" }, ...(hosts || []).map(h => ({ value: h.id, label: h.name }))];
}

// ---------- Capacity meters (from DiagnosticsPage.jsx) ----------

// Derive the three capacity meters from a host record. `warnAt` is each meter's own
// amber threshold, carried so a reader ranking meters against each other can ask how
// far past its OWN line each one is — three meters that turn amber at 60/70/80 are not
// comparable by raw percentage (see hostHealth's `worst`).
function hostCapacityMeters(host) {
  if (!host || !host.cpu || !host.ram || !host.ram.total_gb) return [];
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const fullest = host.disks.reduce((acc, d) => {
    const pct = (d.used_gb / d.total_gb) * 100;
    return pct > acc.pct ? { disk: d, pct } : acc;
  }, { disk: null, pct: 0 });
  const diskPct = Math.round(fullest.pct);
  const swapRatio = host.ram.swap_total_gb ? host.ram.swap_used_gb / host.ram.swap_total_gb : 0;

  return [
    {
      key: "cpu", icon: "cpu", label: "CPU", pct: host.cpu.usage_pct,
      value: host.cpu.usage_pct + "%",
      detail: "load " + host.cpu.load_avg[0].toFixed(1) + " \u00b7 " + host.cpu.cores + " cores",
      tone: statusTone(host.cpu.usage_pct, 60, 80), warnAt: 60,
    },
    {
      key: "ram", icon: "memory-stick", label: "Memory", pct: ramPct,
      value: ramPct + "%",
      detail: host.ram.used_gb.toFixed(1) + " / " + host.ram.total_gb + " GB",
      tone: statusTone(ramPct, 70, 85), warnAt: 70,
      flag: swapRatio > 0.3 ? "swap rising" : null,
    },
    {
      key: "disk", icon: "database", label: "Disk", pct: diskPct,
      value: diskPct + "%",
      detail: fullest.disk ? fullest.disk.mount + " \u00b7 " + fullest.disk.used_gb + " / " + fullest.disk.total_gb + " GB" : "\u2014",
      tone: statusTone(diskPct, 80, 90), warnAt: 80,
      flag: fullest.disk && fullest.disk.smart && fullest.disk.smart !== "ok" ? "SMART " + fullest.disk.smart : null,
    },
  ];
}

function CapacityMeter({ meter }) {
  return (
    <div className={"cap-meter cap-meter--" + meter.tone}>
      <div className="cap-meter__top">
        <span className="cap-meter__icon"><Icon name={meter.icon} size={14} strokeWidth={2.2} /></span>
        <span className="cap-meter__label">{meter.label}</span>
        <span className="cap-meter__value">{meter.value}</span>
      </div>
      <div className="cap-meter__track">
        <i className="cap-meter__fill" style={{ width: Math.max(2, Math.min(100, meter.pct)) + "%" }}></i>
      </div>
      <div className="cap-meter__detail">
        <span className="cap-meter__detail-text">{meter.detail}</span>
        {meter.flag && (
          <span className="cap-meter__flag"><Icon name="triangle-alert" size={10} strokeWidth={2.4} />{meter.flag}</span>
        )}
      </div>
    </div>
  );
}

function HostCapacityStrip({ host, title, hostLabel, onOpenDiagnostics, hideAlert }) {
  if (!host) return null;
  const meters = hostCapacityMeters(host);
  const rank = { success: 0, warn: 1, danger: 2 };
  const worst = meters.reduce((w, m) => (rank[m.tone] > rank[w.tone] ? m : w), meters[0]);
  const alert = !hideAlert && worst && worst.tone !== "success";
  return (
    <section className="cap-strip">
      <div className="cap-strip__head">
        <h2 className="cap-strip__title">
          <Icon name="server" size={14} />
          {title || "Host capacity"}
          {hostLabel && <span className="cap-strip__host">{hostLabel}</span>}
        </h2>
        {alert && (
          <span className={"cap-strip__alert cap-strip__alert--" + worst.tone}>
            <Icon name="triangle-alert" size={12} strokeWidth={2.4} />
            {worst.label} {worst.flag || ("at " + worst.value)}
          </span>
        )}
        <span style={{ flex: 1 }}></span>
        {onOpenDiagnostics && (
          <button className="dash-section__more" onClick={onOpenDiagnostics}>
            Diagnostics <Icon name="arrow-right" size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <div className="cap-strip__meters">
        {meters.length
          ? meters.map(m => <CapacityMeter key={m.key} meter={m} />)
          : <div className="cap-strip__empty"><Icon name="activity" size={13} /> Live metrics unavailable on this host</div>}
      </div>
    </section>
  );
}

// ---------- Host auth badge (from HostAccess.jsx) ----------

function HostAuthBadge({ hostId, size }) {
  const session = useStore(sessionStore, s => s.session) || { status: "none" };
  const refusal = useStore(sessionStore, s => s.nodes[hostId]);
  const rec = refusal && refusal.accepts === "refusing"
    ? { status: "denied", tier: session.tier }
    : session;
  const TIER = TIER_LABEL;
  const map = {
    live:          { tone: "ok",   icon: "shield-check", label: TIER[rec.tier] || "Connected" },
    bootstrapping: { tone: "info", icon: "loader-2",     label: "Connecting\u2026", spin: true },
    expired:       { tone: "warn", icon: "rotate-cw",    label: "Reconnecting\u2026", spin: true },
    denied:        { tone: "danger", icon: "lock",       label: "No access" },
    none:          { tone: "muted", icon: "plug",        label: "Not connected" },
  };
  // A session the seam is mid-rotation on reads as connected: `expired` is written
  // on every 401, including the one the 15-minute token renewal produces, and the
  // badge speaks only once that lapse has outlived the surfacing delay (reauthDue)
  // — a "Reconnecting…" that resolves in 100ms reports nothing the user can act on.
  const shown = (rec.status === "expired" && !rec.reauthDue) ? "live" : rec.status;
  const m = map[shown] || map.none;
  return (
    <span className={"host-auth host-auth--" + m.tone + (size === "sm" ? " host-auth--sm" : "")} title={m.label}>
      <Icon name={m.icon} size={size === "sm" ? 11 : 12} className={m.spin ? "is-spinning" : ""} />
      <span className="host-auth__label">{m.label}</span>
    </span>
  );
}

// ---------- Host denied notice (from HostAccess.jsx) ----------

function HostDeniedNotice({ host, onBack, onManage, embedded }) {
  const name = (host && host.name) || "this host";
  return (
    <div className={"host-denied" + (embedded ? " host-denied--embedded" : "")}>
      <div className="host-denied__icon"><Icon name="lock" size={26} strokeWidth={1.8} /></div>
      <h2 className="host-denied__title">You don{"'"}t have permission on {name}</h2>
      <p className="host-denied__body">
        You{"'"}re signed in with Discord and <b>{name}</b> recognises you — but your Discord
        role doesn{"'"}t grant access here. Each host checks roles against its own
        community, so access can differ from host to host. Ask an admin of this
        host{"'"}s Discord to grant your role, then reconnect.
      </p>
      <div className="host-denied__actions">
        {onBack && <button className="host-btn host-btn--primary" onClick={onBack}><Icon name="layers" size={14} /> Back to all hosts</button>}
        {onManage && <button className="host-btn" onClick={onManage}><Icon name="server-cog" size={14} /> Manage hosts</button>}
      </div>
      <div className="host-denied__hint"><Icon name="info" size={12} /> This isn{"'"}t a sign-in problem — re-logging in won{"'"}t change your role. It{"'"}s set on {name}{"'"}s side.</div>
    </div>
  );
}

// ---------- OAuth providers ----------
//
// The marks and names themselves are oauth-icons.jsx, which imports nothing; they are re-exported here
// for the panel's own callers.

// How somebody signed in, in words. `local` is not a provider — it is the KGSM password — and the
// derived handle prefix says `local` for it, so every surface that renders the raw value tells the
// reader they signed in "via local". Shared so the sidebar and Settings cannot answer differently.
function signInMethodLabel(provider) {
  if (!provider) return "an unknown method";
  if (provider === "local") return "a KGSM password";
  return providerLabel(provider);
}

export { CapacityMeter, ClusterReach, HostAuthBadge, HostCapacityStrip, HostDeniedNotice, OAuthIcon, hostCapacityMeters, nodeFilterOptions, providerLabel, signInMethodLabel };

// FirewallOverview — what this host's firewall is actually enforcing, and for whom.
//
// The whole page turns on one distinction the backend is at pains to make and a naive rendering would
// destroy: an empty rule grid means the OPPOSITE thing depending on the backend's enforcement state.
// Under `operational` the firewall is filtering and owns no rules, so nothing is open. Under `inactive`
// it is installed but filtering NOTHING, so every port on the box is reachable and the grid is empty
// only because an idle ufw enumerates no active rules. A green "all clear" over the second is the worst
// thing this page could say, so the posture card leads and the rule count is never toned on its own.
//
// The rules are the firewall's own data, joined by the api to the kgsm roster: `server` is the instance
// that owns the rule, `app` the game it was installed from (null when the owning instance is gone from
// the roster — never guessed).
//
// This leaf is socket-activated and idle-exits, which is why it alone has no deep-health probe: it is
// asked at the moment of the probe and answers or doesn't. "Inactive" on the System tab is its resting
// state, not a fault, and nothing here contradicts that.

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fetchHostDetail } from "../../lib/stores.js";
import {
  LeafBriefEmpty, LeafFacts, LeafLoading, LeafNotice, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// How each backend state reads, in the two places it has to: the headline KPI, and the sentence that
// says what the rule grid below actually means under it. Every one of these is a distinct operational
// posture — collapsing any two would be the fabrication this page exists to avoid.
const POSTURE = {
  operational: {
    label: "Enforcing", tone: "ok", icon: "shield-check",
    meaning: "The firewall is filtering. A port is reachable only if a rule below allows it.",
  },
  inactive: {
    label: "Not enforcing", tone: "danger", icon: "shield-off",
    meaning: "The firewall is installed but switched off, so it filters nothing and EVERY port on this "
      + "host is reachable — including any the rules below don’t mention. The rules persist and take "
      + "effect the moment it is enabled again.",
  },
  down: {
    label: "Unreachable", tone: "warn", icon: "plug-zap",
    meaning: "The firewall authority didn’t answer, so what is open right now can’t be read. This says "
      + "nothing about whether the host is filtering — only that we couldn’t ask.",
  },
  unknown: {
    label: "Can’t enumerate", tone: "warn", icon: "circle-help",
    meaning: "The backend is reachable but can’t list its rules, so the grid below is not a complete "
      + "picture and an absent port is not a closed one.",
  },
  unsupported: {
    label: "Listing unsupported", tone: "muted", icon: "circle-slash",
    meaning: "This backend can apply rules but cannot enumerate them, so there is no grid to show.",
  },
  absent: {
    label: "Not provisioned", tone: "muted", icon: "circle-slash",
    meaning: "No firewall authority is connected on this host, so kgsm opens and closes nothing.",
  },
};

// Only `operational` lets the grid be read as complete. Under every other state an absent row means
// "not known to us", so the count is reported without a tone and never as a verdict.
const ENUMERABLE = new Set(["operational", "inactive"]);

function FirewallOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchHostDetail(h));

  if (state === "loading") return <LeafLoading what="Reading the host firewall…" />;
  if (state === "error") return <LeafUnreadable what="Firewall state" error={error} onRetry={reload} />;

  const net = (data && data.network) || null;
  // The block is absent when this host answered without one — which is a fact about the response, not
  // about the firewall, and must not be rendered as "no rules".
  if (!net || !net.firewall) {
    return (
      <LeafNotice title="Firewall state not reported" onRetry={reload}>
        This host answered without a firewall block, so what it is enforcing can’t be read here.
      </LeafNotice>
    );
  }

  const posture = POSTURE[net.firewall] || POSTURE.unknown;
  const rules = net.open_ports || [];
  const enumerable = ENUMERABLE.has(net.firewall);

  // One row per port, already expanded by the api. Grouping by owner is what makes the grid readable —
  // a server with a port range occupies a dozen rows that all mean one thing.
  const byServer = new Map();
  for (const r of rules) {
    const key = r.server || "—";
    if (!byServer.has(key)) byServer.set(key, { server: key, app: r.app || null, ports: [] });
    const g = byServer.get(key);
    g.ports.push(r);
    if (!g.app && r.app) g.app = r.app;
  }
  const groups = [...byServer.values()];

  const tcp = rules.filter(r => r.proto === "tcp").length;
  const udp = rules.filter(r => r.proto === "udp").length;

  return (
    <>
      <div className="dash-summary">
        <KPI icon={posture.icon} label="Posture" value={posture.label} tone={posture.tone}
          sub={"backend reports “" + net.firewall + "”"} />
        {/* Never toned. A rule count is only good or bad relative to what should be open, which this
            page has no way to know — and under a non-enforcing backend it isn't even the whole story. */}
        <KPI icon="list" label="Rules" value={enumerable ? rules.length : "—"} tone="muted"
          sub={enumerable
            ? tcp + " tcp · " + udp + " udp"
            : "this backend didn’t enumerate them"} />
        <KPI icon="server" label="Servers covered" value={enumerable ? groups.length : "—"} tone="muted"
          sub={enumerable
            ? (groups.length === 1 ? "1 instance owns rules" : groups.length + " instances own rules")
            : "unknown while rules can’t be listed"} />
      </div>

      <div className="dash-feed">
        <BriefCard icon={posture.icon} title="What this means"
          meta="How to read the rules below, given the backend’s current state.">
          <LeafFacts rows={[
            ["Enforcement", posture.label, posture.meaning],
            ["Rules owned", enumerable ? String(rules.length) : "not enumerable",
              enumerable
                ? "Every rule kgsm-firewall owns on this host, one row per port."
                : "The backend couldn’t list them, so an absent port is NOT a closed one."],
          ]} />
        </BriefCard>

        <BriefCard icon="server" title="By server" count={groups.length || null} countTone="neutral"
          meta="Which instance each open port belongs to.">
          {groups.length === 0 ? (
            <LeafBriefEmpty title={enumerable ? "No rules owned" : "Nothing to list"}>
              {net.firewall === "inactive"
                ? "The firewall owns no rules — but it is switched off, so every port is reachable anyway."
                : enumerable
                  ? "kgsm-firewall isn’t holding any port open on this host right now."
                  : "The backend couldn’t enumerate its rules, so nothing can be attributed."}
            </LeafBriefEmpty>
          ) : (
            <LeafFacts rows={groups.map(g => [
              g.server,
              g.ports.length + " port" + (g.ports.length === 1 ? "" : "s"),
              g.app ? "installed from " + g.app : "not in the roster — the owning instance is gone",
            ])} />
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="network" title="Open ports" count={rules.length}
        columns={[
          { key: "port", label: "Port", width: "100px", align: "right", sort: r => r.port, defaultDir: "asc" },
          { key: "proto", label: "Proto", width: "90px", sort: r => r.proto },
          { key: "server", label: "Server", width: "minmax(0,1.4fr)", sort: r => r.server },
          {
            key: "app", label: "Game", width: "minmax(0,1fr)", sort: r => r.app,
            // A rule whose instance is no longer in the roster keeps its rule and loses its game. Saying
            // so is the point: it is the shape of a leftover nobody closed.
            render: r => (r.app || <span className="svc-fact svc-fact--unit">unknown</span>),
          },
        ]}
        rows={rules}
        getKey={r => r.server + ":" + r.proto + ":" + r.port}
        defaultSort={{ key: "port", dir: "asc" }}
        empty={enumerable
          ? "No rules — kgsm-firewall isn’t holding any port open on this host."
          : "This backend couldn’t enumerate its rules."} />
    </>
  );
}

export { FirewallOverview };

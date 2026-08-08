// BotOverview — who this bot is connected to, where it can post, and what it will say.
//
// This page exists mostly for one failure mode. A Discord bot whose guild never populated is `active`
// in systemd, `Connected` at the gateway, and completely unable to post — the two signals every other
// surface has both read healthy, and the first anyone learns of it is that announcements stopped. So
// the resolved guild, not the connection state, is the headline here: configured-and-connected with no
// guild is called out as a fault in its own right.
//
// The second thing it answers is "why didn't that server announce". That is either a channel the client
// cannot resolve (the channel map says which) or a switch that is off (the announcement grid says
// which) — both are one glance instead of a trawl through a forty-key settings page.

import { BriefCard } from "../../components/BriefCard.jsx";
import { CardTable } from "../../components/CardTable.jsx";
import { Icon } from "../../components/Icon.jsx";
import { KPI } from "../../components/KPI.jsx";
import { fetchLeafBotStatus } from "../../lib/stores.js";
import {
  LeafBriefEmpty, LeafBriefItem, LeafLoading, LeafAbsent, LeafUnreadable, useLeafResource,
} from "./leafOverviewKit.jsx";

// The gateway's own vocabulary, toned. Only `Connected` is good news; the transitional states are
// warnings rather than errors because they are what a healthy reconnect looks like.
const CONNECTION = {
  Connected:     { tone: "ok",     label: "Connected" },
  Connecting:    { tone: "warn",   label: "Connecting" },
  Disconnecting: { tone: "warn",   label: "Disconnecting" },
  Disconnected:  { tone: "danger", label: "Disconnected" },
};
const connectionOf = (s) => CONNECTION[s] || { tone: "muted", label: s || "unknown" };

// Gateway round-trip, in the bands that actually mean something for a chat bot: under a quarter second
// is unremarkable, a second is a link worth knowing about.
function latencyTone(ms) {
  if (ms == null) return "muted";
  if (ms >= 1000) return "danger";
  if (ms >= 250) return "warn";
  return "ok";
}

function BotOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafBotStatus(h));

  if (state === "loading") return <LeafLoading what="Reading the bot’s gateway state…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a bot status surface" />;
  if (state === "error") return <LeafUnreadable what="Bot status" error={error} onRetry={reload} />;

  const conn = connectionOf(data.connectionState);
  const channels = data.channels || [];
  const switches = data.announcements || [];
  const visible = channels.filter(c => c.visible);
  const enabled = switches.filter(s => s.enabled);

  // Configured but unresolved: the state this page exists for.
  const guildMissing = !!data.guildConfigured && !data.guildResolved;

  const attention = [];
  if (guildMissing) {
    attention.push({
      key: "guild", tone: "danger", icon: "circle-x",
      title: "The bot hasn’t resolved its guild",
      detail: "it is configured for server " + data.guildConfigured + " and the gateway reads “"
        + data.connectionState + "”, but the client holds no guild — so every channel lookup fails and "
        + "the bot can post nothing, while systemd and the gateway both look healthy",
    });
  } else if (!data.guildConfigured) {
    attention.push({
      key: "no-guild", tone: "warn", icon: "circle-help",
      title: "No Discord server configured",
      detail: "the bot has nowhere to post until a guild id is set in Settings",
    });
  }
  if (data.connectionState !== "Connected") {
    attention.push({
      key: "gateway", tone: conn.tone === "danger" ? "danger" : "warn", icon: "plug-zap",
      title: "The gateway is " + conn.label.toLowerCase(),
      detail: "nothing will be announced and no slash command will answer until it reconnects",
    });
  }
  // A configured channel the client cannot see is a message that will silently never arrive.
  for (const c of channels.filter(c => !c.visible)) {
    attention.push({
      key: "chan:" + c.instance, tone: "warn", icon: "message-circle-off",
      title: c.instance + " has no reachable channel",
      detail: "channel " + c.channelId + " is configured but the bot can’t see it — it was deleted, or "
        + "the bot isn’t in it",
    });
  }

  return (
    <>
      <div className="players-toolbar">
        <div className="svc-summary">
          <span className="svc-summary__stat">commands <b>{data.commandCount ?? "—"}</b></span>
          <span className="svc-summary__sep">&middot;</span>
          <span className="svc-summary__stat">channels <b>{visible.length}/{channels.length}</b></span>
          <span className="svc-summary__sep">&middot;</span>
          <span className="svc-summary__stat">announcing <b>{enabled.length}/{switches.length}</b></span>
        </div>
        <span style={{ flex: 1 }}></span>
        <span className={"cluster-chip cluster-chip--"
          + (conn.tone === "ok" ? "ok" : conn.tone === "muted" ? "muted" : "danger")}>
          <span className={"status-led status-led--" + (conn.tone === "ok" ? "live" : "down")}></span>
          {conn.label}
        </span>
      </div>

      <div className="dash-summary">
        {/* The guild leads, not the connection state — being connected to Discord while holding no
            guild is precisely the state that reads healthy everywhere else. */}
        <KPI icon="message-circle" label="Discord server"
          value={data.guildResolved || (guildMissing ? "unresolved" : "—")}
          tone={data.guildResolved ? "ok" : guildMissing ? "danger" : "muted"}
          sub={data.guildResolved
            ? (data.guildMemberCount != null ? data.guildMemberCount.toLocaleString() + " members" : "resolved")
            : guildMissing
              ? "configured as " + data.guildConfigured + ", but the client holds no guild"
              : "no guild configured"} />
        <KPI icon="activity" label="Gateway latency"
          value={data.latencyMs == null ? "—" : data.latencyMs} unit={data.latencyMs == null ? null : "ms"}
          tone={latencyTone(data.latencyMs)}
          sub={data.latencyMs == null
            ? "no heartbeat has completed yet"
            : "round-trip to Discord"} />
        <KPI icon="hash" label="Channels reachable" value={channels.length ? visible.length : "—"}
          tone={!channels.length ? "muted" : visible.length === channels.length ? "ok" : "warn"}
          sub={channels.length
            ? "of " + channels.length + " configured"
            : "no per-server channels configured"}
          barPct={channels.length ? (visible.length / channels.length) * 100 : undefined} />
        {/* Not toned: which announcements to make is a preference, and there is no count this panel
            could call correct. */}
        <KPI icon="megaphone" label="Announcements on" value={enabled.length} tone="muted"
          sub={"of " + switches.length + " event types"}
          barPct={switches.length ? (enabled.length / switches.length) * 100 : undefined} />
      </div>

      <div className="dash-feed">
        <BriefCard icon="triangle-alert" title="Needs a look" count={attention.length || null}
          countTone={attention.length ? "danger" : "neutral"}
          meta="Reasons this bot might be silent while its unit looks perfectly healthy.">
          {attention.length === 0 ? (
            <LeafBriefEmpty title="Nothing flagged">
              The gateway is connected, the guild resolved, and every configured channel is reachable.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {attention.map(a => <LeafBriefItem key={a.key} {...a} />)}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="megaphone" title="What it announces" count={enabled.length || null}
          countTone="neutral"
          meta="Every event type the bot can post about, and whether it will. Editable in Settings.">
          {switches.length === 0 ? (
            <LeafBriefEmpty title="No switches reported">
              This bot answered without its announcement switches.
            </LeafBriefEmpty>
          ) : (
            // A chip apiece rather than a row apiece: the question here is "which of these are off",
            // and fourteen rows answer it slowly while making this card three times the height of the
            // attention lane beside it.
            <div className="leaf-switches">
              {switches.map(s => (
                <span key={s.key} className={"leaf-switch leaf-switch--" + (s.enabled ? "on" : "off")}
                  title={s.enabled ? "Announced in Discord" : "Not announced"}>
                  <Icon name={s.enabled ? "circle-check" : "circle-slash"} size={12} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </BriefCard>
      </div>

      <CardTable
        icon="hash" title="Server channels" count={channels.length}
        columns={[
          { key: "instance", label: "Instance", width: "minmax(0,1.3fr)", sort: r => r.instance },
          {
            key: "channelName", label: "Channel", width: "minmax(0,1.3fr)", sort: r => r.channelName,
            render: r => (r.channelName
              ? "#" + r.channelName
              : <span className="svc-fact svc-fact--unit">can’t resolve</span>),
          },
          {
            key: "visible", label: "Reachable", width: "120px", sort: r => (r.visible ? 1 : 0),
            render: r => (r.visible
              ? <span className="cluster-chip cluster-chip--ok">yes</span>
              : <span className="cluster-chip cluster-chip--danger">no</span>),
          },
          {
            key: "channelId", label: "Channel id", width: "minmax(0,1fr)", align: "right",
            sort: r => r.channelId,
            render: r => <code className="lcf-key">{r.channelId}</code>,
          },
        ]}
        rows={channels}
        getKey={r => r.instance}
        defaultSort={{ key: "instance", dir: "asc" }}
        empty="No per-server channels are configured — announcements go to the fallback channel." />
    </>
  );
}

export { BotOverview };

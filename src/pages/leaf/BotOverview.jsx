// BotOverview — which Discord servers this bot posts in, where it can post in each, and what it will say.
//
// This page exists mostly for one failure mode. A Discord bot whose guild never populated is `active`
// in systemd, `Connected` at the gateway, and completely unable to post there — the two signals every
// other surface has both read healthy, and the first anyone learns of it is that announcements stopped.
// So the resolved guilds, not the connection state, are the headline here: a guild that is set up and
// unresolved is called out as a fault in its own right.
//
// The bot works in any number of Discord servers and posts in none of them until an admin runs `/setup`
// there. So "no guilds" is a real, deliberate state and not a fault — the page says which it is rather
// than flagging silence as broken.
//
// The second thing it answers is "why didn't that server announce". That is a guild the bot can't
// resolve, a channel it can't see (the per-guild channel table says which), or a switch that is off
// (the announcement grid says which) — each one glance instead of a trawl through a settings page.

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

const guildLabel = (g) => g.name || "server " + g.guildId;

function BotOverview({ hostId, leafId }) {
  const { state, data, error, reload } = useLeafResource(hostId, leafId, (h) => fetchLeafBotStatus(h));

  if (state === "loading") return <LeafLoading what="Reading the bot’s gateway state…" />;
  if (state === "none") return <LeafAbsent leafId={leafId} what="a bot status surface" />;
  if (state === "error") return <LeafUnreadable what="Bot status" error={error} onRetry={reload} />;

  const conn = connectionOf(data.connectionState);
  const guilds = data.guilds || [];
  const switches = data.announcements || [];
  const resolved = guilds.filter(g => !!g.name);
  const enabled = switches.filter(s => s.enabled);

  // Every per-server channel across every guild, flattened for the table below — the same instance
  // appears once per guild that gives it a channel, because those are different channels.
  const channels = guilds.flatMap(g => (g.channels || []).map(c => ({ ...c, guild: guildLabel(g) })));
  const visible = channels.filter(c => c.visible);

  const attention = [];

  // The store is what says where this host broadcasts. Unreadable, nothing is announced anywhere,
  // whatever the gateway says — so it leads.
  if (data.storeAvailable === false) {
    attention.push({
      key: "store", tone: "danger", icon: "database-backup",
      title: "The bot can’t read its own setup",
      detail: (data.storeUnavailableReason || "the guild store could not be opened")
        + " — nothing will be announced anywhere and /setup will refuse, while the unit and the "
        + "gateway both look healthy",
    });
  } else if (guilds.length === 0) {
    attention.push({
      key: "no-guild", tone: "warn", icon: "circle-help",
      title: "No Discord server is set up",
      detail: "the bot is silent by design until an admin runs /setup announce in a Discord server — "
        + "being invited somewhere grants it nothing",
    });
  }

  if (data.connectionState !== "Connected") {
    attention.push({
      key: "gateway", tone: conn.tone === "danger" ? "danger" : "warn", icon: "plug-zap",
      title: "The gateway is " + conn.label.toLowerCase(),
      detail: "nothing will be announced and no slash command will answer until it reconnects",
    });
  }

  for (const g of guilds) {
    // Set up but unresolved: the state this page exists for.
    if (!g.name) {
      attention.push({
        key: "guild:" + g.guildId, tone: "danger", icon: "circle-x",
        title: "The bot hasn’t resolved server " + g.guildId,
        detail: "it is set up to announce there and the gateway reads “" + data.connectionState
          + "”, but the client holds no such guild — so every channel lookup fails and nothing "
          + "reaches it, while systemd and the gateway both look healthy",
      });
      continue;
    }
    // A recorded announcement channel the client cannot see is every announcement, silently gone.
    if (!g.announceChannelVisible) {
      attention.push({
        key: "announce:" + g.guildId, tone: "danger", icon: "message-circle-off",
        title: g.name + " has no reachable announcement channel",
        detail: "channel " + g.announceChannelId + " is recorded but the bot can’t see it — every "
          + "server without a channel of its own announces there, so those go nowhere. "
          + "/setup announce points it somewhere it can post",
      });
    }
    // A board recorded against a permission the guild has since revoked: existing channels still
    // work, and no newly installed server ever gets one.
    if (g.boardCategoryId && !g.canManageChannels) {
      attention.push({
        key: "board:" + g.guildId, tone: "warn", icon: "folder-x",
        title: g.name + " has a board but the bot lost Manage Channels",
        detail: "channels already made still work; no newly installed server will get one until the "
          + "permission is granted back, or /setup board-off is run there",
      });
    }
    for (const c of (g.channels || []).filter(c => !c.visible)) {
      attention.push({
        key: "chan:" + g.guildId + ":" + c.instance, tone: "warn", icon: "message-circle-off",
        title: c.instance + " has no reachable channel in " + g.name,
        detail: "channel " + c.channelId + " is recorded but the bot can’t see it — it was deleted, "
          + "or the bot isn’t in it",
      });
    }
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
        {/* The guilds lead, not the connection state — being connected to Discord while holding no
            guild is precisely the state that reads healthy everywhere else. */}
        <KPI icon="message-circle" label="Discord servers"
          value={guilds.length ? resolved.length : "—"}
          tone={!guilds.length ? "muted" : resolved.length === guilds.length ? "ok" : "danger"}
          sub={guilds.length
            ? (resolved.length === guilds.length
              ? "set up and resolved"
              : "of " + guilds.length + " set up — the rest hold no guild")
            : "none set up — /setup in Discord"}
          barPct={guilds.length ? (resolved.length / guilds.length) * 100 : undefined} />
        <KPI icon="activity" label="Gateway latency"
          value={data.latencyMs == null ? "—" : data.latencyMs} unit={data.latencyMs == null ? null : "ms"}
          tone={latencyTone(data.latencyMs)}
          sub={data.latencyMs == null
            ? "no heartbeat has completed yet"
            : "round-trip to Discord"} />
        <KPI icon="hash" label="Channels reachable" value={channels.length ? visible.length : "—"}
          tone={!channels.length ? "muted" : visible.length === channels.length ? "ok" : "warn"}
          sub={channels.length
            ? "of " + channels.length + " recorded"
            : "no per-server channels — announcements go to each server’s one channel"}
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
              The gateway is connected, every Discord server it is set up in resolved, and every
              recorded channel is reachable.
            </LeafBriefEmpty>
          ) : (
            <div className="chat-brief__list">
              {attention.map(a => <LeafBriefItem key={a.key} {...a} />)}
            </div>
          )}
        </BriefCard>

        <BriefCard icon="megaphone" title="What it announces" count={enabled.length || null}
          countTone="neutral"
          meta="Every event type the bot can post about, and whether it will. Host-wide, and editable in Settings.">
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
        icon="message-circle" title="Discord servers" count={guilds.length}
        columns={[
          {
            key: "name", label: "Server", width: "minmax(0,1.3fr)", sort: r => r.name,
            render: r => (r.name
              ? r.name
              : <span className="svc-fact svc-fact--unit">can’t resolve</span>),
          },
          {
            key: "announce", label: "Announces in", width: "minmax(0,1.2fr)",
            sort: r => r.announceChannelName,
            render: r => (r.announceChannelName
              ? "#" + r.announceChannelName
              : <span className="svc-fact svc-fact--unit">can’t resolve</span>),
          },
          {
            key: "board", label: "Per-server channels", width: "170px",
            sort: r => (r.boardCategoryId ? 1 : 0),
            render: r => (r.boardCategoryId
              ? <span className={"cluster-chip cluster-chip--" + (r.canManageChannels ? "ok" : "danger")}>
                  {r.canManageChannels ? "on" : "on, no permission"}
                </span>
              : <span className="cluster-chip cluster-chip--muted">off</span>),
          },
          {
            key: "configuredBy", label: "Set up by", width: "minmax(0,0.8fr)",
            sort: r => r.configuredBy,
          },
          {
            key: "guildId", label: "Server id", width: "minmax(0,1fr)", align: "right",
            sort: r => r.guildId,
            render: r => <code className="lcf-key">{r.guildId}</code>,
          },
        ]}
        rows={guilds}
        getKey={r => r.guildId}
        defaultSort={{ key: "name", dir: "asc" }}
        empty="No Discord server is set up — an admin runs /setup announce in the one that should hear about this host." />

      <CardTable
        icon="hash" title="Server channels" count={channels.length}
        columns={[
          { key: "instance", label: "Instance", width: "minmax(0,1.2fr)", sort: r => r.instance },
          { key: "guild", label: "Discord server", width: "minmax(0,1.1fr)", sort: r => r.guild },
          {
            key: "channelName", label: "Channel", width: "minmax(0,1.2fr)", sort: r => r.channelName,
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
        getKey={r => r.guild + ":" + r.instance}
        defaultSort={{ key: "instance", dir: "asc" }}
        empty="No server has a channel of its own — announcements go to each Discord server’s one channel." />
    </>
  );
}

export { BotOverview };

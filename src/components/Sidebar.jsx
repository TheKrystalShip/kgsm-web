import React from "react";
import {
  Icon, NavItem, NotificationsPanel, Sidebar as SidebarFrame, SidebarAccount, SidebarGroup, useStore,
} from "@thekrystalship/krystal-ui";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { can } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { coverArtBg } from "../lib/art.js";
import { OAuthIcon, signInMethodLabel } from "./host-helpers.jsx";
import { anchorAttentionStore, clusterStore, favoritesStore, serversStore, startAnchorAttention, stopAnchorAttention } from "../lib/stores.js";

// The panel's sidebar: the design system's frame, filled with the panel's nav, the favourites under
// Servers, the nodes and the auth anchor under Cluster, and the tray, Settings and account in the foot.

// Catalog nav label — read from the shared label map so it can't drift from the
// dashboard's "Recently added" band or the breadcrumb. See labels.js KRYSTAL_LABELS.
const CATALOG_LABEL = KRYSTAL_LABELS.catalog || "Catalog";

// A node the panel cannot fully drive: unreachable, refusing this session, or
// needing a re-auth. `reauthDue`, not `expired`: the routine token renewal writes
// `expired` for one round-trip, and the node list must not tick a node into "degraded" for it.
// Offline, or honouring nothing. The session is the cluster's and its health is reported once,
// app-wide; what varies per node is whether that node is serving it.
function isDegraded(host, refusal) {
  return !host.online || !!(refusal && refusal.accepts === "refusing");
}

// The dot pulses while something is happening to (or on) the server — live, or mid-transition.
const BUSY_STATUS = {
  online: true, updating: true, stopping: true, starting: true, restarting: true,
  "backing-up": true, restoring: true, moving: true,
};

// How many favourites the sidebar draws. A shortcut list earns its place by being scannable without
// being read; past a handful it is a second servers page, and on a short viewport it would push the
// account and Settings off the bottom. The rest are one click away on Servers, which pins the same
// favourites above its grid.
const FAVORITES_SHOWN = 5;

// A favourite the roster does not hold. Its NODE is the whole question: a node that has not answered
// leaves the shortcut standing with its state unknown, while a node that answered and has no such
// server means the favourite is stale. Drawing either as "offline" would be this surface inventing a
// run-state, so neither gets a coloured dot — the hollow one says there is no reading, which is true
// in both cases and is why the two differ in their wording rather than in their dot.
function missingFavorite(hostId, hosts) {
  if (!hostId) return { stale: false, why: "This favourite records no node, so its state can't be read." };
  const host = hosts.find((h) => h.id === hostId);
  if (!host) return { stale: false, why: "The node this was favourited on isn't connected, so its state can't be read." };
  if (!host.online) return { stale: false, why: host.name + " hasn't answered, so this server's state is unknown." };
  return { stale: true, why: "No server by this id on " + host.name + " any more." };
}

function ServerListItem({ server, active, unknown, tip, onClick, onForget }) {
  const dotColor = {
    online: "var(--success)",
    updating: "var(--warning)",
    // Still up, on its way down — the in-transition tone, not the offline grey.
    stopping: "var(--warning)",
    restarting: "var(--warning)",
    starting: "var(--warning)",
    // Occupied with its own data — the same in-transition tone; the run-state
    // underneath may be either.
    "backing-up": "var(--warning)",
    restoring: "var(--warning)",
    moving: "var(--warning)",
    offline: "var(--fg-4)",
    crashed: "var(--danger)",
    // Unreachable rather than down — the same distinction the hero pill draws.
    "library-offline": "var(--warning)",
  }[server.status] || "var(--fg-4)";
  return (
    <div
      className={"server-row" + (active ? " server-row--active" : "") + (unknown ? " server-row--unknown" : "")}
      onClick={onClick}
      data-tip={tip || server.name}
      title={tip || undefined}>
      {/* The initial stands in when there is no cover. Collapsed, the thumbnail is the ONLY identity a
          row has — the name is gone and the gradient placeholder is the same for every server, so two
          art-less favourites would be one square twice. */}
      <div className="server-row__icon" style={{ backgroundImage: coverArtBg(server.cover), backgroundSize: "cover", backgroundPosition: "center" }}>
        {!server.cover && <span className="server-row__initial">{(server.name || server.id || "?").trim().charAt(0).toUpperCase()}</span>}
      </div>
      <span className="server-row__name">{server.name}</span>
      {onForget && (
        <button
          type="button"
          className="server-row__forget"
          onClick={(e) => { e.stopPropagation(); onForget(); }}
          aria-label={"Remove " + server.name + " from favourites"}
          title="Remove from favourites">
          <Icon name="x" size={12} strokeWidth={2.4} />
        </button>
      )}
      {/* Hollow when there is no reading. A coloured dot here would be a run-state nobody measured. */}
      <span
        className={"server-row__dot" + (unknown ? " server-row__dot--unknown" : "")}
        style={unknown ? undefined : {
          background: dotColor
        }}></span>
    </div>
  );
}

/// The favourites, under Servers. Renders NOTHING when there are none — no header, no placeholder,
/// no invitation. That is what lets it hold permanent chrome: the space it takes is always space
/// somebody asked for, unlike a nav entry that is present whether or not it has anything to say.
///
/// The order is the order they were starred in and nothing re-sorts it. This is a dock, not a feed:
/// a shortcut that moves because a server crashed has stopped being a shortcut, and the dot is what
/// carries the state.
function SidebarFavorites({ ids, hostById, servers, hosts, activeId, onOpen, onViewAll }) {
  if (!ids.length) return null;
  const shown = ids.slice(0, FAVORITES_SHOWN);
  const overflow = ids.length - shown.length;
  return (
    <div className="sidebar__favs">
      {shown.map((id) => {
        const server = servers.find((s) => s.id === id);
        if (server) {
          return (
            <ServerListItem
              key={id}
              server={server}
              active={activeId === id}
              onClick={() => onOpen(id)} />
          );
        }
        // Never dropped. A favourite that disappears while a node is rebooting looks exactly like one
        // somebody deleted, and the person cannot tell which happened.
        const { stale, why } = missingFavorite(hostById[id], hosts);
        return (
          <ServerListItem
            key={id}
            server={{ id, name: id, cover: null, status: "unknown" }}
            active={activeId === id}
            unknown
            tip={id + " — " + why}
            onClick={() => onOpen(id)}
            onForget={stale ? () => favoritesStore.forget(id) : null} />
        );
      })}
      {overflow > 0 && (
        <button type="button" className="sidebar__favs-more" onClick={onViewAll}
          data-tip={overflow + " more favourite" + (overflow === 1 ? "" : "s")}>
          <Icon name="ellipsis" size={14} />
          <span className="sidebar__favs-more__label">{overflow} more</span>
        </button>
      )}
    </div>
  );
}

/// The nodes, under Cluster — the same shortcut idiom the favourites hold under Servers, and the
/// one place the cluster's members are individually reachable from the chrome. Every node is drawn:
/// a node is not something a person opts into the way a server is starred, and a cluster whose
/// members came and went from this list would be unreadable as a list of what the panel drives.
///
/// The set is the connected roster — the nodes this browser drives. A peer discovered but not
/// connected stays on the Cluster page, where its "discovered, not connected" state can be said out
/// loud; a row here would have nothing to say.
///
/// The order is the roster's and nothing re-sorts it — a node that moves because it went offline
/// has stopped being a shortcut, and the dot is what carries the state.
function SidebarNodes({ hosts, activeHostId, onOpen }) {
  const refusals = useStore(sessionStore, s => s.nodes);
  if (!hosts.length) return null;
  return (
    <div className="sidebar__nodes">
      {hosts.map((h) => {
        const degraded = isDegraded(h, refusals[h.id]);
        // Three readings, all measured: answering, answering but not fully drivable, silent.
        const state = !h.online ? "offline" : degraded ? "warn" : "ok";
        const why = !h.online ? "hasn't answered"
          : degraded ? "needs a sign-in"
          : "online";
        const name = h.name || h.hostname || h.id;
        return (
          <div
            key={h.id}
            className={"node-row node-row--" + state + (activeHostId === h.id ? " node-row--active" : "")}
            onClick={() => onOpen(h.id)}
            data-tip={name + " — " + why}
            title={name + " — " + why}>
            <span className="node-row__icon"><Icon name="server" size={13} /></span>
            <span className="node-row__name">{name}</span>
            <span className="node-row__dot"></span>
          </div>
        );
      })}
    </div>
  );
}

/// SidebarAnchor — the auth anchor, under the nodes, for somebody who can act on what it waits for:
/// approving accounts, filing actions, deciding a service's requirements, or — for an Owner —
/// seeing what it approved on its own. The count is `anchorAttentionStore`'s, the same items the
/// anchor's overview lists, and the row opens that overview. Absent from the DOM for anybody else, and
/// while no member holds the cluster's accounts.
function SidebarAnchor({ activeHostId, onOpen }) {
  React.useEffect(() => { startAnchorAttention(); return stopAnchorAttention; }, []);
  const items = useStore(anchorAttentionStore, s => s.items);
  const holder = useStore(clusterStore, s => {
    const found = (s.capabilities || []).find(c => c.capability === "auth");
    return found && found.held ? found.memberId : null;
  });
  const member = useStore(clusterStore, s => (holder ? (s.nodes || []).find(n => n.nodeId === holder) || null : null));
  if (!holder || items === null || !anchorAttentionStore.concerned()) return null;

  const count = items.length;
  const tone = items.some(i => i.tone === "warn") ? "warn" : "info";
  const name = (member && (member.name || member.nodeId)) || holder;
  const tip = name + " — " + (count ? count + " waiting" : "nothing waiting");
  return (
    <div className="sidebar__nodes">
      <div
        className={"node-row" + (activeHostId === holder ? " node-row--active" : "")}
        onClick={() => onOpen(holder)}
        data-tip={tip}
        title={tip}>
        <span className="node-row__icon"><Icon name="anchor" size={13} /></span>
        <span className="node-row__name">{name}</span>
        {count > 0 && <span className={"nav-item__badge nav-item__badge--" + tone}>{count}</span>}
      </div>
    </div>
  );
}

// The signed-in user, pinned at the bottom of the foot: the design system's account row, saying how
// they signed in, with the panel's own menu.
function Account({ user, onSettings, onLogout, collapsed }) {
  const method = "Signed in with " + signInMethodLabel(user.provider);
  return (
    <SidebarAccount
      user={user}
      sub={method}
      detail={<><OAuthIcon provider={user.provider} size={11} />{method}</>}
      collapsed={collapsed}
      items={[
        { icon: "key", label: "API tokens", onClick: onSettings },
        { icon: "circle-help", label: "Help & docs" },
        { icon: "log-out", label: "Sign out", danger: true, onClick: onLogout },
      ]} />
  );
}

function Sidebar({ route = {}, onNavigate, serversCount = 0, serversTone = "info", clusterCount = 0, clusterTone = "info", attentionCount = 0, attentionTone = "info", user, onLogout, hosts = [], open, collapsed, onToggleCollapse }) {
  // Routing is the ONE contract from App: `route` (the current route) in, a single
  // `onNavigate({ kind })` out. Active state derives from route.kind here rather
  // than a bespoke boolean per entry plumbed down from App.
  const go = (kind) => () => onNavigate && onNavigate({ kind });
  const isActive = (kind) => route.kind === kind;
  // Read here rather than threaded from App: favourites are the sidebar's own business, and the one
  // routing contract above stays `route` in, `onNavigate` out.
  const favIds = useStore(favoritesStore, (s) => s.ids);
  const favHostById = useStore(favoritesStore, (s) => s.hostById);
  const servers = useStore(serversStore, (s) => s.list);

  // Nav visibility reads the ONE policy (persona.js) — no bespoke booleans
  // plumbed from App. Each entry is shown iff the persona holds its capability
  // on some host (aggregate). The breadcrumb derives from the same policy, so
  // the two can never disagree (architecture.html §3·f·1).
  const canDashboard = can("nav.dashboard");
  const canAlerts = can("nav.alerts");
  const canAudit = can("nav.audit");
  const canCluster = can("nav.cluster");
  // A count is in the rail's tooltip as well as on the badge, because the collapsed rail shrinks
  // the badge to a pip.
  const counted = (label, n) => label + (n > 0 ? " · " + n : "");
  return (
    <SidebarFrame
      mark="/assets/tks-mark.png"
      wordmark="Krystal Ship"
      open={open}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      foot={<>
        {/* One tray above the account, and it is this browser's own: what YOU did in it, and how it
            went. Fleet-wide work the nodes are executing is the `fleet.runs` widget's, pinned to the
            dashboard by whoever wants it — a second tray here would read as one list with this, and
            a run somebody else started would pass for something you did yourself. Both sit out of
            Monitoring, which is what the AlertEngine says about the fleet. */}
        {/* A toast's subject is the id of the server it was about. */}
        <NotificationsPanel onOpen={(id) => onNavigate && onNavigate({ kind: "server", id })} />
        <NavItem icon="settings" label="Settings" active={isActive("settings")} onClick={go("settings")} />
        {/* Last, because it is the heaviest thing here — an avatar and two lines — and it anchors the
            foot rather than sitting in the middle of it. Its popover opens upward for the same
            reason. */}
        {user && <Account user={user} onSettings={go("settings")} onLogout={onLogout} collapsed={collapsed} />}
      </>}>
      {/* Four groups, separated by a hairline and named by nothing. A label costs a row to say what
          the icons beside it already say, and the collapsed rail hides labels anyway, so both modes
          read the same way.

          A group the caller holds nothing of is ABSENT, not empty: the hairline is drawn between
          groups, so one left standing would rule off a space with nothing in it. Somebody holding
          no server read, alerts or roster gets one group and no separator, not a ladder. */}
      {canDashboard && (
        <SidebarGroup>
          <NavItem icon="home" label="Home" active={isActive("home")} onClick={go("home")} />
        </SidebarGroup>
      )}
      <SidebarGroup>
        <NavItem icon="server" label="Servers" active={isActive("servers")} onClick={go("servers")}
          badge={serversCount} tone={serversTone} tip={counted("Servers", serversCount)} />
        {/* The favourites belong to Servers the way the nodes belong to Cluster: each is a shortcut
            INTO the list above it, not a peer of the links beside it. */}
        <SidebarFavorites
          ids={favIds}
          hostById={favHostById}
          servers={servers}
          hosts={hosts}
          activeId={route.kind === "server" ? route.id : null}
          onOpen={(id) => onNavigate && onNavigate({ kind: "server", id })}
          onViewAll={go("servers")} />
        <NavItem icon="library" label={CATALOG_LABEL} active={isActive("library")} onClick={go("library")} />
      </SidebarGroup>
      {(canAlerts || canAudit) && (
        <SidebarGroup>
          {canAlerts && (
            <NavItem icon="triangle-alert" label="Alerts" active={isActive("attention")} onClick={go("attention")}
              badge={attentionCount} tone={attentionTone} tip={counted("Alerts", attentionCount)} />
          )}
          {canAudit && <NavItem icon="scroll-text" label="Audit log" active={isActive("audit")} onClick={go("audit")} />}
        </SidebarGroup>
      )}
      {canCluster && (
        <SidebarGroup>
          <NavItem icon="server-cog" label="Cluster" active={isActive("cluster")} onClick={go("cluster")}
            badge={clusterCount} tone={clusterTone} tip={counted("Cluster", clusterCount)} />
          <SidebarNodes
            hosts={hosts}
            activeHostId={route.kind === "cluster" ? route.hostId : null}
            onOpen={(id) => onNavigate && onNavigate({ kind: "cluster", hostId: id })} />
          <SidebarAnchor
            activeHostId={route.kind === "cluster" ? route.hostId : null}
            onOpen={(id) => onNavigate && onNavigate({ kind: "cluster", hostId: id })} />
        </SidebarGroup>
      )}
    </SidebarFrame>
  );
}

export { Sidebar };

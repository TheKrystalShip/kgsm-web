import React from "react";
import { Icon } from "./Icon.jsx";
import { KRYSTAL_LABELS } from "../lib/labels.js";
import { can } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { HostAuthBadge } from "../pages/HostAccess.jsx";
import { OAuthIcon } from "../pages/LoginPage.jsx";

// Sidebar component — brand, primary nav, quick actions.

// Catalog nav label — read from the shared label map so it can't drift from the
// dashboard's "Recently added" band or the breadcrumb. See labels.js KRYSTAL_LABELS.
const CATALOG_LABEL = (KRYSTAL_LABELS && KRYSTAL_LABELS.catalog) || "Catalog";

// HostSwitcher — GLOBAL scope selector. Lives above the nav and reframes the
// entire panel to one host, or "All hosts" (aggregate). Styled after the old
// diagnostics host card, but it's a real popover so it can carry the All-hosts
// entry and a link to the dedicated Hosts page. CRUD lives there, not here, to
// keep the sidebar clean.
function HostSwitcher({ hosts, selectedId, onSelect, onManage, collapsed }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const all = selectedId === "all";
  const current = all ? null : (hosts.find(h => h.id === selectedId) || hosts[0]);
  const onlineCount = hosts.filter(h => h.online).length;
  const currentDenied = current && sessionStore && sessionStore.isDenied(current.id);
  const dotClass = (h) => "host-switch__dot host-switch__dot--" + (h.online ? "online" : "off");

  const pick = (id) => { onSelect(id); setOpen(false); };

  // Two-letter abbreviation for the rail (initials, else first two chars).
  const codeOf = (h) => {
    const n = (h && h.name) ? h.name : "";
    const parts = n.split(/[\s-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (n || "??").slice(0, 2).toUpperCase();
  };

  return (
    <div className="host-switch" ref={ref}>
      <button
        className={"host-switch__trigger" + (open ? " host-switch__trigger--open" : "")}
        onClick={() => setOpen(o => !o)}
        data-tip={collapsed && !open ? (all ? "All hosts" : current.name) : undefined}
        aria-haspopup="listbox" aria-expanded={open} aria-label="Switch host scope">
        <span className="host-switch__lead">
          {all
            ? <Icon name="layers" size={16} />
            : currentDenied
              ? <Icon name="lock" size={14} />
              : <span className={dotClass(current)}></span>}
        </span>
        {collapsed ? (
          <span className="host-switch__code">{all ? "ALL" : codeOf(current)}</span>
        ) : (
          <>
            <span className="host-switch__main">
              {all ? (
                <>
                  <span className="host-switch__name">All hosts</span>
                  <span className="host-switch__sub">{hosts.length} hosts · {onlineCount} online</span>
                </>
              ) : (
                <>
                  <span className="host-switch__name">{current.name}</span>
                  <span className="host-switch__sub">{current.hostname} · {current.region}</span>
                </>
              )}
            </span>
            <Icon name="chevrons-up-down" size={14} className="host-switch__caret" />
          </>
        )}
      </button>

      {open && (
        <div className="host-switch__menu" role="listbox">
          {hosts.length > 1 && (
            <>
              <div className="host-switch__menu-label">Scope</div>
              <button
                className={"host-switch__opt" + (all ? " host-switch__opt--active" : "")}
                onClick={() => pick("all")} role="option" aria-selected={all}>
                <span className="host-switch__opt-lead"><Icon name="layers" size={15} /></span>
                <span className="host-switch__opt-text">
                  <span className="host-switch__opt-name">All hosts</span>
                  <span className="host-switch__opt-sub">Aggregate every connected host</span>
                </span>
                {all && <Icon name="check" size={15} className="host-switch__opt-check" />}
              </button>
              <div className="host-switch__menu-label">Hosts</div>
            </>
          )}
          {hosts.map(h => {
            const active = h.id === selectedId;
            return (
              <button
                key={h.id}
                className={"host-switch__opt" + (active ? " host-switch__opt--active" : "")}
                onClick={() => pick(h.id)} role="option" aria-selected={active}>
                <span className="host-switch__opt-lead"><span className={dotClass(h)}></span></span>
                <span className="host-switch__opt-text">
                  <span className="host-switch__opt-name">{h.name}</span>
                  <span className="host-switch__opt-sub">{h.hostname} · {h.region}</span>
                </span>
                {!h.online && <span className="host-switch__opt-flag">offline</span>}
                {HostAuthBadge && <HostAuthBadge hostId={h.id} size="sm" />}
                {active && <Icon name="check" size={15} className="host-switch__opt-check" />}
              </button>
            );
          })}

          <div className="host-switch__foot">
            <button className="host-switch__manage" onClick={() => { setOpen(false); onManage && onManage(); }}>
              <Icon name="settings-2" size={14} />
              Manage hosts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServerListItem({ server, active, onClick }) {
  const dotColor = {
    online: "var(--success)",
    updating: "var(--warning)",
    offline: "var(--fg-4)",
    crashed: "var(--danger)",
  }[server.status] || "var(--fg-4)";
  return (
    <div className={"server-row" + (active ? " server-row--active" : "")} onClick={onClick}>
      <div className="server-row__icon" style={{ background: server.cover ? `url("${server.cover}")` : server.art, backgroundSize: "cover", backgroundPosition: "center" }}></div>
      <span className="server-row__name">{server.name}</span>
      <span className="server-row__dot" style={{
        background: dotColor,
        animation: server.status === "online" || server.status === "updating" ? "kr-pulse 1.8s ease-in-out infinite" : "none",
      }}></span>
    </div>
  );
}

// SidebarAccount — the signed-in user, pinned in the sidebar foot above
// Settings. Replaces the old top-bar account menu now that the top bar is
// gone; its popover opens UPWARD (it lives at the very bottom of the panel).
function SidebarAccount({ user, onSettings, onLogout, collapsed }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="sidebar__account-wrap" ref={ref}>
      {open && (
        <div className="sidebar__account-menu" role="menu">
          <div className="sidebar__account-menu__head">
            <div className="sidebar__account-menu__name">{user.display || user.name}</div>
            <div className="sidebar__account-menu__provider">
              {OAuthIcon && <OAuthIcon provider={user.provider} size={11} />}
              Signed in via {user.provider}
            </div>
          </div>
          <button className="sidebar__account-menu__item" onClick={() => { setOpen(false); onSettings && onSettings(); }}><Icon name="key" size={14} />API tokens</button>
          <button className="sidebar__account-menu__item"><Icon name="circle-help" size={14} />Help &amp; docs</button>
          <button className="sidebar__account-menu__item sidebar__account-menu__item--danger" onClick={onLogout}><Icon name="log-out" size={14} />Sign out</button>
        </div>
      )}
      <button
        className={"sidebar__account" + (open ? " sidebar__account--open" : "")}
        onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        data-tip={collapsed && !open ? (user.display || user.name) : undefined}>
        <AccountAvatar user={user} size={28} />
        {!collapsed && (
          <>
            <span className="sidebar__account__text">
              <span className="sidebar__account__name">{user.display || user.name}</span>
              <span className="sidebar__account__sub">Signed in via {user.provider}</span>
            </span>
            <Icon name="chevrons-up-down" size={14} className="sidebar__account__caret" />
          </>
        )}
      </button>
    </div>
  );
}

function Sidebar({ onHome, homeActive, onServers, serversActive, serversCount = 0, serversTone = "info", onLibrary, libraryActive, onDiscord, discordActive, onAudit, auditActive, onFleet, fleetActive, fleetCount = 0, fleetTone = "info", onChat, chatActive, onAttention, attentionActive, attentionCount = 0, attentionTone = "info", onSettings, settingsActive, user, onLogout, hosts = [], selectedHostId = "all", onSelectHost, open, collapsed, onToggleCollapse }) {
  // Nav visibility reads the ONE policy (persona.js) — no bespoke booleans
  // plumbed from App. Each entry is shown iff the persona holds its capability
  // on some host (aggregate). The breadcrumb derives from the same policy, so
  // the two can never disagree (architecture.html §3·f·1).
  const canDashboard = can("nav.dashboard");
  const canAlerts = can("nav.alerts");
  const canAudit = can("nav.audit");
  const canFleet = can("nav.fleet");
  const showMonitoring = canAlerts || canAudit || canFleet;
  return (
    <aside className={"sidebar" + (open ? " sidebar--open" : "") + (collapsed ? " sidebar--rail" : "")}>
      <div className="sidebar__brand">
        <img src="/assets/tks-mark.png" width="32" height="32" alt="" style={{ objectFit: "contain" }} />
        <span className="sidebar__brand-wordmark">Krystal Ship</span>
        <button
          type="button"
          className="sidebar__collapse"
          onClick={onToggleCollapse}
          data-tip={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={16} />
        </button>
      </div>
      <HostSwitcher hosts={hosts} selectedId={selectedHostId} onSelect={onSelectHost} onManage={onFleet} collapsed={collapsed} />
      <nav className="sidebar__nav">
        <div className="sidebar__group">
          <div className="sidebar__group-label">Workspace</div>
          {canDashboard && (
          <div className={"nav-item" + (homeActive ? " nav-item--active" : "")} onClick={onHome} data-tip="Home" aria-label="Home">
            <Icon name="home" size={16} />
            <span className="nav-item__label">Home</span>
          </div>
          )}
          <div className={"nav-item" + (serversActive ? " nav-item--active" : "")} onClick={onServers} data-tip={"Servers" + (serversCount > 0 ? " · " + serversCount : "")} aria-label="Servers">
            <Icon name="server" size={16} />
            <span className="nav-item__label">Servers</span>
            {serversCount > 0 && <span className={"nav-item__badge nav-item__badge--" + serversTone}>{serversCount}</span>}
          </div>
          <div className={"nav-item" + (libraryActive ? " nav-item--active" : "")} onClick={onLibrary} data-tip={CATALOG_LABEL} aria-label={CATALOG_LABEL}>
            <Icon name="library" size={16} />
            <span className="nav-item__label">{CATALOG_LABEL}</span>
          </div>
        </div>
        {showMonitoring && (
        <div className="sidebar__group">
          <div className="sidebar__group-label">Monitoring</div>
          {canAlerts && (
          <div className={"nav-item" + (attentionActive ? " nav-item--active" : "")} onClick={onAttention} data-tip={"Alerts" + (attentionCount > 0 ? " · " + attentionCount : "")} aria-label="Alerts">
            <Icon name="triangle-alert" size={16} />
            <span className="nav-item__label">Alerts</span>
            {attentionCount > 0 && <span className={"nav-item__badge nav-item__badge--" + attentionTone}>{attentionCount}</span>}
          </div>
          )}
          {canFleet && (
          <div className={"nav-item" + (fleetActive ? " nav-item--active" : "")} onClick={onFleet} data-tip={"Fleet" + (fleetCount > 0 ? " · " + fleetCount : "")} aria-label="Fleet">
            <Icon name="server-cog" size={16} />
            <span className="nav-item__label">Fleet</span>
            {fleetCount > 0 && <span className={"nav-item__badge nav-item__badge--" + fleetTone}>{fleetCount}</span>}
          </div>
          )}
          {canAudit && (
          <div className={"nav-item" + (auditActive ? " nav-item--active" : "")} onClick={onAudit} data-tip="Audit log" aria-label="Audit log">
            <Icon name="scroll-text" size={16} />
            <span className="nav-item__label">Audit log</span>
          </div>
          )}
        </div>
        )}
      </nav>
      <div className="sidebar__foot">
        {user && <SidebarAccount user={user} onSettings={onSettings} onLogout={onLogout} collapsed={collapsed} />}
        <div className={"nav-item" + (settingsActive ? " nav-item--active" : "")} onClick={onSettings} data-tip="Settings" aria-label="Settings">
          <Icon name="settings" size={16} />
          <span className="nav-item__label">Settings</span>
        </div>
      </div>
    </aside>
  );
}

function AccountAvatar({ user, size = 24 }) {
  // Discord avatars come from cdn.discordapp.com via the OAuth profile; until one
  // is available we synthesise a teal-gradient circle with an initial.
  const initial = (user.display || user.name || "?")[0].toUpperCase();
  return (
    <span style={{
      width: size, height: size, borderRadius: 999,
      background: "linear-gradient(135deg, #5DB5D2, #2F89A8)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "var(--fg-inverse)", fontSize: size * 0.46, fontWeight: 700,
      flexShrink: 0,
    }}>{initial}</span>
  );
}

function TopNav({ tab, onTab, user, onLogout, onMenu, onHome, onAssistant, assistantOpen, onSettings }) {
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Close menu on outside click.
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  return (
    <div className="topbar">
      <button className="topbar__menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" size={18} />
      </button>
      <span className="topbar__brand-inline" onClick={onHome} style={{ marginRight: 8, cursor: "pointer" }}>
        <img src="/assets/tks-mark.png" alt="" />
        <span>Krystal</span>
      </span>
      <span className="topbar__spacer"></span>
      <button
        className={"topbar__assistant" + (assistantOpen ? " topbar__assistant--on" : "")}
        onClick={onAssistant}
        title="Toggle assistant"
        aria-label="Toggle assistant">
        <Icon name="bot" size={16} />
        <span className="topbar__assistant__label">Assistant</span>
      </button>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <span className="topbar__account" onClick={() => setMenuOpen(o => !o)}>
          <AccountAvatar user={user} size={24} />
          <span className="topbar__account__label">{user.display || user.name}</span>
          <Icon name="chevron-down" size={14} />
        </span>
        {menuOpen && (
          <div className="topbar__account-menu">
            <div className="topbar__account-menu__head">
              <div className="topbar__account-menu__name">{user.display || user.name}</div>
              <div className="topbar__account-menu__provider">
                <OAuthIcon provider={user.provider} size={11} />
                Signed in via {user.provider}
              </div>
            </div>
            <div className="topbar__account-menu__item" onClick={() => { setMenuOpen(false); onSettings && onSettings(); }}><Icon name="settings" size={14} />Settings</div>
            <div className="topbar__account-menu__item" onClick={() => { setMenuOpen(false); onSettings && onSettings(); }}><Icon name="key" size={14} />API tokens</div>
            <div className="topbar__account-menu__item"><Icon name="circle-help" size={14} />Help & docs</div>
            <div className="topbar__account-menu__item topbar__account-menu__item--danger" onClick={onLogout}>
              <Icon name="log-out" size={14} />Sign out
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { AccountAvatar, HostSwitcher, ServerListItem, Sidebar, SidebarAccount, TopNav };

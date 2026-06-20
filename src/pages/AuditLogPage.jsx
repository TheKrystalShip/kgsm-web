import React from "react";
import { Icon } from "../components/Icon.jsx";
import { Pagination, useDebouncedValue } from "../components/Pagination.jsx";
import { AccountAvatar } from "../components/Sidebar.jsx";
import { AuditSkeleton } from "../components/Skeletons.jsx";
import { Toolbar, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSpacer } from "../components/Toolbar.jsx";
import { useStore } from "../lib/store.js";
import { auditEventHost, auditInScope, auditStore, hostsStore, selectedHostStore, serversStore, useSelectedHostId } from "../lib/stores.js";

// AuditLogPage — searchable, filterable timeline of every action taken on
// Krystal. Same data feeds the small "Recent activity" panel on the
// dashboard; this page is the canonical view with filters and search.

// ---------- Action metadata ----------
// Maps a dot-notation action key to its display details: human label, the
// Lucide icon to show on the timeline pill, and the severity tone used to
// colour that pill.  Severity tones map directly to the design system's
// semantic colors.
const ACTION_META = {
  "server.install":        { label: "Server installed",   icon: "package-plus",  tone: "success" },
  "server.start":          { label: "Server started",     icon: "play",          tone: "success" },
  "server.stop":           { label: "Server stopped",     icon: "square",        tone: "danger"  },
  "server.restart":        { label: "Server restarted",   icon: "rotate-cw",     tone: "update"  },
  "server.update":         { label: "Server updated",     icon: "download",      tone: "info"    },
  "server.crash":          { label: "Server crashed",     icon: "alert-triangle",tone: "danger"  },
  "server.rename":         { label: "Server renamed",     icon: "pencil",        tone: "info"    },
  "server.delete":         { label: "Server deleted",     icon: "trash-2",       tone: "danger"  },
  "player.join":           { label: "Player joined",      icon: "log-in",        tone: "info"    },
  "player.leave":          { label: "Player left",        icon: "log-out",       tone: "info"    },
  "player.kick":           { label: "Player kicked",      icon: "user-x",        tone: "warn"    },
  "player.ban":            { label: "Player banned",      icon: "shield-off",    tone: "danger"  },
  "player.unban":          { label: "Player unbanned",    icon: "shield-check",  tone: "info"    },
  "player.allow.add":      { label: "Allowlist updated",  icon: "user-check",    tone: "info"    },
  "player.allow.remove":   { label: "Allowlist updated",  icon: "user-x",        tone: "warn"    },
  "backup.create":         { label: "Backup created",     icon: "database",      tone: "success" },
  "backup.restore":        { label: "Backup restored",    icon: "rotate-ccw",    tone: "warn"    },
  "backup.delete":         { label: "Backup deleted",     icon: "trash-2",       tone: "danger"  },
  "backup.download":       { label: "Backup downloaded",  icon: "download",      tone: "info"    },
  "file.edit":             { label: "File edited",        icon: "file-pen",      tone: "info"    },
  "file.upload":           { label: "File uploaded",      icon: "upload",        tone: "info"    },
  "file.delete":           { label: "File deleted",       icon: "trash-2",       tone: "danger"  },
  "settings.change":       { label: "Settings changed",   icon: "settings",      tone: "info"    },
  "host.connect":          { label: "Host connected",     icon: "power",         tone: "success" },
  "host.disconnect":       { label: "Host disconnected",  icon: "power-off",     tone: "warn"    },
  "host.update":           { label: "Host updated",       icon: "package",       tone: "info"    },
  "host.add":              { label: "Host added",         icon: "server-cog",    tone: "success" },
  "host.remove":           { label: "Host removed",       icon: "trash-2",       tone: "danger"  },
  "auth.login":            { label: "Signed in",          icon: "log-in",        tone: "info"    },
  "auth.logout":           { label: "Signed out",         icon: "log-out",       tone: "info"    },
  "auth.token.create":     { label: "API token created",  icon: "key",           tone: "info"    },
  "discord.webhook.update":{ label: "Discord updated",    icon: "message-circle",tone: "info"    },
};

// Top-level category derived from the action key (the bit before the first dot).
function actionCategory(action) {
  return action.split(".")[0];
}
const CATEGORY_LABEL = {
  server:   "Server",
  player:   "Players",
  backup:   "Backups",
  file:     "Files",
  settings: "Settings",
  auth:     "Auth",
  discord:  "Discord",
  host:     "Hosts",
};

// ---------- Time helpers ----------

function parseTs(ts) { return new Date(ts.replace(" ", "T")); }

function fmtRelative(date, now = new Date()) {
  const diff = (now - date) / 1000;
  if (diff < 60)    return Math.max(0, Math.floor(diff)) + "s ago";
  if (diff < 3600)  return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function dayBucket(date, now = new Date()) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((d0 - dd) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

// ---------- Query ----------

// Apply the aggregated filter set to the event list. This is the client-side
// stand-in for the server's WHERE clause: in production the same `filters`
// object is sent as query params (GET /audit?…) and this function disappears —
// the backend returns the already-filtered, already-paginated page. `filters.
// query` arrives pre-trimmed and lower-cased so the hot path does no work.
function queryAudit(list, filters, now) {
  const rangeMs = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3, "all": Infinity }[filters.range];
  const cutoff = new Date(now.getTime() - rangeMs);
  const q = filters.query;
  return list.filter(ev => {
    if (parseTs(ev.ts) < cutoff) return false;
    if (filters.category !== "all" && actionCategory(ev.action) !== filters.category) return false;
    if (filters.actor    !== "all" && ev.actor.name !== filters.actor) return false;
    if (filters.server   !== "all" && ev.serverId !== filters.server) return false;
    if (filters.severity === "attention" && ev.severity !== "warn" && ev.severity !== "danger") return false;
    if (filters.severity !== "all" && filters.severity !== "attention" && ev.severity !== filters.severity) return false;
    if (q) {
      const hay = [ev.summary, ev.action, ev.actor.name, ev.target?.name || "", JSON.stringify(ev.meta || {})].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------- Components ----------

function AuditActor({ actor, size = 28 }) {
  const isSystem = actor.provider === "system";
  if (isSystem) {
    return (
      <span style={{
        width: size, height: size, borderRadius: 999,
        background: "var(--surface-3)", color: "var(--fg-3)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }} title="System">
        <Icon name="bot" size={size * 0.55} />
      </span>
    );
  }
  return <AccountAvatar user={actor} size={size} />;
}

function AuditEventRow({ ev, now, hosts }) {
  const meta = ACTION_META[ev.action] || { label: ev.action, icon: "circle-dot", tone: "info" };
  const date = parseTs(ev.ts);
  // Render meta dictionary as compact "key=value" chips, but skip a few
  // ones already covered in the summary so we don't double-print.
  const metaEntries = Object.entries(ev.meta || {}).filter(([k]) => k !== "source");
  // Host provenance: explicit hostId / derived from server / null = panel-wide.
  const hostId = auditEventHost ? auditEventHost(ev) : ev.hostId;
  const host = hostId ? (hosts || []).find(h => h.id === hostId) : null;

  return (
    <div className="audit-row">
      <AuditActor actor={ev.actor} />
      <div className="audit-row__main">
        <div className="audit-row__line">
          <span className="audit-row__actor">{ev.actor.name}</span>
          {" "}
          <span className="audit-row__summary">{ev.summary}</span>
        </div>
        <div className="audit-row__meta">
          <span className={"audit-pill audit-pill--" + meta.tone}>
            <Icon name={meta.icon} size={11} strokeWidth={2.2} className="audit-pill__icon" />
            {ev.action}
          </span>
          <span className={"audit-row__host" + (hostId ? "" : " audit-row__host--panel")} title={hostId ? "Host: " + (host ? host.name : hostId) : "Panel-wide event"}>
            <Icon name={hostId ? "server" : "layers"} size={10} strokeWidth={2.2} />
            {hostId ? (host ? host.name : hostId) : "panel"}
          </span>
          {metaEntries.map(([k, v]) => (
            <span key={k} className="audit-row__chip"><b>{k}:</b> {String(v)}</span>
          ))}
          {ev.meta?.source && (
            <span className="audit-row__chip"><Icon name="circle-arrow-out-up-right" size={10} /> {ev.meta.source}</span>
          )}
        </div>
      </div>
      <div className="audit-row__when" title={date.toLocaleString()}>
        <span className="audit-row__time">{fmtTime(date)}</span>
        <span className="audit-row__rel">{fmtRelative(date, now)}</span>
      </div>
    </div>
  );
}

function AuditLogPage({ initialSeverity, initialServer }) {
  const all = useStore(auditStore, s => s.list);
  const dataLoading = useStore(auditStore, s => s.status === "loading" && !s.everLoaded);
  const allServers = useStore(serversStore, s => s.list);
  const hosts = useStore(hostsStore, s => s.list);
  const selectedId = useSelectedHostId();
  // Soft host scope: under a specific host, the log shows that host's server
  // events plus global/account events (auth, tokens) — see auditInScope.
  const scoped = React.useMemo(
    () => all.filter(ev => auditInScope(ev, selectedId)),
    [all, selectedId]
  );
  const servers = selectedId === "all" ? allServers : allServers.filter(s => s.hostId === selectedId);
  const actorOpts = React.useMemo(() => {
    const set = new Set(scoped.map(e => e.actor.name));
    return ["all", ...Array.from(set)];
  }, [scoped]);

  const [query, setQuery]     = React.useState("");
  const [category, setCat]    = React.useState("all");
  const [actor, setActor]     = React.useState("all");
  const [server, setServer]   = React.useState(initialServer || "all");
  const [range, setRange]     = React.useState("all");
  // "attention" = warn + danger (what the Alerts button pre-selects).
  const [severity, setSeverity] = React.useState(initialSeverity || "all");

  // Always work against the "now" of the fixture (latest event in the log),
  // not real time — otherwise the demo's day buckets and relative times drift.
  const now = React.useMemo(
    () => scoped.length ? parseTs(scoped[0].ts) : new Date(),
    [scoped]
  );

  // Debounce the free-text search so we don't re-query on every keystroke. The
  // dropdowns and range tabs apply instantly; only typing waits out a 250ms
  // quiet window. `searchPending` lets the input show that it's settling.
  const debouncedQuery = useDebouncedValue(query, 250);
  const searchPending = query.trim() !== debouncedQuery.trim();

  // The single aggregated filter set — this object IS the request. In
  // production it serializes straight to the query string:
  //   GET /audit?cursor=&limit=25&q=&category=&actor=&serverId=&severity=&range=
  // Memoizing it on its inputs means "the query changed" is one identity check.
  const filters = React.useMemo(() => ({
    query: debouncedQuery.trim().toLowerCase(),
    category, actor, server, severity, range,
  }), [debouncedQuery, category, actor, server, severity, range]);

  // Run the aggregated query (client-side stand-in for the server WHERE clause).
  const filtered = React.useMemo(
    () => queryAudit(scoped, filters, now),
    [scoped, filters, now]
  );

  // ---- Pagination (25 / page) -------------------------------------------
  // The log grows without bound over time, so we never render it whole. The
  // backend pages with a keyset cursor (architecture §3·d); here we slice the
  // filtered list into 25-row pages.
  const PAGE_SIZE = 25;
  const [page, setPage] = React.useState(0);
  // Any change to the aggregated filters (including the debounced search) is a
  // fresh query — snap back to the first page so you're not stranded on page 7
  // of a result set that no longer has 7 pages.
  React.useEffect(() => { setPage(0); }, [filters]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Group the CURRENT PAGE by day for the timeline. Insertion order matters
  // since the log is already sorted newest-first.
  const grouped = [];
  for (const ev of pageItems) {
    const bucket = dayBucket(parseTs(ev.ts), now);
    const last = grouped[grouped.length - 1];
    if (last && last.bucket === bucket) last.events.push(ev);
    else grouped.push({ bucket, events: [ev] });
  }

  const categories = ["all", "server", "host", "player", "backup", "file", "settings", "auth", "discord"];
  const ranges     = ["1h", "24h", "7d", "30d", "all"];

  const resetFilters = () => { setQuery(""); setCat("all"); setActor("all"); setServer("all"); setRange("all"); setSeverity("all"); };
  const filtersActive = query || category !== "all" || actor !== "all" || server !== "all" || range !== "all" || severity !== "all";

  // Per-option counts behind each filter dimension, computed off the host-scoped
  // event set so the popover shows how many events each choice would surface.
  const auditCounts = React.useMemo(() => {
    const by = (keyFn) => { const c = {}; scoped.forEach(ev => { const k = keyFn(ev); if (k != null) c[k] = (c[k] || 0) + 1; }); return c; };
    const sev = by(ev => ev.severity);
    return {
      total: scoped.length,
      category: by(ev => ev.category),
      actor: by(ev => ev.actor.name),
      server: by(ev => ev.serverId),
      severity: { ...sev, attention: (sev.warn || 0) + (sev.danger || 0) },
    };
  }, [scoped]);

  return (
    <>
      <div className="dash-head">
        <h1>Audit log</h1>
        <div className="dash-head__sub">Every action on Krystal — by you, your crew, or our automation. Search, filter, export.</div>
      </div>

      {dataLoading ? <AuditSkeleton /> : (<>
      <Toolbar>
        <ToolbarSearch value={query} onChange={setQuery} pending={searchPending} placeholder="Search actions, players, files…" />

        <ToolbarFilters
          fields={[
            { id: "category", label: "Category", value: category, onChange: setCat, default: "all",
              options: categories.map(c => ({ value: c, label: c === "all" ? "All categories" : (CATEGORY_LABEL[c] || c), count: c === "all" ? auditCounts.total : auditCounts.category[c] })) },
            { id: "host", label: "Host", value: selectedId, onChange: v => selectedHostStore.set(v), default: "all", hidden: hosts.length <= 1,
              options: [{ value: "all", label: "All hosts" }, ...hosts.map(h => ({ value: h.id, label: h.name }))] },
            { id: "actor", label: "User", value: actor, onChange: setActor, default: "all",
              options: actorOpts.map(a => ({ value: a, label: a === "all" ? "All users" : a, count: a === "all" ? undefined : auditCounts.actor[a] })) },
            { id: "severity", label: "Severity", value: severity, onChange: setSeverity, default: "all", options: [
              { value: "all",       label: "All severities", count: auditCounts.total },
              { value: "attention", label: "Alerts",         count: auditCounts.severity.attention },
              { value: "danger",    label: "Danger",         count: auditCounts.severity.danger },
              { value: "warn",      label: "Warning",        count: auditCounts.severity.warn },
              { value: "info",      label: "Info",           count: auditCounts.severity.info },
              { value: "success",   label: "Success",        count: auditCounts.severity.success },
            ] },
            { id: "server", label: "Server", value: server, onChange: setServer, default: "all",
              options: [{ value: "all", label: "All servers" }, ...servers.map(s => ({ value: s.id, label: s.name, count: auditCounts.server[s.id] }))] },
            { id: "range", label: "Time range", value: range, onChange: setRange, default: "all", options: [
              { value: "1h",  label: "Last hour" },
              { value: "24h", label: "Last 24 hours" },
              { value: "7d",  label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "all", label: "All time" },
            ] },
          ]}
          onReset={() => setQuery("")} />

        <ToolbarSpacer />
        <ToolbarCount shown={filtered.length} total={scoped.length} unit="events" />
      </Toolbar>

      {grouped.length === 0 && (
        <div style={{
          background: "var(--surface-1)", border: "1px solid var(--border-subtle)",
          borderRadius: "var(--r-lg)", padding: 48, textAlign: "center", color: "var(--fg-3)",
        }}>
          <Icon name="search-x" size={26} />
          <div style={{ marginTop: 10, color: "var(--fg-2)", fontWeight: 600, fontSize: 14 }}>No events match these filters</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>Try widening the time range or clearing the search.</div>
        </div>
      )}

      <div className="audit-timeline">
        {grouped.map(group => (
          <section key={group.bucket} className="audit-group">
            <h3 className="audit-group__title">
              <span>{group.bucket}</span>
              <span className="audit-group__count">{group.events.length}</span>
            </h3>
            <div className="audit-group__events">
              {group.events.map(ev => (
                <AuditEventRow key={ev.id} ev={ev} now={now} hosts={hosts} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <Pagination
        page={safePage}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        unit="events"
      />
      </>)}
    </>
  );
}

export { ACTION_META, AuditLogPage, actionCategory, fmtRelative, fmtTime, parseTs };

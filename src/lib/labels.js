// labels.js — shared UI labels: the single source of truth for nav/section names
// that appear in more than one place. Rename here and every reference updates
// (sidebar nav, the dashboard "Recently added" band, breadcrumbs…), so the
// surfaces can't drift.
export const KRYSTAL_LABELS = {
  catalog: "Catalog",
};

// The sub-tabs each tabbed route offers, in the order their strip shows them. A tab is a
// URL segment (`#/servers/<id>/performance`), so its name is read in two places: the strip
// the page draws, and the breadcrumb the shell draws above it. Both take it from here.
//
// Only the shape a tab always has lives here — id, label, icon. Whether a tab is *offered*
// stays with the page: badges count that page's alerts, and Files/Backups/Settings are
// operator surfaces a player never sees, which is a policy question the page answers.
export const ROUTE_TABS = {
  server: [
    { id: "overview",    label: "Overview",    icon: "layout-grid" },
    { id: "performance", label: "Performance", icon: "line-chart" },
    { id: "files",       label: "Files",       icon: "folder" },
    { id: "backups",     label: "Backups",     icon: "database" },
    { id: "settings",    label: "Settings",    icon: "settings" },
  ],
  game: [
    { id: "overview",  label: "Overview",  icon: "layout-grid" },
    { id: "blueprint", label: "Blueprint", icon: "sliders-horizontal" },
    { id: "servers",   label: "Servers",   icon: "server" },
    { id: "file",      label: "File",      icon: "file-code" },
  ],
  // An ANCHOR's tabs. A cluster member is a node or an anchor and both are reached at
  // #/cluster/member/<member>, so both name their tabs here — what differs is which set, because an anchor
  // runs no game servers and has no capacity to report and serves one capability instead.
  //
  // This is the VOCABULARY, not what any one anchor offers: `anchorTabs` below picks the subset a
  // member can actually answer, and the breadcrumb reads this list to name whichever the URL carries.
  anchor: [
    { id: "overview", label: "Overview", icon: "layout-grid" },
    { id: "conversations", label: "Conversations", icon: "messages-square" },
    { id: "users",    label: "Users",    icon: "users" },
    { id: "logs",     label: "Logs",     icon: "scroll-text" },
    { id: "config",   label: "Configuration", icon: "sliders-horizontal" },
    { id: "names",        label: "Names",        icon: "globe" },
    { id: "certificates", label: "Certificates", icon: "badge-check" },
    { id: "settings", label: "Settings", icon: "settings" },
  ],
  // The CLUSTER page's own tabs, at #/cluster/<tab> — distinct from `cluster` below, which is one
  // MEMBER's tabs at #/cluster/member/<member>/<tab>. Both live under the same URL word because a
  // cluster and its members are the same subject at two depths; the `member` word between them is
  // what keeps a member id out of this table's vocabulary (see router.js).
  clusterRoot: [
    { id: "overview",     label: "Overview",     icon: "layout-grid" },
    { id: "reach",        label: "Reach",        icon: "waypoints" },
    { id: "capabilities", label: "Capabilities", icon: "grid-3x3" },
  ],
  // A member the roster names and no session reaches. It measures nothing, so the only tab it can
  // answer is the one about its place in the cluster — and a departed member is the one somebody
  // most often came to act on.
  member: [
    { id: "settings", label: "Settings", icon: "settings" },
  ],
  cluster: [
    { id: "overview",  label: "Overview",  icon: "layout-grid" },
    { id: "resources", label: "Resources", icon: "activity" },
    { id: "services",  label: "Services",  icon: "server-cog" },
    { id: "jobs",      label: "Jobs",      icon: "list-checks" },
    { id: "logs",      label: "Logs",      icon: "scroll-text" },
    { id: "settings",  label: "Settings",  icon: "settings" },
  ],
  // The leaf shell's own tabs. A leaf's extra tabs are registered with their bodies in
  // LeafPage and named by TAB_LABEL_FALLBACK below, since a body cannot live here.
  leaf: [
    { id: "overview", label: "Overview", icon: "layout-dashboard" },
    { id: "system",   label: "System",   icon: "server-cog" },
    { id: "logs",     label: "Logs",     icon: "scroll-text" },
    { id: "settings", label: "Settings", icon: "sliders-horizontal" },
  ],
  settings: [
    { id: "profile",       label: "Profile",       icon: "user" },
    { id: "security",      label: "Security",      icon: "key-round" },
    { id: "devices",       label: "Devices",       icon: "monitor-smartphone" },
    { id: "memory",        label: "Memory",        icon: "brain" },
    { id: "notifications", label: "Notifications", icon: "bell" },
  ],
};

// The tab a route lands on when its URL names none — the one segment the hash leaves out,
// so it is also the one tab the breadcrumb has no crumb for.
export const ROUTE_DEFAULT_TAB = {
  server: "overview",
  clusterRoot: "overview",
  game: "overview",
  cluster: "overview",
  leaf: "overview",
  settings: "profile",
};

// Tabs a page registers next to their bodies rather than in the table above: the leaves'
// extra tabs. Named here so the breadcrumb can read a name it has no other way to reach.
const TAB_LABEL_FALLBACK = {
  library: "Library",
  conversations: "Conversations",
  users: "Users",
  thresholds: "Thresholds",
  windows: "Windows",
  commands: "Commands",
};

// Which of an anchor's tabs a given member offers.
//
// An anchor serves ONE capability, and everything past Overview and Settings belongs to it: the
// accounts, the journal and the configuration are kgsm-auth's own routes, reached at the door this
// browser signed in through. A member that does not hold `auth` answers none of them, so offering
// them pointed its page at a different member.
//
// Overview and Settings are every member's. What a member is, what it holds, how far away it is and
// where it is come from the roster; moving a capability and removing a member are the cluster's acts
// rather than the member's, addressed to whoever answered the roster.
//
// A capability gains a tab by gaining a row here, once the member behind it actually serves one.
const ANCHOR_CAPABILITY_TABS = {
  auth: ["users", "logs", "config"],
  assistant: ["conversations"],
  dns: ["names", "certificates"],
};
const ANCHOR_TABS_ALWAYS = ["overview", "settings"];

export function anchorTabs(capability) {
  const held = ANCHOR_CAPABILITY_TABS[capability] || [];
  return ROUTE_TABS.anchor.filter(t => ANCHOR_TABS_ALWAYS.includes(t.id) || held.includes(t.id));
}

// Whether one anchor tab is on screen for a member holding `capability`. The breadcrumb asks so it
// names a tab the page is actually showing — a crumb for a tab that resolved back to Overview
// announces a place that is not there.
export function anchorOffersTab(capability, id) {
  return !!id && anchorTabs(capability).some(t => t.id === id);
}

// The name of one tab, or null when the id belongs to no tab this route offers. Null is the
// honest answer for a stale or mistyped segment: the page falls back to its default tab, so a
// crumb naming the segment would announce a place that isn't on screen.
export function tabLabel(kind, id) {
  if (!id) return null;
  const found = (ROUTE_TABS[kind] || []).find(t => t.id === id);
  if (found) return found.label;
  return kind === "leaf" ? (TAB_LABEL_FALLBACK[id] || null) : null;
}

// router.js — the URL <-> route bridge.
//
// The app's navigational state (which page, which server + tab, which focused
// host, list entry-filters) is a small `route` object. This module is the pure,
// framework-free translation between that object and a URL hash, so the URL can
// finally be the source of truth it always pretended to be: Back/Forward work,
// a refresh restores your place, and any view is a shareable/bookmarkable link.
//
// Why the hash (not the History pathname): the panel is a single static
// document that can be opened from a file path, a preview sandbox, or a real
// host. `location.hash` navigation works identically in all three and never
// risks a SecurityError, so it's the robust choice for a client-rendered SPA.
//
// URL scheme
//   #/                       home / dashboard
//   #/servers                server list           (?status=offline&node=<hostId> entry filters)
//   #/servers/<id>           server detail (overview)
//   #/servers/<id>/<tab>     server detail, a specific tab
//   #/library                game library          (?filter=installed entry filter)
//   #/library/new            author a new blueprint
//   #/library/<id>           game detail (overview)
//   #/library/<id>/<tab>     game detail, a specific tab
//   #/alerts                 alerts board
//   #/audit                  audit log             (?severity=danger entry filter)
//   #/cluster                       the cluster — its members, at a glance
//   #/cluster/<tab>                 the cluster, a specific tab (reach, capabilities)
//   #/cluster/member/<member>       one member — a node's deep-dive, or an anchor's page
//   #/cluster/member/<member>/<tab> that member, a specific tab
//   #/cluster/member/<hostId>/services/<leaf>[/<tab>]
//                                   one leaf on that node — the Services tab drilled in
//   #/config/<hostId>        a node's leaf configuration (first configurable leaf)
//   #/config/<hostId>/<leaf> one leaf's configuration surface
//   #/settings               account settings (Profile)
//   #/settings/<tab>         account settings, a specific tab
//
// In front of the app, where there is no session yet:
//   #/connect                which cluster to authenticate against
//   #/signin                 sign in to that cluster
//   #/register               make an account on it
//   #/pending                signed in, holding nothing, waiting on an administrator
//
// A leaf page nests UNDER the node's Services tab because that is exactly where
// you reach it from: the URL keeps descending instead of jumping to a sibling
// top-level word, so the path reads as the trail you walked.
//
// A MEMBER is named under an explicit `member` word. A cluster and its members are the same
// subject at two depths, and without that word the segment after /cluster would have to be read
// as either a member id or one of the cluster's own tab names — which means reserving every tab
// word out of the id space, forever, and shadowing any member unlucky enough to be called one.
// The word costs a segment and removes the question. It also leaves `#/cluster/members` free for
// a list of them.
//
// The URL words #/diagnostics and #/hosts are aliases that resolve to #/cluster,
// #/leaf/<hostId>/<leaf> resolves to the nested leaf path, and the member route's older
// unprefixed shape still resolves — so old links and bookmarks keep working. None of those is
// ever emitted.
//
// Internal route.kind names differ from a couple of URL words on purpose
// (kind "attention" ↔ /alerts) — the URL speaks the user's language, the code
// keeps its existing vocabulary.

  const enc = encodeURIComponent;
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  // The cluster page's own tab words. A member is named under `member/`, so these collide with
  // nothing a link made today can carry — they are read here to resolve the tab, and they win over
  // the unprefixed legacy member shape below.
  // Mirrors ROUTE_TABS.clusterRoot in labels.js: a tab added there is added here.
  const CLUSTER_ROOT_TABS = new Set(["overview", "reach", "capabilities"]);

  // clusterMember(rest) — one member's route, from the segments after whatever named it.
  // `rest[0]` is the member; a `services/<leaf>` pair below it is a page of its own rather than a
  // tab, because that is exactly where it is opened from. Bare `/services` stays the member's tab,
  // so the drill-in only happens once a leaf is named.
  function clusterMember(rest) {
    if (rest[1] && rest[1].toLowerCase() === "services" && rest[2]) {
      const l = { kind: "leaf", hostId: dec(rest[0]), leaf: dec(rest[2]) };
      // `settings` is a member's place in the cluster, which a component does not have; what a
      // component has is a configuration. A link carrying the older word still resolves to it, and
      // is never emitted.
      if (rest[3]) l.tab = rest[3].toLowerCase() === "settings" ? "config" : dec(rest[3]);
      return l;
    }
    const r = { kind: "cluster", hostId: dec(rest[0]) };
    if (rest[1]) r.tab = dec(rest[1]);
    return r;
  }

  // route object  ->  "#/..."
  function routeToHash(route) {
    if (!route || !route.kind) return "#/";
    switch (route.kind) {
      case "home":      return "#/";
      case "servers": {
        const p = [];
        if (route.status) p.push("status=" + enc(route.status));
        if (route.node) p.push("node=" + enc(route.node));
        return "#/servers" + (p.length ? "?" + p.join("&") : "");
      }
      case "server": {
        let h = "#/servers/" + enc(route.id || "");
        if (route.tab && route.tab !== "overview") h += "/" + enc(route.tab);
        return h;
      }
      case "library":   return "#/library" + (route.filter ? "?filter=" + enc(route.filter) : "");
      case "library-create": return "#/library/new";
      case "game": {
        let h = "#/library/" + enc(route.id || "");
        if (route.tab && route.tab !== "overview") h += "/" + enc(route.tab);
        return h;
      }
      case "audit": {
        const p = [];
        if (route.severity) p.push("severity=" + enc(route.severity));
        if (route.serverId) p.push("serverId=" + enc(route.serverId));
        return "#/audit" + (p.length ? "?" + p.join("&") : "");
      }
      case "cluster": {
        // Without a member this is the cluster itself and its tab is the cluster's; with one it is
        // that member and the tab is the member's. Same route kind, two depths, one word between.
        let h = "#/cluster" + (route.hostId ? "/member/" + enc(route.hostId) : "");
        if (route.tab && route.tab !== "overview") h += "/" + enc(route.tab);
        return h;
      }
      // Leaf configuration is its own page, not a node sub-tab: it carries its own leaf tab strip,
      // and nesting that under the node page's tabs would stack two tab rows.
      case "leafConfig":
        return "#/config/" + enc(route.hostId || "") + (route.leaf ? "/" + enc(route.leaf) : "");
      // One leaf on one node, with its own sub-tabs (overview / whatever that leaf offers / logs /
      // settings). The shape is the same for every leaf, so a new leaf needs no new route — only a
      // body. It hangs off the node's Services tab, the one place it is opened from.
      case "leaf": {
        let h = "#/cluster/member/" + enc(route.hostId || "") + "/services/" + enc(route.leaf || "");
        if (route.tab && route.tab !== "overview") h += "/" + enc(route.tab);
        return h;
      }
      case "addHost":   return "#/hosts/add";
      // The screens in front of the app. They carry nothing but their own name: what a person is
      // being asked for is the whole state, and a half-typed address is not an address to restore.
      case "connect":   return "#/connect";
      case "signin":    return "#/signin";
      case "register":  return "#/register";
      case "pending":   return "#/pending";
      case "attention": return "#/alerts" + (route.serverId ? "?serverId=" + enc(route.serverId) : "");
      // `profile` is the default and stays OUT of the URL, the same way every other tabbed page
      // omits its own default — so the plain #/settings a bookmark or the sidebar produces is the
      // canonical address of the landing tab rather than a second spelling of it.
      case "settings":  return "#/settings" + (route.tab && route.tab !== "profile" ? "/" + enc(route.tab) : "");
      default:          return "#/";
    }
  }

  // "#/..."  ->  route object  (always returns a valid route; unknown → home)
  function parseHash(raw) {
    let h = (raw != null ? raw : (window.location.hash || ""));
    h = h.replace(/^#/, "");
    if (!h || h === "/") return { kind: "home" };
    const qIdx = h.indexOf("?");
    const pathPart = qIdx === -1 ? h : h.slice(0, qIdx);
    const queryPart = qIdx === -1 ? "" : h.slice(qIdx + 1);
    const segs = pathPart.split("/").filter(Boolean);
    const q = new URLSearchParams(queryPart);
    const head = (segs[0] || "").toLowerCase();
    switch (head) {
      case "":
      case "home":      return { kind: "home" };
      case "servers":
        if (segs[1]) {
          const r = { kind: "server", id: dec(segs[1]) };
          if (segs[2]) r.tab = dec(segs[2]);
          return r;
        }
        {
          const r = { kind: "servers" };
          if (q.get("status")) r.status = q.get("status");
          if (q.get("node")) r.node = q.get("node");
          return r;
        }
      case "library":
        // "new" is the create page, so it is not addressable as a game id. Blueprint names are
        // slugs, so a game genuinely called "new" would be shadowed here — accepted: the create
        // route is a fixed word, and the game is still reachable everywhere else it is listed.
        if (segs[1] === "new") return { kind: "library-create" };
        if (segs[1]) {
          const r = { kind: "game", id: dec(segs[1]) };
          if (segs[2]) r.tab = dec(segs[2]);
          return r;
        }
        return q.get("filter") ? { kind: "library", filter: q.get("filter") } : { kind: "library" };
      case "audit": {
        const r = { kind: "audit" };
        if (q.get("severity")) r.severity = q.get("severity");
        if (q.get("serverId")) r.serverId = q.get("serverId");
        return r;
      }
      case "cluster": {
        if (!segs[1]) return { kind: "cluster" };
        // A member, named under its own word: everything after it belongs to that member and
        // nothing about it can collide with the cluster's own vocabulary.
        if (segs[1].toLowerCase() === "member" && segs[2]) return clusterMember(segs.slice(2));
        // The cluster's own tabs.
        if (CLUSTER_ROOT_TABS.has(segs[1].toLowerCase()) && !segs[2]) {
          const t = segs[1].toLowerCase();
          return t === "overview" ? { kind: "cluster" } : { kind: "cluster", tab: t };
        }
        // The member route before it was named. Never emitted, so this is what a bookmark lands
        // on and nothing else — which is why a tab word wins above: a link made today says
        // `/member/`, and one that does not is older than the tabs.
        return clusterMember(segs.slice(1));
      }
      case "config": {
        // A host is required — without one there is nothing to configure, so fall back to the grid.
        if (!segs[1]) return { kind: "cluster" };
        const r = { kind: "leafConfig", hostId: dec(segs[1]) };
        if (segs[2]) r.leaf = dec(segs[2]);
        return r;
      }
      // The flat leaf word still resolves, so a link made before the page was nested under its node
      // still lands on it. Both a host and a leaf are required — a leaf page with neither has nothing
      // to show, so it falls back to the grid rather than mounting an empty shell.
      case "leaf": {
        if (!segs[1] || !segs[2]) return { kind: "cluster" };
        const r = { kind: "leaf", hostId: dec(segs[1]), leaf: dec(segs[2]) };
        if (segs[3]) r.tab = dec(segs[3]);
        return r;
      }
      case "alerts":    return q.get("serverId") ? { kind: "attention", serverId: q.get("serverId") } : { kind: "attention" };
      case "connect":   return { kind: "connect" };
      case "signin":    return { kind: "signin" };
      case "register":  return { kind: "register" };
      case "pending":   return { kind: "pending" };
      case "settings":  return segs[1] ? { kind: "settings", tab: dec(segs[1]) } : { kind: "settings" };
      // Alias words resolve to the cluster route so links and bookmarks keep working.
      case "diagnostics":
        return { kind: "cluster" };
      case "hosts":     return segs[1] === "add" ? { kind: "addHost" } : { kind: "cluster" };
      default:          return { kind: "home" };
    }
  }

  // A route parsed from the hash only when the hash actually carries one;
  // otherwise null so callers can fall back to legacy query params / defaults.
  function routeFromHash() {
    const h = (window.location.hash || "").replace(/^#\/?/, "");
    if (!h) return null;
    return parseHash();
  }

  // Cheap structural identity: two routes are "the same place" iff they encode
  // to the same hash. Lets the sync layer skip redundant writes / setStates.
  function sameRoute(a, b) {
    return routeToHash(a) === routeToHash(b);
  }

  // The screens in front of the app. Named here rather than tested by hand at each site, because
  // both directions of the redirect read this: signed out, everything else becomes one of these;
  // signed in, these become home. Two lists that had to agree would eventually not.
  const AUTH_KINDS = ["connect", "signin", "register", "pending"];
  const isAuthRoute = (route) => !!route && AUTH_KINDS.indexOf(route.kind) !== -1;

  const KrystalRouter = { routeToHash, parseHash, routeFromHash, sameRoute, isAuthRoute, AUTH_KINDS };

export { KrystalRouter };

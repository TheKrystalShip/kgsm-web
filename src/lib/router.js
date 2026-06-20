import React from "react";

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
//   #/servers                server list           (?status=offline entry filter)
//   #/servers/<id>           server detail (overview)
//   #/servers/<id>/<tab>     server detail, a specific tab
//   #/library                game library          (?filter=installed entry filter)
//   #/alerts                 alerts board
//   #/audit                  audit log             (?severity=danger entry filter)
//   #/fleet                  fleet grid
//   #/fleet/<hostId>         a host's diagnostics deep-dive
//   #/discord                Discord integration
//   #/settings               account settings
//   #/assistant              the assistant page
//
// Internal route.kind names differ from a couple of URL words on purpose
// (kind "attention" ↔ /alerts, kind "chat" ↔ /assistant) — the URL speaks the
// user's language, the code keeps its existing vocabulary.

  const enc = encodeURIComponent;
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  // route object  ->  "#/..."
  function routeToHash(route) {
    if (!route || !route.kind) return "#/";
    switch (route.kind) {
      case "home":      return "#/";
      case "servers":   return "#/servers" + (route.status ? "?status=" + enc(route.status) : "");
      case "server": {
        let h = "#/servers/" + enc(route.id || "");
        if (route.tab && route.tab !== "overview") h += "/" + enc(route.tab);
        return h;
      }
      case "library":   return "#/library" + (route.filter ? "?filter=" + enc(route.filter) : "");
      case "game":      return "#/library/" + enc(route.id || "");
      case "audit": {
        const p = [];
        if (route.severity) p.push("severity=" + enc(route.severity));
        if (route.serverId) p.push("serverId=" + enc(route.serverId));
        return "#/audit" + (p.length ? "?" + p.join("&") : "");
      }
      case "fleet":     return "#/fleet" + (route.hostId ? "/" + enc(route.hostId) : "");
      case "addHost":   return "#/hosts/add";
      case "attention": return "#/alerts" + (route.serverId ? "?serverId=" + enc(route.serverId) : "");
      case "discord":   return "#/discord";
      case "settings":  return "#/settings";
      case "chat":      return "#/assistant";
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
        return q.get("status") ? { kind: "servers", status: q.get("status") } : { kind: "servers" };
      case "library":
        if (segs[1]) return { kind: "game", id: dec(segs[1]) };
        return q.get("filter") ? { kind: "library", filter: q.get("filter") } : { kind: "library" };
      case "audit": {
        const r = { kind: "audit" };
        if (q.get("severity")) r.severity = q.get("severity");
        if (q.get("serverId")) r.serverId = q.get("serverId");
        return r;
      }
      case "fleet":     return segs[1] ? { kind: "fleet", hostId: dec(segs[1]) } : { kind: "fleet" };
      case "alerts":    return q.get("serverId") ? { kind: "attention", serverId: q.get("serverId") } : { kind: "attention" };
      case "discord":   return { kind: "discord" };
      case "settings":  return { kind: "settings" };
      case "assistant": return { kind: "chat" };
      // Legacy/aliases so old links still resolve.
      case "diagnostics":
        return { kind: "fleet" };
      case "hosts":     return segs[1] === "add" ? { kind: "addHost" } : { kind: "fleet" };
      case "chat":      return { kind: "chat" };
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

  const KrystalRouter = { routeToHash, parseHash, routeFromHash, sameRoute };

export { KrystalRouter };

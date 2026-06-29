import React from "react";
import { hostAddressOf } from "./config.js";
import { sessionStore } from "./sessionStore.js";
import { hostsStore } from "./stores.js";

// persona.js — the authorization POLICY layer (the single source of truth for
// "what may you reach" and "what may you do"), plus the Steam connect helper.
//
// This is deliberately distinct from the SESSION layer (sessionStore.js, §3·f),
// which answers "who are you" + "is your bearer valid". This module answers the
// next two questions and answers them STRUCTURALLY — see docs/architecture.html
// §3·f·1. The whole panel reads its rules from here; nothing re-derives a gate
// inline, and an unlisted (role, surface) pair is denied by default.
//
// PERSONA IS NOT STORED STATE. A user's role is emergent from the per-host
// Discord grants the session layer resolves (sessionStore.tierOf → admin |
// operator | viewer | none). Authorization is genuinely PER-HOST: you can be
// admin on one box, operator on a second, viewer on a third.
//
// The one override: a logged-in user may carry persona:"admin|operator|viewer"
// (the login "Preview as" lens). It forces ONE role across every host so an
// operator can verify how the panel looks to each tier, then sign back in to
// return to their real, per-host roles.
//
// ── The model ──────────────────────────────────────────────────────────────
//   CAP        named capabilities (nav surfaces + the two action gates)
//   ROLE_CAPS  role → its capability set (explicit, not additive-by-code)
//   ROUTE_CAP  route.kind → required capability (absent ⇒ public to any role)
//   can(cap)         AGGREGATE — held on ANY host (global nav + route guard)
//   canOn(cap,host)  SCOPED   — held on THAT host (per-host actions)
//   resolveRoute(r)  the routing chokepoint: forbidden route → persona's home
// "Aggregate for reach, scoped for action" — the two never substitute (§3·f·1).

  var AUTH_LS_KEY = "krystal:auth";
  var AUTH_SS_KEY = "krystal:auth:session";

  // ── Capabilities ──────────────────────────────────────────────────────────
  var CAP = {
    NAV_DASHBOARD: "nav.dashboard",   // Home / ops dashboard
    NAV_SERVERS:   "nav.servers",     // the game-server list + detail
    NAV_LIBRARY:   "nav.library",     // the install catalog
    NAV_ALERTS:    "nav.alerts",      // the alerts board
    NAV_AUDIT:     "nav.audit",       // the audit log
    NAV_FLEET:     "nav.fleet",       // the fleet grid + host deep-dive
    NAV_DISCORD:   "nav.discord",     // Discord integration config
    NAV_SETTINGS:  "nav.settings",    // account settings
    NAV_ASSISTANT: "nav.assistant",   // the assistant page / dock
    SERVER_OPERATE: "server.operate", // lifecycle, files, backups, settings, MOTD, moderation
    SERVER_CREATE:  "server.create",  // install/create a NEW game server (distinct from operating one)
    HOST_MANAGE:    "host.manage",    // add/forget hosts, fleet management
  };

  // ── Role → capability matrix (explicit; each set audits at a glance) ────────
  // Viewer  — READ-ONLY: servers + catalog + settings + assistant. No creating,
  //           no operating — it can browse the catalog but not deploy from it.
  // Operator— + dashboard, alerts, audit, Discord config, SERVER_CREATE and
  //           SERVER_OPERATE.
  // Admin   — + fleet and host management.
  var VIEWER = [CAP.NAV_SERVERS, CAP.NAV_LIBRARY, CAP.NAV_SETTINGS, CAP.NAV_ASSISTANT];
  var OPERATOR = VIEWER.concat([CAP.NAV_DASHBOARD, CAP.NAV_ALERTS, CAP.NAV_AUDIT, CAP.NAV_DISCORD, CAP.SERVER_CREATE, CAP.SERVER_OPERATE]);
  var ADMIN = OPERATOR.concat([CAP.NAV_FLEET, CAP.HOST_MANAGE]);
  var ROLE_CAPS = { none: [], viewer: VIEWER, operator: OPERATOR, admin: ADMIN };
  // Pre-resolved Sets for O(1) lookup.
  var ROLE_SET = {};
  Object.keys(ROLE_CAPS).forEach(function (r) { ROLE_SET[r] = new Set(ROLE_CAPS[r]); });

  // ── Route → required capability (absent ⇒ public to any signed-in role) ─────
  // Public: servers, server, library, game (every role can browse + open detail;
  // the OPERATE actions inside are gated separately, scoped to the host).
  var ROUTE_CAP = {
    home:      CAP.NAV_DASHBOARD,
    attention: CAP.NAV_ALERTS,
    audit:     CAP.NAV_AUDIT,
    fleet:     CAP.NAV_FLEET,
    discord:   CAP.NAV_DISCORD,
    settings:  CAP.NAV_SETTINGS,
    chat:      CAP.NAV_ASSISTANT,
    addHost:   CAP.HOST_MANAGE,
  };

  function storedUser() {
    try {
      var p = localStorage.getItem(AUTH_LS_KEY);
      if (p) return JSON.parse(p);
      var s = sessionStorage.getItem(AUTH_SS_KEY);
      if (s) return JSON.parse(s);
    } catch (e) {}
    return null;
  }
  function personaOverride() {
    var u = storedUser();
    var o = u && u.persona;
    return (o && ROLE_SET[o]) ? o : null; // "admin" | "operator" | "viewer" | null(auto)
  }
  function tierOf(hostId) {
    try { return sessionStore ? sessionStore.tierOf(hostId) : null; }
    catch (e) { return null; }
  }
  function getHosts() {
    return (hostsStore && hostsStore.getState().list) || [];
  }

  // ── roleOn — the effective role on one host (override-aware) ────────────────
  // A persona override (the "Preview as" lens) forces ONE role across every host
  // for testing; otherwise it's the real Discord tier resolved for that host.
  function roleOn(hostId) {
    var o = personaOverride();
    if (o) return o;
    return tierOf(hostId) || "none";
  }
  function capsOn(hostId) { return ROLE_SET[roleOn(hostId)] || ROLE_SET.none; }

  // ── The two evaluation modes (the per-host vs aggregate composition rule) ───
  // canOn — SCOPED: does the user hold `cap` on THIS host? Every per-host action.
  function canOn(cap, hostId) { return capsOn(hostId).has(cap); }
  // can — AGGREGATE (union): does the user hold `cap` on ANY host? Global nav +
  // the route guard. With an override active, it's just that one role's set.
  function can(cap) {
    var o = personaOverride();
    if (o) return ROLE_SET[o].has(cap);
    return getHosts().some(function (h) { return canOn(cap, h.id); });
  }

  // ── Route gating + resolution (the chokepoint) ──────────────────────────────
  // homeKind — where a persona lands by default: the ops dashboard if they can
  // reach it, else the servers list (a viewer's actual home).
  function homeKind() { return can(CAP.NAV_DASHBOARD) ? "home" : "servers"; }
  // canReach — may this persona occupy `route`? Global surfaces use the
  // aggregate; public routes (no ROUTE_CAP entry) are open to any signed-in role.
  function canReach(route) {
    if (!route || !route.kind) return true;
    var cap = ROUTE_CAP[route.kind];
    return cap ? can(cap) : true;
  }
  // resolveRoute — the single chokepoint. A forbidden destination is mapped to
  // the persona's home SYNCHRONOUSLY, so a route this role can't occupy never
  // enters state and its page never mounts. No post-render bounce, no flash.
  function resolveRoute(route) {
    return canReach(route) ? route : { kind: homeKind() };
  }

  // ── Back-compat aliases (now thin reads of the one policy) ──────────────────
  function canOperate(hostId) { return canOn(CAP.SERVER_OPERATE, hostId); }
  function serverOperable(server) { return server ? canOperate(server.hostId) : false; }
  function isAdmin(hostId) { return roleOn(hostId) === "admin"; }
  function isOperatorAnywhere() { return can(CAP.NAV_DASHBOARD); }
  function isAdminAnywhere() { return can(CAP.NAV_FLEET); }

  // ---- Steam connect ------------------------------------------------------
  // Identity comes from the backend, NOT a hardcoded table: each server carries
  // clientSteamAppId — the CLIENT/store app id a player owns and launches (e.g.
  // Factorio 427520). This is deliberately NOT the dedicated-server steamAppId
  // (a separate SteamCMD id with no store/launch meaning); steam://connect is a
  // player-side launch, so the client app id is the only correct one. "0" / absent
  // ⇒ not a Steam game. kgsm-api projects it from the engine blueprint, the single
  // source of truth — the frontend keeps zero game data.
  //
  // serverPort — the instance's player-facing connect port: the FIRST required
  // port (kgsm lists the game/connect port first in the blueprint). Sourced from
  // the detail superset's `network` block (GET /servers/{id}) — null on the bare
  // list row (network is detail-only) and never fabricated.
  function serverPort(server) {
    var req = server && server.network && server.network.required;
    if (!Array.isArray(req) || !req.length) return null;
    var p = req[0] && req[0].port;
    return (typeof p === "number" && p > 0) ? p : null;
  }

  // serverJoin — everything the Join UI needs. `address` is the player-facing
  // host:port, composed from the host's address (the origin the SPA reached this
  // server's host api at — kgsm/monitor source no ip, so the connect origin is the
  // honest host address) + the instance's connect port (from the detail network
  // block). Either part unknown → address is null (honest "—", never the string
  // "null"). steamUrl is null for non-Steam games (or until an address is known) →
  // the UI falls back to copy-connect only.
  function serverJoin(server) {
    // clientSteamAppId arrives as a string ("0" = not Steam) from the API; coerce.
    var appId = server ? (Number(server.clientSteamAppId) || 0) : 0;
    var isSteam = appId > 0;
    var host = server ? hostAddressOf(server.hostId) : "";
    var port = serverPort(server);
    var address = (host && port) ? (host + ":" + port) : null;
    return {
      isSteam: isSteam,
      steamId: appId,
      address: address,
      host: host || null,
      port: port,
      // steam://connect/<ip:port> — asks Steam to launch the owned client game and
      // join. Offered only for a Steam title (clientSteamAppId > 0) with an address.
      steamUrl: (isSteam && address) ? ("steam://connect/" + address) : null,
      online: !!(server && server.status === "online"),
    };
  }

  // ── Public surface ──────────────────────────────────────────────────────
  // The policy layer — the single source of truth every surface reads.
  const krystalPolicy = {
    CAP: CAP, ROLE_CAPS: ROLE_CAPS, ROUTE_CAP: ROUTE_CAP,
    roleOn: roleOn, can: can, canOn: canOn,
    canReach: canReach, resolveRoute: resolveRoute, homeKind: homeKind,
  };
  // Flat conveniences (used directly by components + the router chokepoint).

  // Back-compat aliases — kept so existing call sites don't churn; all now read
  // the one policy above rather than re-deriving a rule.
  const krystalPersona = personaOverride;

export { can, canOn, canOperate, canReach, homeKind, isAdmin, isAdminAnywhere, isOperatorAnywhere, krystalPersona, krystalPolicy, resolveRoute, roleOn, serverJoin, serverOperable };

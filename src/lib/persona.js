import { allows, isOwner as holdsEverything } from "./access.js";
import { ACTIONS, SERVER_OPERATE, VERB_ACTION } from "./actions.js";
import { hostAddressOf } from "./config.js";
import { KrystalRouter } from "./router.js";
import { accessStore } from "./stores/access.js";

// persona.js — the authorization POLICY layer: "what may you reach" and "what may you do", plus the
// Steam connect helper.
//
// Distinct from the SESSION layer (sessionStore.js), which answers "who are you" and "is your bearer
// valid". What somebody may do is an ACTION at a TARGET, and every member they reach has already
// evaluated it: the answers live in `stores/access.js` and are looked up by `access.js`. Nothing here
// decides access; it names which actions a surface performs and asks.
//
// ── The model ──────────────────────────────────────────────────────────────
//   may(action, target)     the question — is `action` allowed at `target`
//   mayAny(actions, target) any of them
//   can(cap, target)        a navigation or control capability, which names the actions behind it
//   resolveRoute(r)         the routing chokepoint: forbidden route → the home this person can reach
//
// A target is what the caller has in hand: nothing (anywhere — the question a nav entry asks),
// `{ hostId }` for a node, `{ server }` for a server row, `{ cluster: true }` for cluster-wide only.
// Asking with the narrowest target in hand is what lets a grant on one server open that server's
// controls and no other's.

  // ── Capabilities → the actions they are ─────────────────────────────────────
  // A capability is a surface's name for what it does; the actions are what a member grants. An entry
  // with no actions is open to anybody signed in.
  var CAP = {
    NAV_DASHBOARD: "nav.dashboard",
    NAV_SERVERS:   "nav.servers",
    NAV_LIBRARY:   "nav.library",
    NAV_ALERTS:    "nav.alerts",
    NAV_AUDIT:     "nav.audit",
    NAV_CLUSTER:   "nav.cluster",
    NAV_SETTINGS:  "nav.settings",
    SERVER_OPERATE: "server.operate",
    SERVER_CREATE:  "server.create",
    HOST_MANAGE:    "host.manage",
    HOST_SERVICES:  "host.services",
    HOST_CONNECT:   "host.connect",
  };

  var CAP_ACTIONS = {
    "nav.dashboard": [ACTIONS.SERVER_READ],
    "nav.servers": [ACTIONS.SERVER_READ],
    "nav.library": [ACTIONS.LIBRARY_READ],
    "nav.alerts": [ACTIONS.ALERTS_READ],
    "nav.audit": [ACTIONS.AUDIT_READ],
    "nav.cluster": [ACTIONS.MEMBERS_READ],
    "nav.settings": [],
    "server.operate": SERVER_OPERATE,
    "server.create": [ACTIONS.SERVER_INSTALL],
    "host.manage": [ACTIONS.MEMBERS_MANAGE],
    "host.services": [ACTIONS.SERVICES_READ],
    "host.connect": [ACTIONS.SERVICES_CONNECT],
  };

  // ── Route → required capability (absent ⇒ open to anybody signed in) ────────
  // Servers, a server, the library and a game are browsed by anyone holding their read; the controls
  // inside ask for their own actions against the server or node they are about.
  var ROUTE_CAP = {
    home:      CAP.NAV_DASHBOARD,
    attention: CAP.NAV_ALERTS,
    audit:     CAP.NAV_AUDIT,
    cluster:   CAP.NAV_CLUSTER,
    settings:  CAP.NAV_SETTINGS,
    addHost:   CAP.HOST_MANAGE,
    // A leaf's page and its configuration sit on the node's services board, which is what reaching
    // them takes; each tab inside asks for the leaf's own action.
    leafConfig: CAP.HOST_SERVICES,
    leaf: CAP.HOST_SERVICES,
  };

  const sources = () => accessStore.getState().sources;

  // ── The questions ──────────────────────────────────────────────────────────
  function may(action, target) { return allows(sources(), action, target); }
  function mayAny(actions, target) {
    var s = sources();
    return (actions || []).some(function (a) { return allows(s, a, target); });
  }
  function can(cap, target) {
    var actions = CAP_ACTIONS[cap];
    if (!actions) return false;          // an unlisted capability is closed
    if (!actions.length) return true;
    return mayAny(actions, target);
  }
  // Whether any member says this person holds every action, declared or not.
  function isOwner() { return holdsEverything(sources()); }

  // ── Route gating + resolution (the chokepoint) ──────────────────────────────
  function homeKind() { return can(CAP.NAV_DASHBOARD) ? "home" : "servers"; }
  function canReach(route) {
    if (!route || !route.kind) return true;
    var cap = ROUTE_CAP[route.kind];
    return cap ? can(cap) : true;
  }
  // A forbidden destination is mapped to the home this person can reach SYNCHRONOUSLY, so a route
  // they cannot occupy never enters state and its page never mounts.
  //
  // The screens in front of the app go the same way. Reaching one from inside means asking for a
  // door while standing in the building, and the answer is the room they are already in — which is
  // also what stops a stale `#/signin` in the address bar from mounting anything.
  function resolveRoute(route) {
    if (KrystalRouter.isAuthRoute(route)) return { kind: homeKind() };
    return canReach(route) ? route : { kind: homeKind() };
  }

  // Operating: any lifecycle verb, anywhere or on one server.
  function canOperate() { return mayAny(SERVER_OPERATE); }
  function serverOperable(server) { return server ? mayAny(SERVER_OPERATE, { server: server }) : false; }

  // The sentence a control closed for want of `action` at `target` carries, or null when it is held.
  // A refused control stays on screen, disabled, naming the action — never hidden from somebody who
  // can see what it would act on.
  function actionRefusal(action, target) {
    return may(action, target) ? null : "Needs " + action;
  }

  // One lifecycle verb on one server: whether its action is held there, and the sentence when not.
  function verbRefusal(server, verb) {
    var action = VERB_ACTION[verb];
    if (!server || !action) return null;
    return actionRefusal(action, { server: server });
  }

  // ── A server's tabs → the read each one is ──────────────────────────────────
  // Overview is open to anybody who can see the server; Access is for whoever may assign roles on it.
  var SERVER_TAB_ACTION = {
    performance: ACTIONS.SERVER_READ,
    files: ACTIONS.SERVER_FILES_READ,
    backups: ACTIONS.SERVER_BACKUPS_READ,
    settings: ACTIONS.SERVER_CONFIG_READ,
  };
  // ── A node's tabs → the actions behind each ─────────────────────────────────
  // Jobs lists the node's work on servers, each row filtered by the node to the servers this person
  // reads; Settings holds the node's name and its membership, any of which opens it.
  var NODE_TAB_ACTIONS = {
    overview: [ACTIONS.HOSTS_READ],
    resources: [ACTIONS.MONITOR_METRICS_READ],
    services: [ACTIONS.SERVICES_READ],
    jobs: [ACTIONS.SERVER_READ],
    logs: [ACTIONS.LOGS_READ],
    settings: [ACTIONS.HOSTS_WRITE, ACTIONS.MEMBERS_MANAGE, ACTIONS.MEMBERS_REMOVE],
  };
  function nodeTabOffered(hostId, tab) {
    var actions = NODE_TAB_ACTIONS[tab];
    return !!(hostId && actions && mayAny(actions, { hostId: hostId }));
  }

  function serverTabOffered(server, tab) {
    if (tab === "overview") return true;
    if (tab === "access") return serverAssignable(server);
    var action = SERVER_TAB_ACTION[tab];
    return !!(server && action && may(action, { server: server }));
  }
  // Assigning roles on one server: `auth:roles.assign` held there or wider, which only an install
  // whose nonce is known can be looked up for.
  function serverAssignable(server) {
    return !!(server && server.installNonce) && may(ACTIONS.ROLES_ASSIGN, { server: server });
  }

  // ---- Steam launch + connect address --------------------------------------
  // Identity comes from the backend, NOT a hardcoded table: each server carries
  // clientSteamAppId — the CLIENT/store app id a player owns and launches (e.g.
  // Factorio 427520). This is deliberately NOT the dedicated-server steamAppId
  // (a separate SteamCMD id with no store/launch meaning); the deep link is a
  // player-side launch, so the client app id is the only correct one. "0" / absent
  // ⇒ not a Steam game. kgsm-api projects it from the engine blueprint, the single
  // source of truth — the frontend keeps zero game data.
  //
  // serverPort — the instance's player-facing connect port: the FIRST required
  // port (kgsm lists the game/connect port first in the blueprint). `connectPort`
  // is the source: kgsm-api carries it on the list, the stream and the detail
  // alike (it's roster truth, no firewall probe), so a list card resolves an
  // address without a detail fetch. The detail-only `network` block is the
  // fallback, and both name the same port — the backend derives them with one
  // rule. Unknown → null, never fabricated.
  function serverPort(server) {
    var p = server && server.connectPort;
    if (typeof p === "number" && p > 0) return p;
    var req = server && server.network && server.network.required;
    if (!Array.isArray(req) || !req.length) return null;
    var q = req[0] && req[0].port;
    return (typeof q === "number" && q > 0) ? q : null;
  }

  // serverJoin — everything the Play/connect UI needs. `address` is the
  // player-facing host:port. The port is the instance's connect port; the host is, in
  // order: the name the cluster's DNS anchor published for this server
  // (`publishedHost`, e.g. factorio.play.<zone> — present only once it resolves), the
  // node's OWN declared connect host (`connectHost`), and otherwise the origin the SPA
  // reached that host's api at. That last fallback is a coincidence worth naming: the
  // api origin is where the CONTROL PLANE is reached, which matches where the game is
  // only while both sit on one address — so a node reached differently than it is
  // played on declares `connectHost`, and the two stop being conflated. Either part
  // unknown → address is null (honest "—", never the string "null").
  //
  // launchUrl LAUNCHES THE GAME; it does not join the server. `steam://run/<appid>`
  // asks Steam to start a title the player owns, which every Steam game supports —
  // whereas handing Steam an address to auto-connect only works for the subset of
  // games whose developers wired that up, so it silently did nothing for the rest.
  // The player joins from the game's own server browser using `address`, which is
  // why the copy affordance sits beside the button on every surface rather than
  // being a fallback for non-Steam titles. It depends only on the app id, so it is
  // resolvable wherever a server row is (no address, no detail fetch needed).
  function serverJoin(server) {
    // clientSteamAppId arrives as a string ("0" = not Steam) from the API; coerce.
    var appId = server ? (Number(server.clientSteamAppId) || 0) : 0;
    var isSteam = appId > 0;
    var host = server ? (server.publishedHost || server.connectHost || hostAddressOf(server.hostId)) : "";
    var port = serverPort(server);
    var address = (host && port) ? (host + ":" + port) : null;
    return {
      isSteam: isSteam,
      steamId: appId,
      address: address,
      host: host || null,
      port: port,
      launchUrl: isSteam ? ("steam://run/" + appId) : null,
      online: !!(server && server.status === "online"),
    };
  }

  const krystalPolicy = { CAP: CAP, CAP_ACTIONS: CAP_ACTIONS, ROUTE_CAP: ROUTE_CAP };

export { ACTIONS, actionRefusal, can, canOperate, canReach, homeKind, isOwner, krystalPolicy, may, mayAny, resolveRoute, nodeTabOffered, serverAssignable, serverJoin, serverOperable, serverTabOffered, verbRefusal };

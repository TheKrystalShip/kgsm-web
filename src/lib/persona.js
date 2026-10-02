import { allows, anchorSource, isOwner as holdsEverything, nodeSource, reportAllows, targetOf } from "./access.js";
import { hostAddressOf } from "./config.js";
import { requirementOf } from "./operations.js";
import { KrystalRouter } from "./router.js";
import { accessStore } from "./stores/access.js";

// persona.js — the authorization POLICY layer: "what may you reach" and "what may you do", plus the
// Steam connect helper.
//
// Distinct from the SESSION layer (sessionStore.js), which answers "who are you" and "is your bearer
// valid". **This panel names no action.** A control is gated on the request it would make — the
// method, the path and the body it is about to send — and the member that would answer it says which
// action that is (its operations, `operations.js`) and whether this person holds it (its `/me/access`).
// Both live per member in `stores/access.js`. Nothing here decides access, and nothing here can drift
// from what a member enforces: the only string shared with a member is the route the panel already
// calls, and a request a member does not publish is closed.
//
// ── The model ──────────────────────────────────────────────────────────────
//   mayCall(member, method, path, opts)      may this request be made
//   callRefusal(member, method, path, opts)  the sentence a control closed for it carries, or null
//   can(cap, target)                         a navigation or control capability, named by its request
//   resolveRoute(r)                          the routing chokepoint: forbidden route → a reachable home
//
// A member is `{ hostId }` for a node, or an anchor's namespace — `"auth"`, `"dns"`. `opts` carries the
// `body` the request would send, the `server` row a server route is about (its install is the target),
// a `target` for a request whose scope the request names (an assignment's), or `anywhere: true` for a
// question about anything at all on that member — what a nav entry asks. A path segment the question
// does not care about may be `_`.

  // The answer of one member, keyed as `stores/access.js` keeps it.
  const sources = () => accessStore.getState().sources;
  const sourceKeyOf = (member) => (typeof member === "string" ? anchorSource(member) : nodeSource(member && member.hostId));

  // Where one entry of a request is checked: the scope the member published, made concrete.
  function entryTarget(entry, member, params, opts) {
    if (opts && opts.anywhere) return null;
    switch (entry.scope) {
      case "cluster": return { cluster: true };
      case "node": return { hostId: member.hostId };
      case "instance":
        return opts && opts.server
          ? { server: opts.server }
          : { server: { hostId: member.hostId, id: params[entry.target], installNonce: null } };
      case "request": return (opts && opts.target) || { cluster: true };
      default: return { cluster: true };
    }
  }

  // Every request a gate asked about that the member it was asked of does not publish. A gate is only
  // ever asked about a request this panel sends, so one appearing here is a route the panel and that
  // member disagree about — the smoke fails on any.
  var unpublished = new Set();
  function unpublishedRequests() { return [...unpublished]; }

  // The verdict on one request: `{ allowed, refusal }`. Every entry it matches must be held. A member
  // that has not answered, or does not publish the request, closes it.
  function gate(member, method, path, opts) {
    var key = sourceKeyOf(member);
    var src = sources()[key];
    if (!src || src.state !== "ok" || !src.report) return { allowed: false, refusal: null };
    var req = requirementOf(src.operations, method, path, opts && opts.body);
    if (!req.published && src.operations) unpublished.add(key + " " + method + " " + path);
    if (!req.published) return { allowed: false, refusal: src.operations ? "Not offered here" : null };
    for (var i = 0; i < req.entries.length; i++) {
      var e = req.entries[i];
      if (!reportAllows(src.report, e.action, targetOf(entryTarget(e, member, req.params, opts)))) {
        return { allowed: false, refusal: "Needs " + e.action };
      }
    }
    return { allowed: true, refusal: null };
  }

  function mayCall(member, method, path, opts) { return gate(member, method, path, opts).allowed; }
  function callRefusal(member, method, path, opts) {
    var v = gate(member, method, path, opts);
    return v.allowed ? null : (v.refusal || "Not available");
  }

  // The nodes this browser holds an answer from.
  function nodeIds() {
    return Object.keys(sources()).filter(function (k) { return k.startsWith("node:"); })
      .map(function (k) { return k.slice(5); });
  }
  // A request asked of every node, for a question about anywhere: any node allowing it is a yes.
  function mayCallOnAnyNode(method, path, opts) {
    return nodeIds().some(function (hostId) {
      return mayCall({ hostId: hostId }, method, path, Object.assign({ anywhere: true }, opts));
    });
  }

  // ── Capabilities → the request each one is ──────────────────────────────────
  // A capability is a surface's name for what it does; what it takes is the request it makes. `null`
  // is open to anybody signed in. `_` stands for a segment the question is about any value of.
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

  var CAP_REQUESTS = {
    // Reading any server is what the server list and the dashboard show; a list itself is filtered by
    // its member, so the question is asked of one server's read.
    "nav.dashboard": ["GET", "/servers/_"],
    "nav.servers": ["GET", "/servers/_"],
    "nav.library": ["GET", "/library"],
    "nav.alerts": ["GET", "/alerts"],
    "nav.audit": ["GET", "/audit"],
    "nav.cluster": ["GET", "/members/roster"],
    "nav.settings": null,
    "server.create": ["POST", "/servers"],
    "host.manage": ["POST", "/members"],
    "host.services": ["GET", "/hosts/_/services"],
    "host.connect": ["POST", "/hosts/_/services/_/connect"],
  };

  // The lifecycle verbs a server is operated with — the values its command request carries.
  var OPERATE_VERBS = ["start", "stop", "restart"];
  const commandPath = (server) => "/servers/" + encodeURIComponent(server ? server.id : "_") + "/commands";

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

  // ── The questions ──────────────────────────────────────────────────────────
  // An action a member handed this panel as data — a manifest's own command, say — looked up as it is.
  // Never for an action this panel would otherwise have to name.
  function may(action, target) { return allows(sources(), action, target); }

  // A capability at a target: `{ server }`, `{ hostId }`, or nothing for anywhere.
  function can(cap, target) {
    if (cap === CAP.SERVER_OPERATE) {
      return OPERATE_VERBS.some(function (verb) { return canVerb(target, verb); });
    }
    if (!(cap in CAP_REQUESTS)) return false;   // an unlisted capability is closed
    var req = CAP_REQUESTS[cap];
    if (!req) return true;
    var method = req[0];
    if (target && target.server) {
      var s = target.server;
      return mayCall({ hostId: s.hostId }, method, req[1].replace("/servers/_", "/servers/" + encodeURIComponent(s.id)), { server: s });
    }
    if (target && target.hostId) {
      return mayCall({ hostId: target.hostId }, method, req[1].replace("/hosts/_", "/hosts/" + encodeURIComponent(target.hostId)),
        { anywhere: req[1].indexOf("/servers/_") !== -1 });
    }
    return mayCallOnAnyNode(method, req[1]);
  }

  // One lifecycle verb at a target, as its command request.
  function canVerb(target, verb) {
    if (target && target.server) return verbRefusal(target.server, verb) === null;
    if (target && target.hostId) return mayCall({ hostId: target.hostId }, "POST", commandPath(null), { body: { verb: verb }, anywhere: true });
    return mayCallOnAnyNode("POST", commandPath(null), { body: { verb: verb } });
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
  function canOperate() { return can(CAP.SERVER_OPERATE); }
  function serverOperable(server) { return server ? can(CAP.SERVER_OPERATE, { server: server }) : false; }

  // A request on one server — the method and the path under it — and the sentence when it is closed.
  // A refused control stays on screen, disabled, naming the action — never hidden from somebody who
  // can see what it would act on.
  function serverCallRefusal(server, method, subpath, body) {
    if (!server) return "Not available";
    return callRefusal({ hostId: server.hostId }, method,
      "/servers/" + encodeURIComponent(server.id) + (subpath || ""), { server: server, body: body });
  }

  // One lifecycle verb on one server: whether its command may be sent, and the sentence when not.
  function verbRefusal(server, verb) {
    if (!server) return null;
    return serverCallRefusal(server, "POST", "/commands", { verb: verb });
  }

  // ── A server's tabs → the read each one is ──────────────────────────────────
  // Overview is open to anybody who can see the server; Access is for whoever may assign roles on it.
  var SERVER_TAB_READS = {
    performance: "/metrics/history",
    files: "/files",
    backups: "/backups",
    settings: "/settings",
  };
  function serverTabOffered(server, tab) {
    if (tab === "overview") return true;
    if (tab === "access") return serverAssignable(server);
    var sub = SERVER_TAB_READS[tab];
    return !!(server && sub) && serverCallRefusal(server, "GET", sub) === null;
  }

  // ── A node's tabs → the requests behind each ────────────────────────────────
  // Jobs lists the node's work on servers, each row filtered by the node to the servers this person
  // reads; Settings holds the node's name and its membership, any of which opens it.
  var NODE_TAB_REQUESTS = {
    overview: [["GET", "/hosts/{host}"]],
    resources: [["GET", "/hosts/{host}/metrics/history"]],
    services: [["GET", "/hosts/{host}/services"]],
    jobs: [["GET", "/servers/_", { anywhere: true }]],
    logs: [["GET", "/hosts/{host}/logs"]],
    settings: [["PATCH", "/hosts/{host}"], ["PATCH", "/members/{host}"], ["DELETE", "/members/{host}"]],
  };
  function nodeTabOffered(hostId, tab) {
    var reqs = NODE_TAB_REQUESTS[tab];
    if (!hostId || !reqs) return false;
    return reqs.some(function (r) {
      return mayCall({ hostId: hostId }, r[0], r[1].replace("{host}", encodeURIComponent(hostId)), r[2]);
    });
  }

  // Assigning roles on one server: the anchor's `assign` edit at that server's install, which only an
  // install whose nonce is known can be asked about.
  function serverAssignable(server) {
    return !!(server && server.installNonce)
      && mayCall("auth", "POST", "/auth/cluster/authority/edits", { body: { kind: "assign" }, target: { server: server } });
  }

  // Whether this person may make any request a member publishes — for a surface that is only worth
  // opening to somebody who can do something there, like the access pages.
  function mayAnythingAt(member) {
    var src = sources()[sourceKeyOf(member)];
    if (!src || src.state !== "ok" || !src.report || !src.operations) return false;
    if (src.report.owner) return true;
    return (src.operations.operations || []).some(function (op) {
      return op.method !== "GET" && reportAllows(src.report, op.action, targetOf(null));
    });
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

  const krystalPolicy = { CAP: CAP, CAP_REQUESTS: CAP_REQUESTS, ROUTE_CAP: ROUTE_CAP };

export {
  callRefusal, can, canOperate, canReach, homeKind, isOwner, krystalPolicy, may, mayAnythingAt, mayCall,
  mayCallOnAnyNode, nodeTabOffered, resolveRoute, serverAssignable, serverCallRefusal, serverJoin,
  serverOperable, serverTabOffered, unpublishedRequests, verbRefusal,
};

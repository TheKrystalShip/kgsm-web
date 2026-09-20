// componentSurface.js — one component's own configuration, unit, journal and commands, behind one
// shape whichever transport reaches it.
//
// A component owns all of that wherever it runs. What differs is only how a browser gets to it: an
// anchor is a peer of every node rather than something one of them hosts, so it answers over HTTP at
// its own member address; a leaf is reached through the node that runs it, whose API relays to the
// socket the leaf already serves. The panel renders one set of bodies either way, and this is the
// whole of what separates them.
//
// So a page takes a surface rather than a host id and a leaf id. It cannot tell which kind it has,
// which is what stops the two from drifting into two implementations of one page.

import { authorized } from "./authorizedFetch.js";
import { clusterCredential } from "./sessionStore.js";
import { applyLeafConfig, fetchLeafCommands, fetchLeafConfig } from "./stores.js";

// Where a capability's holder serves its own surface. Each anchor mounts the component routes under
// the group it already gates — the auth anchor beneath the prefix its doors live on, the assistant
// beneath the admin group its conversation review is behind — so the prefix is the one thing that is
// the capability's rather than the component contract's.
//
// A capability absent here has no browser-reachable surface, and `anchorSurface` answers null rather
// than guessing a prefix: a wrong one is a 404 on every tab, which reads as a component that answers
// nothing instead of one the panel has not been taught to reach.
const ANCHOR_BASE = {
  auth: "/auth",
  assistant: "/admin",
};

/** Whether this capability's holder serves a component surface a browser can read. */
function capabilityServesSurface(capability) {
  return !!ANCHOR_BASE[capability];
}

// Normalize to an http(s) origin with no trailing slash, so a base path always concatenates cleanly.
function originOf(input) {
  const s = (input || "").trim();
  if (!s) return "";
  const trimmed = s.replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

// One shape for every refusal here: the code a caller keys on, the status it renders, and the
// component's OWN words where it gave any. Nothing in this module keeps a second copy of the rules
// the component applied to stand beside what it said.
function refusal(code, res) {
  const err = new Error(code);
  err.status = res.status;
  err.userMessage = (res.body && res.body.error && res.body.error.message) || null;
  return err;
}

/**
 * The surface an ANCHOR serves about itself, at its own address.
 *
 * The credential is the cluster's. An anchor holding something other than `auth` has its own
 * sign-in shut — another member holds the accounts — so it verifies the cluster session this
 * browser is already carrying, and that is the one credential every one of these calls presents.
 *
 * Null when there is no address to call or no prefix known for the capability, which a page renders
 * as a surface it cannot reach rather than as a component with nothing to say.
 */
function anchorSurface({ address, capability, label }) {
  const origin = originOf(address);
  const base = ANCHOR_BASE[capability];
  if (!origin || !base) return null;

  const at = (path) => origin + base + path;

  return {
    kind: "anchor",
    key: "anchor:" + origin + base,
    label: label || capability || "This anchor",

    async readConfig({ fetchImpl = fetch, signal } = {}) {
      const res = await authorized(clusterCredential, { fetchImpl })
        .json(at("/config"), { headers: { Accept: "application/json" }, signal });
      if (!res.ok) throw refusal("config_unavailable", res);
      return res.body;
    },

    // Applying restarts the component. It answers before it goes — systemd stops the unit with
    // SIGTERM and the host drains what is already in flight — so the outcome is part of the answer
    // rather than something to infer from a connection that closed.
    async applyConfig(body, { fetchImpl = fetch, signal } = {}) {
      const res = await authorized(clusterCredential, { fetchImpl }).json(at("/config"), {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw refusal("apply_failed", res);
      return res.body;
    },

    // What systemd reports about the component's unit — the same row a node's API reads for each of
    // its leaves, read here by the component itself because no node above it will.
    async readSystem({ fetchImpl = fetch, signal } = {}) {
      const res = await authorized(clusterCredential, { fetchImpl })
        .json(at("/system"), { headers: { Accept: "application/json" }, signal });
      if (!res.ok) throw refusal("system_unavailable", res);
      return res.body;
    },

    // The commands it declares, from the manifest its own deploy installed.
    async readCommands({ fetchImpl = fetch, signal } = {}) {
      const res = await authorized(clusterCredential, { fetchImpl })
        .json(at("/commands"), { headers: { Accept: "application/json" }, signal });
      if (!res.ok) throw refusal("commands_unavailable", res);
      return res.body;
    },

    async readLogs({ lines = 300, fetchImpl = fetch, signal } = {}) {
      const res = await authorized(clusterCredential, { fetchImpl })
        .json(at("/logs?lines=" + encodeURIComponent(lines)),
          { headers: { Accept: "application/json" }, signal });
      if (!res.ok) throw refusal("logs_unavailable", res);
      return (res.body && res.body.data) || [];
    },

    // The live tail. Returns a stop function; calling it ends the follow, and the component stops
    // its own journalctl once the last watcher has left.
    //
    // Follow-only — the read above is the scrollback, and this carries lines from the next one on.
    followLogs(onLine, { fetchImpl = fetch } = {}) {
      const follow = authorized(clusterCredential, { fetchImpl }).stream(at("/logs/stream"), {
        onEvent: (line) => { if (line) onLine(line); },
      });
      return {
        stopped: follow.stopped.then((res) => { if (!res.ok) throw refusal("stream_unavailable", res); }),
        stop: follow.stop,
      };
    },
  };
}

/**
 * The surface a LEAF serves, reached through the node that runs it.
 *
 * The node's API is the door rather than the authority: it relays to the component, and this browser
 * holds a session with the node for the same reason it holds one for every other node surface.
 *
 * The journal is deliberately absent. A leaf's is read through the keyed log store, which shares one
 * hydrate and one subscription per (host, leaf) so two views of it — a page and a pinned widget —
 * cost one stream rather than two; a second reader here would fetch it again beside that one.
 */
function leafSurface({ hostId, leafId, label }) {
  if (!hostId || !leafId) return null;

  return {
    kind: "leaf",
    key: "leaf:" + hostId + "/" + leafId,
    label: label || leafId,
    hostId,
    leafId,

    readConfig: () => fetchLeafConfig(hostId, leafId),
    applyConfig: (body) => applyLeafConfig(hostId, leafId, body),
    readCommands: () => fetchLeafCommands(hostId, leafId),
  };
}

export { anchorSurface, capabilityServesSurface, leafSurface, originOf };

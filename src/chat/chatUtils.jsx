// The panel's half of the chat: what a kgsm assistant's tool results look like as evidence cards, what
// a confirmed action's verdict says, and how a blueprint finalize comes back. The conversation itself
// — the turn reducer, the history rebuild, the list merge — is the design system's (`Chat`), and the
// versions exported here are those functions bound to this profile, so a caller holding a frame gets
// the panel's cards without naming the profile.

import {
  promotePendingCards, toolLabel,
  reduceTurnFrame as reduceWith, scaffoldHistory as scaffoldWith,
  latestUsage, mergeServerConversations, adoptServerConversation,
} from "@thekrystalship/krystal-ui";
import { commandMeta, LEAF_COMMAND_VERBS } from "./chatConstants.js";
import { auditTone, eventIcon, fmtRelative, humanizeAction } from "../lib/formatting.js";

// What the transcript says when a conversation's switch moves.
const TOGGLE_COPY = {
  thinking: {
    on:  "Thinking on — replies may take a little longer but tend to be more thorough and accurate.",
    off: "Thinking off — the assistant answers directly, for quicker replies.",
  },
  actions: {
    on:  "Auto-run on — the assistant will carry out start/stop/restart actions immediately, without asking you to confirm each one.",
    off: "Auto-run off — the assistant will propose actions and wait for you to confirm before anything runs.",
  },
};

// ---------- command verified (rendered from the leaf's confirm verdict) ----------
// The leaf watches a lifecycle command until it reaches its run-state postcondition and answers a
// VERDICT (wire-contract \u00a73): settled/accepted are the two successes, and notSettled/unknown/failed/
// refused each say something different about what went wrong. We render the verdict rather than
// parsing `text` for it \u2014 `text` is the one field the leaf is free to reword, and two surfaces
// reading it differently is exactly how they come to disagree about whether a server started.
const VERB_PAST = {
  start: "Started", stop: "Stopped", restart: "Restarted", install: "Installed",
  uninstall: "Uninstalled", update: "Updated", backup: "Backed up",
};
const STATE_WORD = { running: "running", stopped: "stopped", unknown: "unreadable" };

function composeVerified(verb, serverName, resp) {
  const r = resp || {};
  const o = r.outcome || null;
  const what = verb.replace(/_/g, " ") + " ";
  const lines = o && o.reason ? [{ status: "fail", label: "Reason", detail: String(o.reason) }] : [];

  // No outcome object at all: an older leaf, or a kind that reports none. Fall back to `success`,
  // and to the leaf's own sentence \u2014 never upgrade silence into an observation.
  if (!o) {
    return r.success
      ? { ok: true, headline: r.text || ((VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + "."), lines: [] }
      : { ok: false, headline: r.text || ("Couldn\u2019t " + what + serverName + "."), lines: [] };
  }

  switch (o.verdict) {
    case "settled": {
      const headline = (VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + ".";
      return { ok: true, headline, lines: [] };
    }
    // Ran, and the engine reported success, but the verb has no run-state to watch (an update, a
    // backup, a config write). Say what was done, and claim nothing about the server's state.
    case "accepted":
      return { ok: true, headline: (VERB_PAST[verb] || ("Ran " + verb + " on")) + " " + serverName + ".", lines: [] };
    // Ran; the end state was not reached inside the window. `observedState` is what was actually
    // seen \u2014 the honest middle, and the one case a client is most tempted to round to a failure.
    case "notSettled":
      return {
        ok: false,
        headline: "Ran " + what.trim() + " on " + serverName + ", but it hasn\u2019t "
          + (verb === "stop" ? "stopped" : "come up") + " yet \u2014 it may still be working.",
        lines: o.observedState
          ? [{ status: "warn", label: "Last seen", detail: STATE_WORD[o.observedState] || o.observedState }, ...lines]
          : lines,
      };
    // Ran; the run state could not be read. Never rendered as "stopped".
    case "unknown":
      return { ok: false, headline: "Ran " + what.trim() + " on " + serverName + ", but its state couldn\u2019t be read.", lines };
    case "refused":
      return { ok: false, headline: r.text || ("Didn\u2019t " + what + serverName + "."), lines };
    default:  // failed, or a verdict this build doesn't know
      return { ok: false, headline: "Couldn\u2019t " + what + serverName + ".", lines };
  }
}

// ---------- tool.result → evidence card projection ----------
const HEALTH_CHECK_LABELS = {
  liveness: "Server",
  logs:     "Console",
  updates:  "Updates",
  disk:     "Disk space",
};
const HEALTH_CHECK_ICONS = {
  liveness: "server",
  logs:     "terminal-square",
  updates:  "download",
  disk:     "hard-drive",
};
// CheckState → chain tone, on the same scale the audit rows beside it read in (danger/warn/info/
// success). "skip" (source unavailable / not applicable) reads as neutral info — never a
// fabricated pass or fail.
const CHECK_STATE_TONE = { pass: "success", warn: "warn", fail: "danger", skip: "info" };

// A raw engine type carries no namespace of its own, so it is placed in `engine.` — a rule about
// the SHAPE of a name, applied to every type alike. A type that already reads as a dotted name is
// one, and stands as it is. Everything downstream then keys on the dimensions the row carries: the
// name's own hierarchy picks the glyph, and the producer's severity picks the tone.
const engineAction = (type) => {
  const name = String(type || "event");
  return name.includes(".") ? name : "engine." + name;
};

// One raw event/change row → the flat display shape EvidenceChangeTimeline and EvidenceRootCause
// render. `by` is honestly "unknown actor" for a null actor (a bare CLI call) — never defaulted to
// a fabricated "system". `detail` names the owning instance only in a fleet-wide read (redundant
// once the card is already scoped to one server).
function auditEventRow(e, fleetWide) {
  const ts = e && e.ts ? new Date(e.ts) : null;
  return {
    icon: eventIcon(engineAction(e && e.type)),
    tone: auditTone(e),
    label: humanizeAction((e && e.type) || "event"),
    by: (e && e.actor) || "unknown actor",
    detail: fleetWide ? ((e && e.instance) || "host-level") : "",
    rel: ts && !isNaN(ts.getTime()) ? fmtRelative(ts) : "",
  };
}

// Mirror of kgsm-api ParseActor so the same event resolves the same actor on both surfaces:
// `provider:name` → discord=user, api=token, system=system, an unrecognized provider keeps the name
// as a user; a bare "system" (or a null actor — kgsm's defensive default) is the autonomous engine;
// any other bare string is the local OS user. Never fabricated beyond that defensive default.
//
// `provider` rides along, because it is the axis that separates a real Discord identity from every
// other name: AuditActor reads it to decide whether an actor called `monitor` is the metrics leaf or
// a person. An unrecognized provider keeps the name but leaves it null, exactly as the api does —
// never coerced to one of the three.
function parseAuditActor(flat) {
  const s = (flat || "").trim();
  if (!s) return { name: "system", kind: "system", provider: "system" };
  const colon = s.indexOf(":");
  if (colon > 0 && colon < s.length - 1) {
    const provider = s.slice(0, colon).toLowerCase();
    const name = s.slice(colon + 1);
    if (provider === "discord") return { name, kind: "user", provider: "discord" };
    if (provider === "api")     return { name, kind: "token", provider: "api" };
    if (provider === "system")  return { name, kind: "system", provider: "system" };
    return { name, kind: "user", provider: null };
  }
  return s.toLowerCase() === "system"
    ? { name: "system", kind: "system", provider: "system" }
    : { name: s, kind: "user", provider: "system" };
}

// One raw engine event (the monitor's GET /events row, relayed verbatim by the assistant as
// { id, ts, type, instance, actor, origin }) → the standard `ev` audit record the shared
// AuditEventRow renders, so the chat card and the audit page cannot disagree about what an event
// says. `id` is the deterministic AuditId the monitor stores (== the id /audit returns), so it's a
// stable React key. The summary is the producer's own sentence when the row carries one; without
// it the row states the event's name and the instance it happened to, and invents nothing further.
function auditEventToRecord(e) {
  const instance = (e && e.instance) || null;
  const action = engineAction(e && e.type);
  const words = String((e && e.type) || "event").split(/[._]/).filter(Boolean).join(" ");
  return {
    id: (e && e.id) || (action + ":" + (e && e.ts)),
    ts: e && e.ts ? String(e.ts) : "",
    action,
    actor: parseAuditActor(e && e.actor),
    summary: (e && e.summary) || (instance ? words + " \u00b7 " + instance : words),
    severity: (e && e.severity) || null,
    outcome: (e && e.outcome) || null,
    origin: (e && e.origin) || null,
    serverId: instance,
    meta: {},
  };
}
function adaptResultCard(card) {
  if (!card || !card.tool) return null;
  const id = (card.subject && card.subject.id) || null;
  switch (card.tool) {
    case "run_health_check": {
      const d = card.data;
      if (!d || !Array.isArray(d.checks)) return null;
      let fails = 0, warns = 0;
      const checks = d.checks.map(ck => {
        if (ck.state === "fail") fails++;
        else if (ck.state === "warn") warns++;
        return {
          label: HEALTH_CHECK_LABELS[ck.name] || (ck.name || "check"),
          status: ck.state || "skip",
          detail: ck.detail || "",
        };
      });
      return {
        kind: "health",
        serverId: id,
        serverName: id || "this server",
        confidence: card.confidence || null,
        checks,
        passes: typeof d.passed === "number" ? d.passed : checks.filter(c => c.status === "pass").length,
        fails,
        warns,
      };
    }
    case "get_status": {
      const d = card.data;
      if (!d || !Array.isArray(d.servers)) return null;
      const TONE = { running: "success", stopped: "idle", unknown: "warn" };
      const servers = d.servers.map(s => {
        const state = String(s.state || "unknown").toLowerCase();
        const known = Object.prototype.hasOwnProperty.call(TONE, state);
        return {
          instance: s.instance || "\u2014",
          state: known ? state : "unknown",
          tone: known ? TONE[state] : "warn",
          reason: s.reason || null,
        };
      });
      const parts = [];
      if (typeof d.running === "number") parts.push(d.running + " running");
      if (typeof d.stopped === "number") parts.push(d.stopped + " stopped");
      if (d.unavailable) parts.push(d.unavailable + " unavailable");
      return {
        kind: "fleet",
        confidence: card.confidence || null,
        summary: parts.join(" \u00b7 ") || (servers.length + " server" + (servers.length === 1 ? "" : "s")),
        servers,
      };
    }
    case "get_performance": {
      // Two shapes from the same tool: a live SNAPSHOT (current values, no time-series)
      // or a windowed TREND (a per-metric series → a chart). The presence of a non-empty
      // `series` is what distinguishes them. Either way an unmeasured field is null and
      // stays null (never coerced to 0).
      const d = card.data;
      if (!d) return null;
      const num = (v) => (typeof v === "number" ? v : null);

      // Trend: the card carries a per-metric time series over `range` → render a chart.
      const series = d.series && typeof d.series === "object" ? d.series : null;
      const hasSeries = series && Object.values(series).some(
        (pts) => Array.isArray(pts) && pts.length > 0);
      if (hasSeries) {
        return {
          kind: "performance",
          mode: "trend",
          serverId: id,
          serverName: id || "this server",
          confidence: card.confidence || null,
          range: typeof d.range === "string" ? d.range : null,
          series,
        };
      }

      return {
        kind: "performance",
        mode: "snapshot",
        serverId: id,
        serverName: id || "this server",
        confidence: card.confidence || null,
        cpuPctCore: num(d.cpuPctCore),
        memBytes:   num(d.memBytes),
        rxBps:      num(d.rxBps),
        txBps:      num(d.txBps),
        ioReadBps:  num(d.ioReadBps),
        ioWriteBps: num(d.ioWriteBps),
        diskBytes:  num(d.diskBytes),
        pids:       num(d.pids),
      };
    }
    case "get_audit_log": {
      const d = card.data;
      if (!d) return null;
      // Normalize each raw engine event into the standard `ev` audit shape so the card renders the
      // shared AuditEventRow — the same row the Audit page and dashboard use (host chip resolves
      // itself off serverId, so no fleet-wide flag is threaded here).
      return {
        kind: "audit",
        serverId: d.instance || null,
        serverName: d.instance || "all servers",
        confidence: card.confidence || null,
        windowLabel: typeof d.window === "string" ? "last " + d.window : "",
        available: d.state === "available",
        events: Array.isArray(d.events) ? d.events.map(auditEventToRecord) : [],
      };
    }
    case "get_change_timeline": {
      const d = card.data;
      if (!d) return null;
      const fleetWide = !d.instance;
      return {
        kind: "timeline",
        serverId: d.instance || null,
        serverName: d.instance || "all servers",
        confidence: card.confidence || null,
        windowLabel: typeof d.window === "string" ? "last " + d.window : "",
        available: d.state === "available",
        changes: Array.isArray(d.events) ? d.events.map((e) => auditEventRow(e, fleetWide)) : [],
      };
    }
    case "trace_root_cause": {
      // The root-cause capstone aggregator: a RANKED list of findings, each
      // a deterministic pattern match (or, when nothing matched, an honest correlation) with its
      // own evidence chain. The card shows the TOP (best-confidence) finding's evidence in full —
      // its matched events, metric-window facts, and health checks, each carrying its own
      // provenance/tone — and folds any remaining findings into one trailing summary line so a
      // secondary lead is never silently dropped.
      const d = card.data;
      if (!d || !Array.isArray(d.findings) || d.findings.length === 0) return null;
      const [top, ...rest] = d.findings;
      const fleetWide = false; // trace_root_cause is always single-instance

      const steps = [];
      (Array.isArray(top.events) ? top.events : []).forEach((e) => {
        const row = auditEventRow(e, fleetWide);
        steps.push({ tone: row.tone, icon: row.icon, label: row.label, detail: [row.by, row.rel].filter(Boolean).join(" · ") });
      });
      (Array.isArray(top.metrics) ? top.metrics : []).forEach((m) => {
        const label = m.metric === "cpuPctCore" ? "CPU" : m.metric === "memBytes" ? "Memory" : (m.metric || "Metric");
        steps.push({ tone: "info", icon: "activity", label, detail: m.detail || "" });
      });
      (Array.isArray(top.healthChecks) ? top.healthChecks : []).forEach((h) => {
        steps.push({
          tone: CHECK_STATE_TONE[h.state] || "info",
          icon: HEALTH_CHECK_ICONS[h.name] || "stethoscope",
          label: HEALTH_CHECK_LABELS[h.name] || h.name || "check",
          detail: h.detail || "",
        });
      });
      if (rest.length) {
        steps.push({
          tone: "info",
          icon: "list",
          label: rest.length + " other lead" + (rest.length === 1 ? "" : "s") + " considered",
          detail: rest.map((f) => f.label).filter(Boolean).join(" · "),
        });
      }

      return {
        kind: "rootcause",
        serverId: d.instance || id,
        serverName: d.instance || id || "this server",
        confidence: card.confidence || top.confidence || null,
        signature: top.signature || "none",
        headline: top.explanation || "",
        steps,
      };
    }
    case "search": {
      const d = card.data;
      // A card is only surfaced when the search has passages to cite; empty/failed stays summary-only.
      if (!d || !Array.isArray(d.passages) || d.passages.length === 0) return null;
      const passages = d.passages.map(p => ({
        origin: p.provenance === "web" ? "web" : "local",
        source: p.source || "",
        title: p.title || null,
        text: p.text || "",
        score: typeof p.score === "number" ? p.score : null,
      }));
      const anyLocal = passages.some(p => p.origin === "local");
      const anyWeb = passages.some(p => p.origin === "web");
      return {
        kind: "search",
        confidence: card.confidence || null,
        query: d.query || id || "",
        state: d.state || null,      // "localStrong" | "localWeak" | "web"
        provenance: anyLocal && anyWeb ? "mixed" : anyWeb ? "web" : "local",
        passages,
      };
    }
    case "get_network": {
      // Two independent axes, each with its own honest-unknown states that must NEVER read
      // as "nothing open / nothing forwarded": the HOST FIREWALL (state / listState /
      // enforcement / open port ranges) and the ROUTER's UPnP forwards (upnpState / forwards).
      // The card is only attached when at least one axis has real structure, but the OTHER
      // axis may be unreadable — carry its state through verbatim so the card can say so.
      const d = card.data;
      if (!d) return null;
      const proto = (p) => (p ? String(p).toLowerCase() : "");
      const ports = Array.isArray(d.ports) ? d.ports.map((p) => ({
        start: typeof p.start === "number" ? p.start : null,
        end: typeof p.end === "number" ? p.end : null,
        protocol: proto(p.protocol),
      })) : [];
      const forwards = Array.isArray(d.forwards) ? d.forwards.map((f) => ({
        externalPort: typeof f.externalPort === "number" ? f.externalPort : null,
        internalPort: typeof f.internalPort === "number" ? f.internalPort : null,
        protocol: proto(f.protocol),
        internalClient: f.internalClient || null,
      })) : [];
      return {
        kind: "network",
        serverId: id,
        serverName: id || "this server",
        confidence: card.confidence || null,
        firewall: {
          state: d.state || "firewallUnavailable",   // "available" | "firewallUnavailable"
          backend: d.backend || null,
          listState: d.listState || "unknown",         // "enumerated" | "unknown" | "unsupported"
          enforcement: d.enforcement || "unknown",     // "enforcing" | "inactive" | "unknown"
          ports,
        },
        router: {
          state: d.upnpState || "daemonUnavailable",   // "queried" | "routerUnavailable" | "daemonUnavailable"
          forwards,
        },
      };
    }
    case "create_blueprint": {
      // The terminal outcome of the blueprint-authoring pipeline: `outcome` is a 6-value
      // enum ("disabled" | "alreadyExists" | "notFeasible" | "failed" | "draftReady" |
      // "verified") — ONLY "verified" is a real success; every other value (including an
      // absent/unrecognized one) renders the honest "couldn't" side, never a claimed
      // success we can't back up. `subject.id` is the canonical blueprint slug on every
      // outcome (the install-handoff key); `d.blueprintName` is a defensive fallback.
      const d = card.data || {};
      // "draftReady" is the mandatory-review checkpoint, NOT a terminal card: the editable
      // Monaco card is driven by the sibling command.proposed frame (verb "blueprint"), which
      // alone carries the confirmation token Save needs. Suppress the tool.result twin here so
      // the draft renders once, as the interactive card — never as a dead "couldn't add" card.
      if (d.outcome === "draftReady") return null;
      return {
        kind: "blueprintOutcome",
        confidence: card.confidence || null,
        ok: d.outcome === "verified",
        slug: id || d.blueprintName || null,
        displayName: d.game || null,
        proof: d.proofLine || null,
        reason: d.reason || null,
      };
    }
    default:
      return null;
  }
}

// The assistant's /confirm response for a blueprint finalize (Save on the review card) →
// the patch the ChatBlueprintDraft state machine applies. Read the RICH card's `data.outcome`,
// never the prose: "verified" (with success) is the only real catalog win; a "draftReady" comes
// back with a FRESH token (resp.confirmations[0]) + boot `evidence` for a second edit — the
// re-edit loop; anything else (or an unparseable/absent outcome) is an honest terminal failure,
// never a fabricated success. Slug/proof/reason are carried verbatim or left null.
function adaptBlueprintConfirm(resp) {
  const r = resp || {};
  const card = r.card || {};
  const d = (card && card.data) || {};
  const reToken = Array.isArray(r.confirmations) && r.confirmations[0] ? r.confirmations[0].token : null;

  if (d.outcome === "verified" && r.success) {
    return {
      state: "verified",
      slug: (card.subject && card.subject.id) || d.blueprintName || null,
      displayName: d.game || null,
      proof: d.proofLine || null,
    };
  }
  // Repair exhausted / invalid edit came back for another pass — only a real re-edit if the
  // draft AND a fresh token both arrived; otherwise it degrades to the honest failure below.
  if (d.outcome === "draftReady" && reToken && d.draftYaml) {
    return {
      state: "proposed",
      token: reToken,
      draftYaml: d.draftYaml,
      evidence: d.evidence || null,
      displayName: d.game || null,
    };
  }
  return {
    state: "failed",
    displayName: d.game || null,
    reason: d.reason || r.text || null,
  };
}

// ---------- the panel's chat profile ----------
// What the design system's Chat asks a product: how a tool result becomes an evidence card, what a
// proposed action is called and aimed at, and what a confirmed one's verdict says. `servers` is the
// roster a lifecycle verb's target is named from; install targets a blueprint, so its name is the
// one the person asked the new instance to have.
function kgsmChatProfile(servers) {
  return {
    adaptCard: adaptResultCard,
    proposalLabel: (verb) => commandMeta(verb).label,
    proposal: (msg) => {
      const isInstall = msg.verb === "install";
      const found = isInstall ? null : ((servers || []).find(s => s.id === msg.subjectId) || null);
      return {
        meta: commandMeta(msg.verb),
        runnable: LEAF_COMMAND_VERBS.has(msg.verb),
        target: msg.instanceName || msg.subjectId || "this server",
        targetName: isInstall ? (msg.instanceName || msg.subjectId) : (found && found.name) || msg.subjectId,
        unavailable: "Not available from the panel yet",
      };
    },
    verdict: (msg, targetName, resp) => composeVerified(msg.verb, targetName, resp),
  };
}

// The conversation functions with the panel's cards in them, for a caller that holds frames or
// stored turns and wants them as the panel would draw them.
const PANEL_PROFILE = kgsmChatProfile([]);
const reduceTurnFrame = (messages, ev) => reduceWith(messages, ev, PANEL_PROFILE);
const scaffoldHistory = (entries) => scaffoldWith(entries, PANEL_PROFILE);

export {
  TOGGLE_COPY, kgsmChatProfile,
  composeVerified, adaptResultCard, adaptBlueprintConfirm,
  reduceTurnFrame, scaffoldHistory,
  promotePendingCards, toolLabel, latestUsage, mergeServerConversations, adoptServerConversation,
};

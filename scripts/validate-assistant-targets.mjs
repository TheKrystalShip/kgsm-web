// Which assistants a browser can address, and how each one is found.
//
// The assistant runs in one of two standings: a LEAF on a node, discovered from that node's
// capability, or an ANCHOR — a member of the cluster holding the `assistant` capability at its own
// address. A panel that only looks at nodes reports a healthy cluster assistant as no assistant at
// all, which is a true statement about where it looked and a false one about the cluster.
//
// The join is the part worth pinning: capability ASSIGNMENT → member → that member's browser
// address. Reading an address off whichever member states one would let any member answer for a
// capability it does not hold; going through the assignment means moving it is a visible change to
// cluster state. These are the edges of that join, which a browser cannot arrange cheaply — an
// assignment naming a member the roster has no row for, one the cluster has already orphaned, and
// the empty cluster a standalone deployment presents.
//
//   node scripts/validate-assistant-targets.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:5173/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;

const { answersFor, assistantForHost, assistantTargets, resolveTarget, usableTargets } = await import("../src/lib/assistants.js");

let fail = 0;
const assert = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};

const ANCHOR_MEMBER = {
  nodeId: "hotrod-assistant", kind: "anchor", label: "assistant",
  clientUrl: "https://assistant.example.com", membership: "alive", status: "reachable",
};
const NODE_MEMBER = {
  nodeId: "hotrod", kind: "node", label: "Hotrod",
  clientUrl: "https://hotrod.example.com", membership: "alive", status: "reachable",
};
const held = (memberId, extra = {}) => [{ capability: "auth", memberId: "hotrod-auth", held: true, orphaned: false },
  { capability: "assistant", memberId, held: true, orphaned: false, ...extra }];
const leafHost = (id, url) => ({
  id, name: id, online: true,
  capabilities: { assistant: { provisioned: true, status: "operational", info: { url } } },
});

// ---- the cluster's own -----------------------------------------------------
let t = assistantTargets({
  hosts: [], members: [ANCHOR_MEMBER, NODE_MEMBER], capabilities: held("hotrod-assistant") });
assert(t.length === 1 && t[0].id === "hotrod-assistant" && t[0].kind === "anchor",
  "the capability's holder is the cluster's assistant", t.map(x => x.id + ":" + x.kind).join(","));
assert(t[0].origin === "https://assistant.example.com",
  "reached at its own member address", t[0].origin);
assert(t[0].name === "Cluster assistant" && t[0].title === "the cluster assistant",
  "named for what it is rather than after a member", t[0].name + " / " + t[0].title);

// A node that happens to be an anchor, or to be called something suggestive, is NOT the assistant.
// Only the assignment says which member is.
t = assistantTargets({ hosts: [], members: [ANCHOR_MEMBER, NODE_MEMBER], capabilities: held("hotrod-auth") });
assert(t.length === 0,
  "a member the capability is not assigned to is not the assistant, whatever it is called",
  t.map(x => x.id).join(",") || "none");

// ---- assignments that name nothing ----------------------------------------
t = assistantTargets({ hosts: [], members: [NODE_MEMBER], capabilities: held("hotrod-assistant") });
assert(t.length === 0,
  "a holder the roster has no row for names no assistant — there is no address to be down at");

t = assistantTargets({
  hosts: [], members: [ANCHOR_MEMBER], capabilities: held("hotrod-assistant", { orphaned: true }) });
assert(t.length === 0, "an orphaned assignment is held by nobody and served by nobody");

t = assistantTargets({
  hosts: [], members: [ANCHOR_MEMBER], capabilities: held("hotrod-assistant", { held: false }) });
assert(t.length === 0, "and a capability the cluster decided nobody holds names nobody");

// ---- a member that is there but not answering ------------------------------
t = assistantTargets({
  hosts: [],
  members: [{ ...ANCHOR_MEMBER, status: "unreachable" }],
  capabilities: held("hotrod-assistant") });
assert(t.length === 1 && t[0].state === "down" && !!t[0].message,
  "an assistant the cluster cannot reach is listed, down, carrying why", t[0] && t[0].message);
assert(usableTargets(t).length === 0, "and is not one to send a turn to");

// ---- both standings at once ------------------------------------------------
t = assistantTargets({
  hosts: [leafHost("hotrod", "https://leaf.example.com")],
  members: [ANCHOR_MEMBER, NODE_MEMBER],
  capabilities: held("hotrod-assistant") });
assert(t.length === 2 && t[0].kind === "anchor" && t[1].kind === "leaf",
  "a cluster can have both, and the cluster's own comes first",
  t.map(x => x.kind).join(","));
assert(t[1].origin === "https://leaf.example.com" && t[1].title === "hotrod’s assistant",
  "a leaf keeps the address its node reports and is named after that node", t[1].title);

// ---- which one is addressed ------------------------------------------------
assert(resolveTarget(t, null).kind === "anchor",
  "with nothing chosen the cluster's own is the default — it acts on every node");
assert(resolveTarget(t, "hotrod").kind === "leaf",
  "a choice this account made wins over the default");
assert(resolveTarget(t, "a-member-that-left").kind === "anchor",
  "a choice that is no longer in the cluster falls back rather than pointing at nothing");

// Several leaves, no cluster assistant, nothing chosen: deliberately unresolved, which is the picker.
const twoLeaves = assistantTargets({
  hosts: [leafHost("hotrod", "https://a.example.com"), leafHost("node-b", "https://b.example.com")],
  members: [], capabilities: [] });
assert(twoLeaves.length === 2 && resolveTarget(twoLeaves, null) === null,
  "several leaves and no choice resolves to nobody — binding to whichever sorted first is not a choice");
assert(resolveTarget(assistantTargets({
  hosts: [leafHost("hotrod", "https://a.example.com")], members: [], capabilities: [] }), null).id === "hotrod",
  "the only one there is, is taken");

// ---- who can answer about a node -------------------------------------------
// The gate behind every "ask the assistant" affordance. It used to be asked of the alert's own NODE,
// which is false of every node in a cluster whose assistant is an anchor — so a healthy assistant sat
// behind disabled buttons. It is the same list and the same function the dock resolves with now.
const both = assistantTargets({
  hosts: [leafHost("hotrod", "https://leaf.example.com")],
  members: [ANCHOR_MEMBER, NODE_MEMBER],
  capabilities: held("hotrod-assistant") });

assert(answersFor(both[0], "node-b") && answersFor(both[0], "hotrod"),
  "the cluster's own answers about every node in it");
assert(answersFor(both[1], "hotrod") && !answersFor(both[1], "node-b"),
  "a leaf answers about its own machine and no other");
assert(answersFor(both[1], null),
  "and a question scoped to no node is answered by any of them");

assert(assistantForHost(both, "hotrod").kind === "leaf",
  "a node running its own leaf is asked its own — closest to the subject");
assert(assistantForHost(both, "node-b").kind === "anchor",
  "a node running none falls to the cluster's own rather than to a leaf that cannot see it");

const leafOnly = assistantTargets({
  hosts: [leafHost("node-b", "https://b.example.com")], members: [], capabilities: [] });
assert(assistantForHost(leafOnly, "hotrod") === null,
  "with only another node's leaf there is nobody to ask about this one — the button stays disabled");
assert(assistantForHost(leafOnly, "node-b") !== null, "and somebody to ask about that one");
assert(assistantForHost(leafOnly, null) !== null,
  "a panel-wide question is answerable by whoever is there");

const anchorOnly = assistantTargets({
  hosts: [], members: [ANCHOR_MEMBER, NODE_MEMBER], capabilities: held("hotrod-assistant") });
assert(assistantForHost(anchorOnly, "hotrod") !== null && assistantForHost(anchorOnly, "node-b") !== null,
  "and a cluster assistant answers about a node that runs no leaf at all — the case that was disabled");

const down = assistantTargets({
  hosts: [], members: [{ ...ANCHOR_MEMBER, status: "unreachable" }], capabilities: held("hotrod-assistant") });
assert(assistantForHost(down, "hotrod") === null,
  "an assistant that cannot be reached is not one to offer to ask");

// ---- a deployment with no cluster -----------------------------------------
assert(assistantTargets({ hosts: [], members: [], capabilities: [] }).length === 0,
  "and a panel with neither has no assistant, which is the honest answer");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

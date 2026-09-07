// A node is never named to a person by an internal key.
//
// Two surfaces name nodes — the connectivity banner and the per-node access notice — and both used to
// fall back to the routing id when they had no name. An id is not a name: the realtime store files an
// unreconciled connection under a placeholder, so the banner told people they had "lost the live
// connection to _cold-boot", and a session recorded against a missing id surfaced as "null ended your
// session". Neither names a machine anyone owns.
//
//   node scripts/validate-node-labels.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:5173/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;

localStorage.setItem("krystal:hosts:registry", JSON.stringify([
  { id: "hotrod", url: "https://kgsm.thekrystalship.com", name: "Hotrod", via: "manual" },
  { id: "node-b", url: "https://node-b.thekrystalship.com", name: null, via: "roster" },
]));

const { nodeLabel, isNamedNode } = await import("../src/lib/nodeLabel.js");
const { sessionStore } = await import("../src/lib/sessionStore.js");

let fail = 0;
const assert = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};

const hosts = [{ id: "hotrod", name: "Hotrod" }];

assert(nodeLabel("hotrod", hosts) === "Hotrod", "a host that reports a name is called that");
assert(nodeLabel("node-b", hosts) === "node-b.thekrystalship.com",
  "a node with no reported name falls back to its address, not its id", nodeLabel("node-b", hosts));
assert(nodeLabel("_cold-boot", hosts) === "this host",
  "the realtime store's placeholder is never printed as a name", nodeLabel("_cold-boot", hosts));
assert(nodeLabel(null, hosts) === "this host",
  "neither is a missing id", nodeLabel(null, hosts));
assert(!nodeLabel("_cold-boot", hosts).includes("_"),
  "no internal key leaks into a sentence a person reads");

assert(isNamedNode("hotrod") && !isNamedNode("_cold-boot") && !isNamedNode(null),
  "a placeholder is not a node this browser drives");

// The source of "null grants your account nothing": a fact recorded against a connection with no
// id, then rendered by a banner that names the node. The session is no longer keyed by node, so it
// cannot carry this — but which members are honouring it IS keyed, so the same sentence is one
// unguarded write away and this is where that write is caught.
sessionStore.markNode(null, "refusing", "unknown_here");
sessionStore.markNode(undefined, "refusing", "unknown_here");
sessionStore.markNode("", "refusing", "unknown_here");
const keys = Object.keys(sessionStore.getState().nodes);
assert(!keys.includes("null") && !keys.includes("undefined") && !keys.includes(""),
  "a member's refusal is never filed under a missing node id", keys.length ? keys.join(",") : "(none)");

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

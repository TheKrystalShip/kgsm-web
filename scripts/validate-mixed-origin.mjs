// An address this page cannot fetch is not a member having trouble.
//
// A member's roster address is the one MEMBERS reach it at. On a secure page a plaintext one is
// blocked by the browser before the request is made, so registering it strands a connection that can
// only ever read as down — and the reach banner then names a node that is perfectly healthy. The
// node is fine, the address is unusable from here, and reporting the first as the second sends
// somebody to check a machine that is answering.
//
// It needs its own process because the guard reads `location.protocol`, and the origin a jsdom is
// built with is fixed for the life of the module graph.
//
//   node scripts/validate-mixed-origin.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://kgsm.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;

localStorage.setItem("krystal:hosts:registry", JSON.stringify([
  { id: "hotrod", url: "https://kgsm.test", name: "hotrod", via: "manual" },
]));

const config = await import("../src/lib/config.js");
const { reconcileRosterToRegistry } = await import("../src/lib/connect.js");

let fail = 0;
const assert = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const ids = () => config.CONNECTIONS.map((c) => c.id).join();
const member = (id, url) => ({
  nodeId: id, label: id, clientUrl: url, kind: "node",
  enabled: true, membership: "alive", status: "reachable",
});

// 1. A healthy member the page cannot address does not become a connection.
let r = reconcileRosterToRegistry([member("node-b", "http://192.168.1.200:8080")], { localHostId: "hotrod" });
assert(r.added === 0, "a plaintext member is not registered from a secure page", `added=${r.added}`);
assert(ids() === "hotrod", "so nothing is driven that cannot be reached", ids());

// 2. The same member on an address the page CAN use joins normally — the rule is about the
//    address, never about the member.
r = reconcileRosterToRegistry([member("node-b", "https://node-b.kgsm.test")], { localHostId: "hotrod" });
assert(r.added === 1 && ids() === "hotrod,node-b", "the same member joins on a usable address", ids());

// 3. One stored before the rule existed is dropped on the next reconcile, not left for somebody to
//    clear by hand — the same treatment an anchor registered by an older build gets.
config.removeConnections(["node-b"]);
config.addConnections([{ id: "node-b", url: "http://192.168.1.200:8080", name: "node-b", via: "roster" }]);
assert(ids() === "hotrod,node-b", "a stored plaintext member is present to begin with", ids());
r = reconcileRosterToRegistry([member("node-b", "http://192.168.1.200:8080")], { localHostId: "hotrod" });
assert(r.removed === 1, "reconciling drops it", `removed=${r.removed}`);
assert(ids() === "hotrod", "so the banner it was stuck in clears itself", ids());

// 4. The heal, which is what somebody actually experiences: a stale plaintext entry stored before
//    the cluster advertised a browser address is dropped, and the member returns on the usable one
//    the next time the roster is read. Two passes, because the drop and the join are the same
//    member and removing by id would take the new row with the old — and the roster is re-read on a
//    timer, so nobody has to reload for it.
config.removeConnections(["node-b", "typed"]);
config.addConnections([{ id: "node-b", url: "http://192.168.1.200:8080", name: "node-b", via: "roster" }]);
const usable = [member("node-b", "https://node-b.kgsm.test")];
r = reconcileRosterToRegistry(usable, { localHostId: "hotrod" });
assert(r.removed === 1 && ids() === "hotrod", "the stale address goes on the first pass", ids());
r = reconcileRosterToRegistry(usable, { localHostId: "hotrod" });
assert(r.added === 1 && ids() === "hotrod,node-b", "and the member returns on the usable one", ids());
assert(config.CONNECTIONS.filter((c) => c.id === "node-b").length === 1,
  "exactly once — a heal that leaves both is a fan-out over one node twice");

// 5. An address a PERSON typed is theirs. The cluster taught us the ones above; it has said nothing
//    about this one, and a rule about roster addresses is not licence to remove somebody's own.
config.addConnections([{ id: "typed", url: "http://192.168.1.50:8080", name: "Typed by hand" }]);
r = reconcileRosterToRegistry([member("node-b", "https://node-b.kgsm.test")], { localHostId: "hotrod" });
assert(config.CONNECTIONS.some((c) => c.id === "typed"), "an address a person typed is left alone", ids());

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

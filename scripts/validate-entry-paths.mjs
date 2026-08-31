// Two entry paths, and the third thing somebody types.
//
// An auth anchor holds a cluster's accounts; a standalone node holds its own. Both are doors and
// neither is above the other. A node that belongs to a cluster is not a door at all — it serves no
// auth and announces nothing about its cluster — so it can only be refused, and the refusal names
// the holder because a name is not an address.
//
// The claim underneath all of it: nothing is discovered THROUGH a node. Every fetch is recorded, so
// "no node was asked where this browser signs in" is a measured zero.
//
//   node scripts/validate-entry-paths.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://panel.test/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.location = dom.window.location;

const ANCHOR = "https://auth.test";
const STANDBY = "https://auth2.test";
const SOLO = "https://solo.test";
const CLUSTERED = "https://member.test";
const STRANGER = "https://nginx.test";
const DEAD = "https://gone.test";

const calls = [];
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body),
  { status, headers: { "Content-Type": "application/json", ...headers } });

globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  const at = (o, p) => u === o + p;

  if (at(ANCHOR, "/auth/identity")) return json({ name: "kgsm-auth-anchor", cluster: "kgsm-cluster", holding: true });
  if (at(STANDBY, "/auth/identity")) return json({ name: "kgsm-auth-anchor", cluster: "kgsm-cluster", holding: false });
  if (at(ANCHOR, "/auth/providers")) return json({ providers: ["discord"], redirects: true, registration: true });

  // A standalone node: a kgsm-api that holds its own accounts and answers its own auth.
  if (at(SOLO, "/api/v1")) return json({ name: "kgsm-api", version: "v1", label: "solo", build: "0.169.0+abc" });
  if (at(SOLO, "/auth/providers")) return json({ providers: ["discord"], redirects: true, registration: false });

  // A node in an anchored cluster: healthy, and refuses every auth path naming only the holder.
  if (at(CLUSTERED, "/api/v1")) return json({ name: "kgsm-api", version: "v1", label: "hotrod" });
  if (at(CLUSTERED, "/auth/providers")) {
    return json({ error: { code: "auth_held_by_anchor", message: "held" } }, 503,
      { "X-Kgsm-Auth-Holder": "hotrod-auth" });
  }

  // Something that answers, and is not ours.
  if (at(STRANGER, "/api/v1")) return json({ hello: "nginx" });

  if (u.startsWith(DEAD)) throw new TypeError("Failed to fetch");
  return json({ error: { code: "not_found" } }, 404);
};

const { identifyAddress, rememberDoor } = await import("../src/lib/authFlow.js");
const config = await import("../src/lib/config.js");

let fail = 0;
const check = (c, label, extra = "") => {
  console.log(`${c ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!c) fail++;
};
const door = () => { try { return JSON.parse(localStorage.getItem("krystal:anchor") || "null"); } catch { return null; } };
const ids = () => config.CONNECTIONS.map((c) => c.id || c.url).join();

// 1. An anchor holding a cluster's accounts is a door, and its doors are read in the same pass.
let r = await identifyAddress(ANCHOR);
check(r.kind === "anchor", "an anchor that says so is an anchor", r.kind);
check(r.cluster === "kgsm-cluster" && r.providers.join() === "discord" && r.registration === true,
  "and its cluster and doors come back with it", JSON.stringify([r.cluster, r.providers, r.registration]));

// 2. A standalone node is a door too, and not a lesser one.
r = await identifyAddress(SOLO);
check(r.kind === "standalone", "a node holding its own accounts is a door", r.kind);
check(r.providers.join() === "discord" && r.registration === false,
  "with its own doors, read from the node itself", JSON.stringify([r.providers, r.registration]));

// 3. The one that cannot work. The holder is NAMED — a name is not an address, and the node has
//    none to give.
r = await identifyAddress(CLUSTERED);
check(r.kind === "held-elsewhere", "a node inside a cluster is not a door", r.kind);
check(r.holder === "hotrod-auth", "and the refusal names the holder", r.holder);
check(!JSON.stringify(r).includes("auth.test"),
  "while carrying no address for it — a clustered node announces nothing about its cluster");

// 4. An anchor standing by is a promotion candidate, not a second authority.
r = await identifyAddress(STANDBY);
check(r.kind === "anchor-standby", "an anchor that is not holding is not offered as a door", r.kind);

// 5. Nothing there, and something there that is not ours — different sentences.
check((await identifyAddress(DEAD)).kind === "unreachable", "an address that does not answer is unreachable");
check((await identifyAddress(STRANGER)).kind === "unreachable", "and so is something that is not a kgsm-api");
check((await identifyAddress("not an address")).kind === "invalid", "a non-address is refused before anything is asked");

// 6. The claim underneath all of it.
check(!calls.some((u) => u.includes("/api/v1/cluster/auth")),
  "no node was asked where this browser signs in — nothing is discovered through a member",
  String(calls.filter((u) => u.includes("cluster/auth")).length) + " such calls");

// 7. Only a door is kept, and only a NODE is driven. An anchor serves no servers and no metrics; a
//    connection to one would be called by every fan-out and named in every banner forever.
rememberDoor(await identifyAddress(ANCHOR));
check(door() && door().origin === ANCHOR && door().kind === "anchor", "an anchor is kept as the door", JSON.stringify(door()));
check(ids() === "", "and is never driven as a node", ids() || "(none)");

rememberDoor(await identifyAddress(CLUSTERED));
check(door().origin === ANCHOR, "a node that is not a door does not replace one", JSON.stringify(door()));

console.log(fail ? `\n!! ${fail} failed` : "\nall checks passed");
process.exit(fail ? 1 : 0);

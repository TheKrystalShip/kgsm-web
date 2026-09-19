// dnsClient.js — the seam onto the cluster's DNS anchor, spoken directly on its own origin.
//
// The DNS anchor is never a leaf: it serves exactly one cluster-wide capability, so this browser
// always reaches it with the CLUSTER session (`clusterCredential`), the same credential every other
// admin surface already holds, and mints or renews nothing of its own — the anchor verifies that
// session itself (kgsm-dns's `ClusterBearer`).
//
// The origin is resolved through the capability ASSIGNMENT (`clusterStore.holderOf`) rather than
// through whichever member's page happens to be open. A card pinned to the dashboard has no page
// above it naming a member, and every dns.* widget is keyed on the capability rather than a member id
// so a pin follows a failover instead of pointing at a member that has stopped answering for it.

import { authorized } from "./authorizedFetch.js";
import { clusterCredential } from "./sessionStore.js";
import { clusterStore } from "./stores/cluster.js";

const CAPABILITY = "dns";

// Built fresh per call, exactly like `anchor.js`'s own calls — `clusterCredential`'s two functions
// close over the live session, so nothing here is cached that could go stale, and no import-order
// assumption is made about when the credential is first read.
const http = () => authorized(clusterCredential);

function originOf() {
  const holder = clusterStore.holderOf(CAPABILITY);
  if (!holder) return null;
  const member = clusterStore.getState().nodes.find((n) => n.nodeId === holder);
  const url = member && member.clientUrl;
  return url ? url.replace(/\/+$/, "") : null;
}

// No member currently answers for the capability — the honest reason every call below refuses with
// when the assignment names nobody or the roster has no address for whoever holds it.
function noRoute() {
  const err = new Error("No member currently holds this cluster's dns capability.");
  err.code = "no_route";
  err.noRoute = true;
  err.userMessage = err.message;
  return err;
}

// One shape for every refusal the anchor itself answers with, so a caller reads `.userMessage`
// without keeping a second copy of what each status code means.
function refusal(res) {
  if (res.unreachable) {
    const err = new Error("Couldn’t reach the dns anchor.");
    err.status = 0; err.code = "unreachable"; err.userMessage = err.message;
    return err;
  }
  if (res.unauthenticated) {
    const err = new Error("This session couldn’t be renewed — sign in again to continue.");
    err.status = 401; err.code = "unauthenticated"; err.userMessage = err.message;
    return err;
  }
  const body = res.body;
  const message = (body && body.message) || ("HTTP " + res.status);
  const err = new Error(message);
  err.status = res.status;
  err.code = (body && body.error) || null;
  err.userMessage = message;
  return err;
}

// Reads. Replayable — a refusal means the anchor never handled the request, so a renewal and a
// second send is the first time it runs rather than a second one.
async function dnsStatus() {
  const base = originOf();
  if (!base) throw noRoute();
  const res = await http().json(base + "/api/v1/cluster/dns", { headers: { Accept: "application/json" } });
  if (!res.ok) throw refusal(res);
  return res.body;
}

async function dnsEvents(limit) {
  const base = originOf();
  if (!base) throw noRoute();
  const qs = limit ? "?limit=" + encodeURIComponent(limit) : "";
  const res = await http().json(base + "/api/v1/cluster/dns/events" + qs, { headers: { Accept: "application/json" } });
  if (!res.ok) throw refusal(res);
  return (res.body && res.body.events) || [];
}

// Writes. `once` — none of these may be sent twice: a zone check and a certificate renewal both ask
// something outside this browser to act, and a certificate order is rate-limited by the issuer, so a
// refusal here is reported as it stands rather than replayed after a silent token renewal.
async function checkZoneNow() {
  const base = originOf();
  if (!base) throw noRoute();
  const res = await http().once(base + "/api/v1/cluster/dns/zone/check",
    { method: "POST", headers: { Accept: "application/json" } });
  if (!res.ok) throw refusal(res);
}

async function renewCertificate(name) {
  const base = originOf();
  if (!base) throw noRoute();
  const res = await http().once(base + "/api/v1/cluster/dns/certificates/" + encodeURIComponent(name) + "/renew",
    { method: "POST", headers: { Accept: "application/json" } });
  if (!res.ok) throw refusal(res);
}

async function addAlias(server, label) {
  const base = originOf();
  if (!base) throw noRoute();
  const res = await http().once(base + "/api/v1/cluster/dns/aliases", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ server, label }),
  });
  if (!res.ok) throw refusal(res);
  return res.body;
}

async function removeAlias(name) {
  const base = originOf();
  if (!base) throw noRoute();
  const res = await http().once(base + "/api/v1/cluster/dns/aliases/" + encodeURIComponent(name),
    { method: "DELETE", headers: { Accept: "application/json" } });
  if (!res.ok) throw refusal(res);
}

export { addAlias, checkZoneNow, dnsEvents, dnsStatus, originOf as dnsOrigin, removeAlias, renewCertificate };

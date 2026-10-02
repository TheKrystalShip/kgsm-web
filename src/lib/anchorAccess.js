// anchorAccess.js — what the caller may do with an anchor holding a capability other than `auth`.
//
// An anchor answers for its own actions — the DNS anchor for `dns:*`, the cluster's assistant for
// `assistant:*` — at `GET /me/access` on its own origin, with the cluster session every other surface
// already holds. The origin is the capability's HOLDER from the cluster's assignment, the same way
// `dnsClient.js` and `assistants.js` find it, so an answer follows a failover rather than a member that
// has stopped holding the capability.
//
// The auth anchor's answer is read through `apiClient`'s account door instead (`stores/access.js`),
// because that is where its doors live.

import { authorized } from "./authorizedFetch.js";
import { clusterCredential } from "./sessionStore.js";
import { clusterStore } from "./stores/cluster.js";

// The capabilities whose holder answers for its own actions, by the action namespace it answers for.
const ANCHORED_NAMESPACES = ["dns", "assistant"];

function originOf(capability) {
  const holder = clusterStore.holderOf(capability);
  if (!holder) return null;
  const member = clusterStore.getState().nodes.find((n) => n.nodeId === holder);
  const url = member && member.clientUrl;
  return url ? url.replace(/\/+$/, "") : null;
}

// The holder's report, or a rejection carrying `status` the way an apiClient error does — 0 when it
// could not be reached, the anchor's own status otherwise. Null when no member holds the capability.
async function readAnchorAccess(capability) {
  const base = originOf(capability);
  if (!base) return null;
  const res = await authorized(clusterCredential).json(base + "/me/access", { headers: { Accept: "application/json" } });
  if (res.ok) return res.body;
  const err = new Error((res.body && res.body.error && res.body.error.message) || ("HTTP " + res.status));
  err.status = res.unreachable ? 0 : (res.unauthenticated ? 401 : res.status);
  err.userMessage = err.message;
  throw err;
}

export { ANCHORED_NAMESPACES, readAnchorAccess };

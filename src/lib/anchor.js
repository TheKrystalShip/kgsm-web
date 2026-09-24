// anchor.js — what the panel asks the member holding the cluster's accounts.
//
// Identity belongs to the cluster. Its accounts, its roster and its sessions are held by the member
// holding the `auth` capability — the cluster's sign-in provider, on its own origin — and every other
// member accepts that member's sessions by verifying its signature offline. So the panel asks the
// provider who is in the cluster, and asks a node for nothing about identity.
//
// Everything here is authorized by a credential the caller passes in rather than by the session layer
// directly: this module sits underneath it, and importing it would close a cycle.

import { authorized } from "./authorizedFetch.js";
import { originOf } from "./oidc.js";
import { providerNamesTheFleet } from "./provider.js";

// ---- the deployment's own cluster (optional) --------------------------------
//
// A build may name an address for its cluster — any member, or the provider itself. OPT-IN and blank
// by default: a panel served by a member asks that member, and a panel on a static host with no
// configuration asks the person for an address, which is what lets one deployment serve any cluster.
// Set it and a static build signs in without asking.
const buildEnv = (typeof import.meta !== "undefined" && import.meta.env) || {};
const CONFIGURED_ADDRESS = originOf((buildEnv.VITE_AUTH_ANCHOR || "").trim());
function configuredAnchor() { return CONFIGURED_ADDRESS; }

// The cluster's members, as the provider knows them — nodes and other anchors, each with `kind`.
// Authenticated, because who is in a cluster is not something an unauthenticated caller learns.
//
// This is where the panel's fleet comes from, and it is the FIRST call a panel makes: it keeps no
// node list between loads, so there is no other request whose refusal could renew a lapsed bearer on
// its behalf. That is why it takes a CREDENTIAL and not a token — see `authorizedFetch.js`. Every
// address in the answer is fetchable from a browser: the provider OMITS a member that advertises none
// rather than falling back to the address its peers use, which would turn "not reachable from here"
// into "reachable, and permanently down".
export async function clusterMembers(anchorUrl, cred, { fetchImpl = fetch, signal } = {}) {
  const base = originOf(anchorUrl);
  if (!base) return { ok: false, members: [] };

  const res = await authorized(cred, { fetchImpl })
    .json(base + "/auth/cluster/members", { headers: { Accept: "application/json" }, signal });
  if (!res.ok) return { ok: false, status: res.status, members: [] };

  const rows = Array.isArray(res.body && res.body.members) ? res.body.members : [];
  return {
    ok: true,
    cluster: (res.body && res.body.cluster) || "",
    members: rows.map((m) => ({
      memberId: m.memberId || "",
      kind: m.kind || "node",
      url: originOf(m.url) || "",
      nickname: m.nickname || null,
      status: m.status || "unknown",
      membership: m.membership || "unknown",
    })).filter((m) => m.memberId && m.url),
  };
}

// Whether the cluster's provider names the fleet, which is whether one is known. See provider.js.
const anchorNamesTheFleet = providerNamesTheFleet;

export { anchorNamesTheFleet, configuredAnchor, originOf };

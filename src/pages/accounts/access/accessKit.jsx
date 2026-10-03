// accessKit — what the auth anchor's management pages share: reading the authority, asking the rules
// about edits nobody has made, showing a refusal, and naming a scope.
//
// Every page gates its controls on the caller's `/me/access` (`may`) and shows a control the rules
// would refuse with the rules' own reason beside it, rather than hiding it. The reason is the
// anchor's: `authorityStore.check` runs the same rules an edit meets and writes nothing.

import React from "react";

import { Icon, useStore } from "@thekrystalship/krystal-ui";
import { nodeLabel } from "../../../lib/nodeLabel.js";
import { sessionStore } from "../../../lib/sessionStore.js";
import { authorityStore } from "../../../lib/stores/authority.js";
import { hostsStore, serversStore } from "../../../lib/stores.js";

// The authority, read when the first page wanting it mounts and kept for the rest.
function useAuthority() {
  const state = useStore(authorityStore);
  React.useEffect(() => { authorityStore.refresh().catch(() => {}); }, []);
  return state;
}

// The rules' verdicts on `edits`, re-asked whenever `key` or the authority's version moves. Null
// until answered, and a null entry for an edit the anchor could not be asked about.
function useChecks(edits, key) {
  const version = useStore(authorityStore, (s) => (s.view ? s.view.version : null));
  const [results, setResults] = React.useState(null);
  const ref = React.useRef(edits);
  ref.current = edits;
  React.useEffect(() => {
    let cancelled = false;
    if (version == null) return undefined;
    authorityStore.check(ref.current).then((r) => { if (!cancelled) setResults(r); });
    return () => { cancelled = true; };
  }, [key, version]);
  return results;
}

// A refusal beside the control it is about. `reauth_required` is the one a person can clear here: the
// provider's account page asks for their credential, and the change can be made again after.
function RefusalNote({ refusal, compact }) {
  if (!refusal) return null;
  const reauth = refusal.code === "reauth_required";
  const page = reauth ? sessionStore.accountPage() : "";
  return (
    <div className={"access-refusal" + (compact ? " access-refusal--compact" : "")} role="alert">
      <Icon name={reauth ? "key-round" : "lock"} size={13} />
      <span>
        {refusal.message}
        {refusal.actions && refusal.actions.length > 0 && (
          <> <span className="access-refusal__actions">{refusal.actions.join(", ")}</span></>
        )}
      </span>
      {reauth && page && (
        <a className="access-refusal__link" href={page} target="_blank" rel="noreferrer">Prove it’s you</a>
      )}
    </div>
  );
}

// A lock and its reason, for a row the rules close.
function Locked({ result }) {
  if (!result || result.allowed) return null;
  return (
    <span className="access-lock" title={result.message || ""}>
      <Icon name="lock" size={12} />
      <span className="access-lock__text">{result.message}</span>
    </span>
  );
}

// `instance:<node>/<id>#<nonce>` → its parts, or null.
function parseInstance(scope) {
  const m = /^instance:([^/]+)\/([^#]+)#(.+)$/.exec(scope || "");
  return m ? { hostId: m[1], serverId: m[2], nonce: m[3] } : null;
}

// A scope in words: the cluster, a node by its name, a server by its label and node.
function useScopeText() {
  const hosts = useStore(hostsStore, (s) => s.list);
  const servers = useStore(serversStore, (s) => s.list);
  return React.useCallback((scope) => {
    if (!scope || scope === "cluster") return "Cluster";
    if (scope.startsWith("node:")) return nodeLabel(scope.slice(5), hosts);
    const inst = parseInstance(scope);
    if (!inst) return scope;
    const server = (servers || []).find((s) => s.hostId === inst.hostId && s.id === inst.serverId
      && s.installNonce === inst.nonce);
    return (server ? server.name : inst.serverId + " (removed)") + " on " + nodeLabel(inst.hostId, hosts);
  }, [hosts, servers]);
}

// Every scope an assignment can be made at: the cluster, each node, and each server whose install
// nonce is known — a grant names the install, and one without its nonce cannot be made.
function useScopeOptions() {
  const hosts = useStore(hostsStore, (s) => s.list);
  const servers = useStore(serversStore, (s) => s.list);
  return React.useMemo(() => {
    const out = [{ value: "cluster", label: "Cluster" }];
    (hosts || []).forEach((h) => out.push({ value: "node:" + h.id, label: "Node · " + (h.name || h.id) }));
    (servers || []).forEach((s) => {
      if (!s.installNonce || !s.hostId) return;
      out.push({
        value: "instance:" + s.hostId + "/" + s.id + "#" + s.installNonce,
        label: "Server · " + s.name + " on " + nodeLabel(s.hostId, hosts),
      });
    });
    return out;
  }, [hosts, servers]);
}

// The component an action belongs to: the part before the colon.
const componentOf = (action) => String(action || "").split(":")[0];

// A role's name as a person reads it.
function roleName(view, id) {
  const r = view && view.roles.find((x) => x.id === id);
  return r ? r.name : id;
}

// The pages' shared empty states.
function Brief({ title, sub }) {
  return (
    <div className="chat-brief">
      <div className="chat-brief__empty chat-brief__empty--neutral">
        <div className="chat-brief__empty-title">{title}</div>
        {sub && <div className="chat-brief__empty-sub">{sub}</div>}
      </div>
    </div>
  );
}

// What a page renders while the authority is not in hand, or null once it is.
function authorityGate(state) {
  if (state.view) return null;
  if (state.status === "error") {
    const e = state.error;
    if (e && e.status === 403) return <Brief title="You don’t have access to this" sub={e.userMessage} />;
    return <Brief title="Couldn’t read access" sub={(e && e.userMessage) || null} />;
  }
  return <Brief title="Loading…" />;
}

export {
  Brief, Locked, RefusalNote, authorityGate, componentOf, parseInstance, roleName,
  useAuthority, useChecks, useScopeOptions, useScopeText,
};

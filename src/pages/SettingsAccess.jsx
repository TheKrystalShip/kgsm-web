import React from "react";

import { Icon, SettingsRow, SettingsSection, useStore } from "@thekrystalship/krystal-ui";
import { ANCHOR_SOURCE } from "../lib/access.js";
import { nodeLabel } from "../lib/nodeLabel.js";
import { sessionStore } from "../lib/sessionStore.js";
import { accessStore, hostsStore, serversStore } from "../lib/stores.js";

// SettingsAccess — "Your access": what this person may do, and where, read-only.
//
// Every member answers `/me/access` for what it holds, already evaluated, and this lists those answers
// as they stand — the actions allowed cluster-wide, on each node and on each server — with the member
// that could not answer said beside them. Everything else on the panel simply omits the controls you
// cannot use, which answers "what can I do" only by elimination; this is where it is said out loud.
//
// Nothing here is editable. Roles are assigned on the auth anchor's pages.

// A host run with auth switched off signs nobody in, so there is no account to stand anywhere.
const ACCOUNT_TEXT = { active: "Active", pending: "Awaiting approval", open: "Auth switched off" };

const STATE_TEXT = {
  unavailable: "can’t read its access records right now",
  refused: "has no active account for you",
  unreachable: "didn’t answer",
};

function SettingsAccess() {
  const session = useStore(sessionStore, (s) => s.session);
  const nodes = useStore(sessionStore, (s) => s.nodes);
  const sources = useStore(accessStore, (s) => s.sources);
  const hosts = useStore(hostsStore, (s) => s.list);
  const servers = useStore(serversStore, (s) => s.list);

  // Every target any member named, with the actions allowed there, merged across members.
  const targets = React.useMemo(() => {
    const cluster = new Set();
    const byNode = {};
    const byServer = {};
    Object.keys(sources).forEach((k) => {
      const r = sources[k] && sources[k].report;
      if (!r) return;
      (r.cluster || []).forEach((a) => cluster.add(a));
      Object.entries(r.nodes || {}).forEach(([id, list]) => { (byNode[id] = byNode[id] || new Set()); list.forEach((a) => byNode[id].add(a)); });
      Object.entries(r.instances || {}).forEach(([key, list]) => { (byServer[key] = byServer[key] || new Set()); list.forEach((a) => byServer[key].add(a)); });
    });
    return { cluster, byNode, byServer };
  }, [sources]);

  if (!session) return null;

  const owner = Object.keys(sources).some((k) => sources[k] && sources[k].report && sources[k].report.owner);
  const account = session.open ? "open" : (session.account || "unknown");
  const silent = Object.keys(sources).filter((k) => sources[k] && sources[k].state !== "ok");
  // A member that verified the session and would not serve it. Its own answer about this session.
  const refusing = Object.keys(nodes).filter((id) => nodes[id].accepts === "refusing");

  const serverName = (key) => {
    const m = /^([^/]+)\/([^#]+)#(.+)$/.exec(key);
    if (!m) return key;
    const s = (servers || []).find((x) => x.hostId === m[1] && x.id === m[2]);
    return (s ? s.name : m[2]) + " on " + nodeLabel(m[1], hosts);
  };
  const memberName = (k) => (k === ANCHOR_SOURCE ? "The auth anchor"
    : k.startsWith("anchor:") ? "The " + k.slice(7) + " anchor"
    : nodeLabel(k.slice(5), hosts));
  const list = (set) => [...set].sort().join(", ");

  return (
    <SettingsSection icon="shield-check" title="Your access">
      <SettingsRow icon="key-round" title="Account"
        tone={account === "active" || account === "open" ? undefined : "warn"}>
        <span className={"settings-access__tier settings-access__tier--" + (account === "active" || account === "open" ? "ok" : "warn")}>
          {ACCOUNT_TEXT[account] || "No account"}
        </span>
      </SettingsRow>

      {owner && (
        <SettingsRow icon="crown" title="Owner" sub="Every action, everywhere">
          <span className="settings-access__tier settings-access__tier--ok">Owner</span>
        </SettingsRow>
      )}

      {!owner && (
        <SettingsRow icon="globe" title="Across the cluster"
          sub={targets.cluster.size ? list(targets.cluster) : "Nothing cluster-wide"} />
      )}
      {!owner && Object.keys(targets.byNode).sort().map((id) => (
        <SettingsRow key={id} icon="server" title={nodeLabel(id, hosts)} sub={list(targets.byNode[id])} />
      ))}
      {!owner && Object.keys(targets.byServer).sort().map((key) => (
        <SettingsRow key={key} icon="gamepad-2" title={serverName(key)} sub={list(targets.byServer[key])} />
      ))}

      {silent.map((k) => (
        <SettingsRow key={k} icon="circle-help" title={memberName(k)} tone="warn"
          sub={STATE_TEXT[sources[k].state] || sources[k].state}>
          <span className="settings-access__tier settings-access__tier--muted">Unknown</span>
        </SettingsRow>
      ))}

      {refusing.map((id) => (
        <SettingsRow key={id} icon="server-off" title={nodeLabel(id, hosts)} tone="warn"
          sub={nodes[id].reason === "unknown_here"
            ? "This node grants your account nothing."
            : "This node can’t verify your session yet."}>
          <span className="settings-access__tier settings-access__tier--muted">Not served</span>
        </SettingsRow>
      ))}

      <div className="settings-notice">
        <Icon name="info" size={13} /> Roles are assigned on the auth anchor’s Accounts page.
      </div>
    </SettingsSection>
  );
}

export { SettingsAccess };

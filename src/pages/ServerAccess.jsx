// ServerAccess — who holds a role on this one server, and giving or taking one away: the assignments
// scoped to this install, managed where the server is.
//
// A grant here names the server's install nonce, so it follows this install and no other: a server
// reinstalled under the same id starts with none. Roles held more widely — at its node or the whole
// cluster — are the Accounts page's.

import { SettingsSection } from "../components/settings-primitives.jsx";
import { Assignments } from "./accounts/access/Assignments.jsx";
import { Brief, authorityGate, useAuthority } from "./accounts/access/accessKit.jsx";

function ServerAccess({ server }) {
  const state = useAuthority();
  if (!server.installNonce) {
    return <Brief title="No install nonce" sub={"This node has not reported one for " + server.name + "."} />;
  }
  const gate = authorityGate(state);
  if (gate) return gate;
  const scope = "instance:" + server.hostId + "/" + server.id + "#" + server.installNonce;
  return (
    <SettingsSection icon="shield" title="Access" meta={"Roles held on " + server.name}>
      <Assignments view={state.view} scope={scope} />
    </SettingsSection>
  );
}

export { ServerAccess };

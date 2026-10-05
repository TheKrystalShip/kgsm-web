// ServerAccess — who holds a role on this one server is administered on the provider's own pages; this
// tab opens them at this install's scope.
//
// A grant here names the server's install nonce, so it follows this install and no other: a server
// reinstalled under the same id starts with none, and a server whose node has not reported a nonce
// cannot be granted anything yet.

import { Icon, SettingsRow, SettingsSection } from "@thekrystalship/krystal-ui";
import { sessionStore } from "../lib/sessionStore.js";

function ServerAccess({ server }) {
  const scope = server.installNonce ? "instance:" + server.hostId + "/" + server.id + "#" + server.installNonce : null;
  const page = scope ? sessionStore.adminPage("assignments", { scope, label: server.name }) : "";

  return (
    <SettingsSection icon="shield" title="Access">
      <SettingsRow icon="user-check" title={"Roles held on " + server.name}
        sub={scope ? null : "No install nonce reported"}>
        {page ? (
          <a className="settings-btn-ghost" href={page} target="_blank" rel="noopener noreferrer" data-manage-access={scope}>
            Manage access <Icon name="external-link" size={13} />
          </a>
        ) : <span className="settings-value">—</span>}
      </SettingsRow>
    </SettingsSection>
  );
}

export { ServerAccess };

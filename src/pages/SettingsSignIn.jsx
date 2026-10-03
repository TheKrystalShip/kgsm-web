import { Icon, SettingsRow, SettingsSection } from "@thekrystalship/krystal-ui";
import { sessionStore } from "../lib/sessionStore.js";

// SettingsSignIn — how this person signs in, which is the cluster's sign-in provider's business.
//
// A password, the provider accounts that stand in for it and the list of where somebody is signed in
// are changed on the provider's own account page, behind a recent proof only those pages can ask
// for. So the panel links there and holds none of it: no credential this panel carries can change
// how anybody signs in.

function SettingsSignIn({ onLogout }) {
  const page = sessionStore.accountPage();
  return (
    <SettingsSection icon="key-round" title="Sign-in">
      <SettingsRow icon="user-cog" title="Your account" sub="Password, connected accounts and devices">
        {page ? (
          <a className="settings-btn-ghost" href={page} target="_blank" rel="noopener noreferrer">
            Open <Icon name="external-link" size={13} />
          </a>
        ) : <span className="settings-value">—</span>}
      </SettingsRow>
      <SettingsRow icon="log-out" title="Sign out" sub="This browser, and every panel and assistant it signed in to">
        <button type="button" className="settings-btn-danger" onClick={onLogout}>Sign out</button>
      </SettingsRow>
    </SettingsSection>
  );
}

export { SettingsSignIn };

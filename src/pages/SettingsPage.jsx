import { themeStore, useThemePref, THEME_OPTS } from "../lib/theme.js";
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { Select } from "../components/Select.jsx";
import { providerLabel, signInMethodLabel } from "../components/host-helpers.jsx";
import { SettingsAccess } from "./SettingsAccess.jsx";
import { SettingsIdentities } from "./SettingsIdentities.jsx";
import { SettingsSessions } from "./SettingsSessions.jsx";

// SettingsPage — YOUR account, and nothing about anybody else's. Four questions, in the order
// somebody actually asks them: who am I, what may I do, how do I get in, and where am I signed in.
//
// The subject is the person reading it. Administering other people's accounts is the API leaf's
// Users tab (`leaf/ApiUsers.jsx`), where kgsm-api's account store is — a page about who you are is
// the wrong place to decide what everybody else may do.
//
// Your name and username are shown, not edited. They come from whichever door you signed in
// through: a password sign-in carries the account's own display name, a provider sign-in carries
// that provider's rendering of it, re-read at each login. Neither is a field this panel owns, so
// neither is offered as one — an input that silently persists nowhere is worse than a plain value.

function SettingsPage({ user, onLogout }) {
  const themePref = useThemePref();

  // Which door this session came through, derived from the handle the backend returned
  // (`provider:subject`) at login. It decides what the password row can offer, so it is read here
  // once and passed down rather than re-derived.
  const sessionProvider = (user && user.provider) || null;

  return (
    <>
      <div className="dash-head">
        <h1>Settings</h1>
        <div className="dash-head__sub">Your account and how Krystal behaves across the site.</div>
      </div>

      <div className="settings-body">
        <SettingsSection icon="user" title="You">
          <div className="settings-profile">
            {/* The same gradient circle AccountAvatar draws, styled by this card's own rule. An
                avatar image is not plumbed through the session, so the initial is what there
                honestly is. */}
            <span className="settings-profile__avatar">
              {((user && (user.display || user.name)) || "?")[0].toUpperCase()}
            </span>
            <div className="settings-profile__info">
              <span className="settings-profile__name">{(user && (user.display || user.name)) || "—"}</span>
              <span className="settings-profile__provider">
                via {signInMethodLabel(sessionProvider)}
              </span>
            </div>
          </div>
          <SettingsRow icon="at-sign" title="Account"
            sub={sessionProvider === "local"
              ? "Your KGSM account name. An administrator changes it."
              : `From your ${providerLabel(sessionProvider || "")} account, and re-read each time you sign in.`}>
            <span className="settings-value settings-value--mono">{(user && user.id) || "—"}</span>
          </SettingsRow>
        </SettingsSection>

        {/* What you may do, per node — the one question no other surface answers out loud. */}
        <SettingsAccess />

        {/* How you get in: the password and the accounts that stand in for it, together. */}
        <SettingsIdentities sessionProvider={sessionProvider} />

        {/* Where you are signed in, and the history of getting there. */}
        <SettingsSessions onLogout={onLogout} />

        <SettingsSection icon="palette" title="Appearance">
          <SettingsRow icon="palette" title="Theme" sub="Auto follows your system. Saved on this device, never on a node.">
            <Select value={themePref} onChange={e => themeStore.set(e.target.value)}>
              {THEME_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection icon="triangle-alert" title="Danger zone" className="settings-danger">
          {/* Disabled, and said plainly: no endpoint deletes an account on request yet. The row is
              here because the capability is intended — but a button that looks live and does
              nothing is the one thing a danger zone must never be. Until the endpoint exists, the
              honest route is the one that actually works. */}
          <SettingsRow icon="trash-2" title="Delete account"
            sub="Not available yet. An administrator can remove your account from the node's Users tab.">
            <button className="settings-btn-danger" disabled title="No endpoint for this yet">
              Delete account
            </button>
          </SettingsRow>
          <div className="settings-notice">
            <Icon name="info" size={13} /> To sign out of every device, use Log out all under Devices.
          </div>
        </SettingsSection>
      </div>
    </>
  );
}

export { SettingsPage };
export default SettingsPage;

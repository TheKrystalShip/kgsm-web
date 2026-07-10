import React from "react";
import { themeStore, useThemePref } from "../lib/theme.js";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { Select } from "../components/Select.jsx";
import { SettingsSessions } from "./SettingsSessions.jsx";

// SettingsPage — account-level settings (distinct from the per-server Settings
// sub-tab). A single flat page with no subtabs.

const THEME_OPTS = [
  { id: "auto",             label: "Auto (system)"     },
  { id: "dark",             label: "Krystal Blue Dark"         },
  { id: "amoled",           label: "Krystal Blue Dark (AMOLED)" },
  { id: "light",            label: "Krystal Blue Light"         },
  { id: "nord",             label: "Nord"              },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha"  },
  { id: "dracula",          label: "Dracula"           },
  { id: "tokyo-night",      label: "Tokyo Night"       },
  { id: "synthwave",        label: "Synthwave '84"     },
  { id: "gruvbox",          label: "Gruvbox Dark"      },
];

function SettingsPage({ user, onLogout }) {
  const themePref = useThemePref();

  // Profile fields come from the authenticated user (sourced from the OAuth
  // provider at login); the fallbacks are empty rather than a hardcoded name.
  // Local edit state — persisted via the REST API / localStorage once wired.
  const [profile, setProfile] = React.useState({
    display: user?.display || user?.name || "",
    handle: user?.name || "",
  });

  return (
    <>
      <div className="dash-head">
        <h1>Settings</h1>
        <div className="dash-head__sub">Your account and how Krystal behaves across the site.</div>
      </div>

      <div className="settings-body">
        <SettingsSection title="Profile">
          <div className="settings-profile">
            <span className="settings-profile__avatar">
              {(profile.display || "?")[0].toUpperCase()}
            </span>
            <div className="settings-profile__info">
              <span className="settings-profile__name">{profile.display}</span>
              <span className="settings-profile__provider">via {user?.provider || "discord"}</span>
            </div>
          </div>
          <SettingsRow icon="user" title="Display name" sub="Shown across Krystal and in Discord notifications.">
            <input className="settings-input" value={profile.display}
              onChange={e => setProfile(p => ({ ...p, display: e.target.value }))} />
          </SettingsRow>
          <SettingsRow icon="at-sign" title="Username" sub="Your unique handle.">
            <input className="settings-input settings-input--mono" value={profile.handle}
              onChange={e => setProfile(p => ({ ...p, handle: e.target.value }))} />
          </SettingsRow>
          <SettingsRow icon="palette" title="Theme" sub="Auto follows your system. Saved on this device.">
            <Select value={themePref} onChange={e => themeStore.set(e.target.value)}>
              {THEME_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </SettingsRow>
          <div className="settings-foot">
            <button className="fb-editor__btn">Save changes</button>
          </div>
        </SettingsSection>

        <SettingsSessions onLogout={onLogout} />

        <SettingsSection icon="triangle-alert" title="Danger zone" className="settings-danger">
          <SettingsRow icon="log-out" title="Sign out everywhere" sub="End every active session on all devices.">
            <button className="settings-btn-ghost" onClick={onLogout}>Sign out</button>
          </SettingsRow>
          <SettingsRow icon="trash-2" title="Delete account" sub="Permanently remove your account and all servers. This cannot be undone.">
            <button className="settings-btn-danger">Delete account</button>
          </SettingsRow>
        </SettingsSection>
      </div>
    </>
  );
}

export { SettingsPage };
export default SettingsPage;

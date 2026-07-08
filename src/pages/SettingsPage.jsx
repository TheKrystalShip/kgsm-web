import React from "react";
import { SubTabs } from "../components/SubTabs.jsx";
import { themeStore, useThemePref } from "../lib/theme.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { DiscordPage } from "./DiscordPage.jsx";
import { HostAuthBadge } from "../components/host-helpers.jsx";
import { SettingsRow, SettingsSection, Toggle } from "../components/settings-primitives.jsx";
import { Select } from "../components/Select.jsx";

// SettingsPage — account- and website-level settings (distinct from the
// per-server Settings sub-tab). Uses SubTabs for URL-routed tab navigation,
// matching the pattern used by ServerDetailPage and FleetPage.

// Per-host access — one identity (Discord), but a role resolved separately on
// each host (§6·a), so access legitimately differs host to host.
function HostAccessSettings() {
  const hosts = useStore(hostsStore, s => s.list);
  useStore(sessionStore, s => s.byHost);
  return (
    <SettingsSection title="Host access">
      {hosts.map(h => (
        <SettingsRow key={h.id} icon="server" title={h.name} sub={h.hostname + " · " + (h.region || "\u2014")}>
          <HostAuthBadge hostId={h.id} />
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

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

function SettingsPage({ tab: tabProp, onTabChange, user, onLogout }) {
  const tab = tabProp || "account";
  const setTab = onTabChange || (() => {});
  const themePref = useThemePref();

  // Profile fields come from the authenticated user (sourced from the OAuth
  // provider at login); the fallbacks are empty rather than a hardcoded name.
  // Local edit state — persisted via the REST API / localStorage once wired.
  const [profile, setProfile] = React.useState({
    display: user?.display || user?.name || "",
    handle: user?.name || "",
  });
  const [prefs, setPrefs] = React.useState({
    compactDensity: false,
  });
  const setP = (k, v) => setPrefs(prev => ({ ...prev, [k]: v }));

  const tabs = [
    { id: "account",      label: "Account",        icon: "user" },
    { id: "connections",  label: "Connections",    icon: "link-2" },
    { id: "discord",      label: "Discord",        icon: "message-circle" },
    { id: "danger",       label: "Danger zone",    icon: "triangle-alert" },
  ];

  // Redirect to account tab if the current tab doesn't exist
  const validTab = tabs.some(t => t.id === tab) ? tab : "account";
  if (validTab !== tab) {
    setTab("account");
    return null;
  }

  const PROVIDERS = [
    { id: "discord",   label: "Discord",   connected: (user?.provider || "discord") === "discord", detail: "Primary — your servers and roles sync from here." },
    { id: "google",    label: "Google",    connected: user?.provider === "google" },
    { id: "github",    label: "GitHub",    connected: user?.provider === "github" },
    { id: "microsoft", label: "Microsoft", connected: user?.provider === "microsoft" },
  ];

  return (
    <>
      <div className="dash-head">
        <h1>Settings</h1>
        <div className="dash-head__sub">Your account and how Krystal behaves across the site.</div>
      </div>

      <SubTabs tabs={tabs} active={validTab} onChange={setTab} />

      <div className="settings-body">
        {validTab === "account" && (
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
            <SettingsRow icon="languages" title="Density" sub="Compact trims padding across tables and lists.">
              <Toggle on={prefs.compactDensity} onChange={v => setP("compactDensity", v)} />
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
        )}

        {validTab === "connections" && (
          <>
            <HostAccessSettings />
            <SettingsSection title="Connected accounts">
              {PROVIDERS.map(p => (
                <SettingsRow key={p.id} icon="link-2" title={p.label}
                  sub={p.connected ? (p.detail || "Connected.") : `Sign in with ${p.label} as an alternative.`}>
                  {p.connected
                    ? <span className="settings-pill settings-pill--ok">Connected</span>
                    : <button className="settings-btn-ghost">Connect</button>}
                </SettingsRow>
              ))}
            </SettingsSection>
          </>
        )}

        {validTab === "discord" && <DiscordPage />}

        {validTab === "danger" && (
          <SettingsSection icon="triangle-alert" title="Danger zone" className="settings-danger">
            <SettingsRow icon="log-out" title="Sign out everywhere" sub="End every active session on all devices.">
              <button className="settings-btn-ghost" onClick={onLogout}>Sign out</button>
            </SettingsRow>
            <SettingsRow icon="trash-2" title="Delete account" sub="Permanently remove your account and all servers. This cannot be undone.">
              <button className="settings-btn-danger">Delete account</button>
            </SettingsRow>
          </SettingsSection>
        )}
      </div>
    </>
  );
}

export { SettingsPage };
export default SettingsPage;

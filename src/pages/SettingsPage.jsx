import React from "react";
import { Icon } from "../components/Icon.jsx";
import { can } from "../lib/persona.js";
import { sessionStore } from "../lib/sessionStore.js";
import { useStore } from "../lib/store.js";
import { hostsStore } from "../lib/stores.js";
import { DiscordPage } from "./DiscordPage.jsx";
import { HostAuthBadge } from "./HostAccess.jsx";
import { Select, SettingsRow, SettingsSection, Toggle } from "./ServerSettings.jsx";

// SettingsPage — account- and website-level settings (distinct from the
// per-server Settings sub-tab). Left sub-nav + panels. Reuses the shared
// SettingsSection / SettingsRow / Toggle / Select controls from
// ServerSettings.jsx (exported to window).

// Per-host access — one identity (Discord), but a role resolved separately on
// each host (§6·a), so access legitimately differs host to host.
function HostAccessSettings() {
  const hosts = useStore(hostsStore, s => s.list);
  useStore(sessionStore, s => s.byHost);
  return (
    <SettingsSection title="Host access">
      <div className="settings-hint-line">
        <Icon name="shield-check" size={13} /> Your Discord identity is the same on every host — but each host grants its own role, so what you can do can differ per host.
      </div>
      {hosts.map(h => (
        <SettingsRow key={h.id} icon="server" title={h.name} sub={h.hostname + " · " + (h.region || "\u2014")}>
          {HostAuthBadge && <HostAuthBadge hostId={h.id} />}
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

function SettingsPage({ user, onLogout }) {
  const [section, setSection] = React.useState("account");

  // Profile fields come from the authenticated user (sourced from the OAuth
  // provider at login); the fallbacks are empty rather than a hardcoded name.
  // Local edit state — persisted via the REST API / localStorage once wired.
  const [profile, setProfile] = React.useState({
    display: user?.display || user?.name || "",
    handle: user?.name || "",
  });
  const [prefs, setPrefs] = React.useState({
    defaultRange: "24h",
    confirmDestructive: true,
    compactDensity: false,
  });
  const [assistant, setAssistant] = React.useState(() => {
    let ep = "http://localhost:11434", model = "gemma3";
    try {
      ep = localStorage.getItem("krystal:chat:endpoint") || ep;
      model = localStorage.getItem("krystal:chat:model") || model;
    } catch (e) {}
    return { endpoint: ep, model };
  });
  const setP = (k, v) => setPrefs(prev => ({ ...prev, [k]: v }));

  const NAV = [
    { id: "account",      label: "Account",        icon: "user" },
    { id: "connections",  label: "Connections",    icon: "link-2" },
    { id: "discord",      label: "Discord",        icon: "message-circle" },
    { id: "assistant",    label: "Assistant",      icon: "bot" },
    { id: "tokens",       label: "API tokens",     icon: "key" },
    { id: "danger",       label: "Danger zone",    icon: "triangle-alert" },
  ];

  const PROVIDERS = [
    { id: "discord",   label: "Discord",   connected: (user?.provider || "discord") === "discord", detail: "Primary — your servers and roles sync from here." },
    { id: "google",    label: "Google",    connected: user?.provider === "google" },
    { id: "github",    label: "GitHub",    connected: user?.provider === "github" },
    { id: "microsoft", label: "Microsoft", connected: user?.provider === "microsoft" },
  ];

  const TOKENS = [
    { name: "deploy-bot",   scopes: "servers:read, servers:control", created: "May 21, 2026", last: "2h ago" },
    { name: "grafana-pull", scopes: "metrics:read",                  created: "Apr 02, 2026", last: "5m ago" },
  ];

  return (
    <>
      <div className="dash-head">
        <h1>Settings</h1>
        <div className="dash-head__sub">Your account and how Krystal behaves across the site.</div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {NAV.map(n => (
            <button key={n.id}
              className={"settings-nav__item" + (section === n.id ? " settings-nav__item--active" : "")}
              onClick={() => setSection(n.id)}>
              <Icon name={n.icon} size={16} />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {section === "account" && (
            <SettingsSection title="Profile">
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ width: 52, height: 52, borderRadius: 999, background: "linear-gradient(135deg, #5DB5D2, #2F89A8)", color: "var(--fg-inverse)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }}>
                  {(profile.display || "?")[0].toUpperCase()}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--fg-1)", fontWeight: 600, fontSize: 15 }}>{profile.display}</span>
                  <span style={{ color: "var(--fg-3)", fontSize: 12.5, fontFamily: "var(--font-mono)" }}>via {user?.provider || "discord"}</span>
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
              <div className="settings-foot">
                <button className="fb-editor__btn">Save changes</button>
              </div>
            </SettingsSection>
          )}

          {section === "connections" && (
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

          {section === "discord" && (
            DiscordPage ? React.createElement(DiscordPage) : null
          )}

          {section === "assistant" && (
            <SettingsSection title="Assistant">
              <SettingsRow icon="server" title="Ollama endpoint" sub="Where the local model is served.">
                <input className="settings-input settings-input--mono" style={{ width: 220 }} value={assistant.endpoint}
                  onChange={e => setAssistant(a => ({ ...a, endpoint: e.target.value }))} />
              </SettingsRow>
              <SettingsRow icon="bot" title="Model" sub="The model used for chat + diagnostics.">
                <Select value={assistant.model}
                  options={[{ value: "gemma3", label: "gemma3" }, { value: "llama3.1", label: "llama3.1" }, { value: "qwen2.5", label: "qwen2.5" }]}
                  onChange={v => setAssistant(a => ({ ...a, model: v }))} />
              </SettingsRow>
              <SettingsRow icon="shield" title="Confirm before actions" sub="Always require a confirm step before the assistant runs an action.">
                <Toggle on={prefs.confirmDestructive} onChange={v => setP("confirmDestructive", v)} />
              </SettingsRow>
              <SettingsRow icon="line-chart" title="Default metrics range" sub="Time window the assistant uses when reading performance.">
                <Select value={prefs.defaultRange}
                  options={[{ value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }]}
                  onChange={v => setP("defaultRange", v)} />
              </SettingsRow>
              <div className="settings-foot">
                <button className="fb-editor__btn" onClick={() => {
                  try { localStorage.setItem("krystal:chat:endpoint", assistant.endpoint); localStorage.setItem("krystal:chat:model", assistant.model); } catch (e) {}
                }}>Save changes</button>
              </div>
            </SettingsSection>
          )}

          {section === "tokens" && (
            <SettingsSection title="API tokens">
              <div className="settings-tokens">
                {TOKENS.map(t => (
                  <div className="settings-token" key={t.name}>
                    <span className="settings-token__ico"><Icon name="key" size={15} /></span>
                    <div className="settings-token__body">
                      <span className="settings-token__name">{t.name}</span>
                      <span className="settings-token__scopes">{t.scopes}</span>
                      <span className="settings-token__meta">created {t.created} · last used {t.last}</span>
                    </div>
                    <button className="icon-btn icon-btn--danger" title="Revoke"><Icon name="trash-2" size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="settings-foot">
                <button className="fb-editor__btn"><Icon name="plus" size={14} strokeWidth={2.2} />&nbsp;Create token</button>
              </div>
            </SettingsSection>
          )}

          {section === "danger" && (
            <div className="settings-danger">
              <div className="settings-danger__row">
                <div>
                  <div className="settings-danger__title">Sign out everywhere</div>
                  <div className="settings-danger__sub">End every active session on all devices.</div>
                </div>
                <button className="settings-btn-ghost" onClick={onLogout}>Sign out</button>
              </div>
              <div className="settings-danger__row">
                <div>
                  <div className="settings-danger__title">Delete account</div>
                  <div className="settings-danger__sub">Permanently remove your account and all servers. This cannot be undone.</div>
                </div>
                <button className="settings-btn-danger">Delete account</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export { SettingsPage };

import { Icon } from "../components/Icon.jsx";
import { SubTabs } from "../components/SubTabs.jsx";
import { ThemePicker } from "../components/ThemePicker.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { SETTINGS_TABS } from "./route.js";

// The standalone assistant's settings — the preferences that belong to this surface and this
// device, on a page of their own rather than tucked under the conversation rail.
//
// It is built from the Control Panel's own settings furniture (`SubTabs`, `SettingsSection`,
// `SettingsRow`, `ThemePicker`) so somebody who knows one screen knows this one, and so a change to
// how a settings row looks lands on both. What it does NOT borrow is the panel's page: that one is
// about a KGSM account across a cluster — access per node, sessions, connected identities — and
// none of those questions exist on a surface that talks to one leaf.
//
// Two tabs, in the order the questions get asked: how this looks, and how it gets hold of you.
//
// The tab lives in the URL (`#/settings/notifications`), so Back, Forward, refresh and a shared
// link all land on the right one; `appearance` is the default and is omitted.

const TABS = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "notifications", label: "Notifications", icon: "bell" },
];

function SettingsPage({ tab, onTabChange, onBack }) {
  const active = TABS.some((t) => t.id === tab) ? tab : SETTINGS_TABS[0];

  return (
    <div className="assistant-settings">
      {/* The way back is the only chrome this surface has: there is no sidebar to return to and no
          breadcrumb trail behind it, so the page carries its own exit. */}
      <div className="assistant-settings__bar">
        <button type="button" className="assistant-settings__back" onClick={onBack}>
          <Icon name="arrow-left" size={16} />
          <span>Back to chat</span>
        </button>
      </div>

      <div className="assistant-settings__body">
        <div className="dash-head">
          <h1>Settings</h1>
          <div className="dash-head__sub">How the assistant looks and how it reaches you.</div>
        </div>

        <SubTabs tabs={TABS} active={active} onChange={onTabChange} />

        <div className="settings-body">
          {active === "appearance" && (
            <SettingsSection icon="palette" title="Theme"
              meta="Saved on this device, never on a node. Auto follows your system.">
              <ThemePicker />
            </SettingsSection>
          )}

          {active === "notifications" && <Notifications />}
        </div>
      </div>
    </div>
  );
}

// Nothing to configure, said plainly rather than dressed as a set of switches that persist nowhere.
//
// The assistant sends no notifications: what reaches a phone with nothing open is Web Push, and a
// push subscription is signed by the key of the origin that issued it — the Control Panel's. This
// surface is a different origin, so it would need a key pair and a device store of its own before
// there is anything here to turn on. Saying which surface does carry it is the useful half of the
// answer; a row promising "coming soon" is not.
function Notifications() {
  return (
    <SettingsSection icon="bell" title="Notifications">
      <SettingsRow icon="bell-off" title="The assistant doesn’t notify you"
        sub="It answers while you’re here and sends nothing when you’re not. When that changes, this is where you’ll choose what it tells you about." />
      <div className="settings-notice">
        <Icon name="info" size={13} /> Notifications about your servers — a crash, a finished
        update — are the Control Panel’s, per device, under Settings → Notifications.
      </div>
    </SettingsSection>
  );
}

export { SettingsPage };
export default SettingsPage;

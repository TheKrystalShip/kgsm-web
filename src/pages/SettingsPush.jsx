import React from "react";
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { fmtRelative, parseTs } from "../lib/formatting.js";
import { hostsStore } from "../lib/stores.js";
import { useStore } from "../lib/store.js";
import { toast } from "../lib/toasts.js";
import { devices as fetchDevices, subscribe, support, unsubscribe } from "../lib/push.js";

// SettingsPush.jsx — "Push notifications": getting fleet events on a device with the panel closed.
//
// This is the OTHER half of the notification story and deliberately reads as such. The in-app toasts
// and the sidebar tray report what YOU did, in a browser that is open. Push is for what happened to
// the fleet while nothing was open — a crash at 3am — and so it is per-device, opt-in, and asks the
// operating system's permission.
//
// A subscription belongs to ONE host: it is signed by that host's key and stored in that host's DB.
// The cluster has no shared push identity, so this asks per node rather than pretending otherwise.
//
// ⚠ Subscribing must stay behind this button. Requesting notification permission on page load is how
// a browser learns to refuse permanently, and a denied permission cannot be re-prompted from here.

function SettingsPush() {
  const hosts = useStore(hostsStore, s => s.list);
  const [cap] = React.useState(() => support());
  const [state, setState] = React.useState({}); // hostId -> { devices, enabled, loading, busy }

  const load = React.useCallback((hostId) => {
    setState(s => ({ ...s, [hostId]: { ...(s[hostId] || {}), loading: true } }));
    fetchDevices(hostId).then(
      (res) => setState(s => ({ ...s, [hostId]: { devices: res.devices || [], enabled: !!res.enabled, loading: false } })),
      // A node that cannot answer says so in its own row; it never blanks the section.
      (err) => setState(s => ({ ...s, [hostId]: { devices: [], loading: false, error: (err && (err.userMessage || err.message)) || "unreachable" } })),
    );
  }, []);

  React.useEffect(() => {
    if (cap.state === "unsupported") return;
    hosts.forEach(h => load(h.id));
  }, [hosts, load, cap.state]);

  const enable = async (hostId, hostName) => {
    setState(s => ({ ...s, [hostId]: { ...(s[hostId] || {}), busy: true } }));
    try {
      await subscribe(hostId);
      toast.success("Push enabled on " + hostName, { detail: "This device will be notified about fleet events." });
      load(hostId);
    } catch (err) {
      toast.fromError(err, "Couldn't enable push on " + hostName);
      setState(s => ({ ...s, [hostId]: { ...(s[hostId] || {}), busy: false } }));
    }
  };

  const disable = async (hostId, hostName) => {
    setState(s => ({ ...s, [hostId]: { ...(s[hostId] || {}), busy: true } }));
    try {
      await unsubscribe(hostId);
      toast.success("Push disabled on " + hostName);
      load(hostId);
    } catch (err) {
      toast.fromError(err, "Couldn't disable push on " + hostName);
    } finally {
      setState(s => ({ ...s, [hostId]: { ...(s[hostId] || {}), busy: false } }));
    }
  };

  // The honest unsupported states, each saying what it actually is rather than a flat "not available".
  if (cap.state === "unsupported") {
    return (
      <SettingsSection icon="bell-off" title="Push notifications">
        <SettingsRow icon="bell-off" title="Not available in this browser"
          sub="This browser doesn't support push notifications." />
      </SettingsSection>
    );
  }
  if (cap.state === "needs-install") {
    return (
      <SettingsSection icon="bell" title="Push notifications">
        {/* Not a failure — the one step away. iOS delivers push only to an installed web app. */}
        <SettingsRow icon="square-arrow-out-up-right" title="Install the app first"
          sub="On iPhone and iPad, push works once you add Krystal Ship to your Home Screen — Share → Add to Home Screen — then come back here." />
      </SettingsSection>
    );
  }
  if (cap.state === "denied") {
    return (
      <SettingsSection icon="bell-off" title="Push notifications">
        <SettingsRow icon="ban" title="Blocked by your browser"
          sub="Notifications are blocked for this site. Re-allow them in your browser's site settings, then reload this page." />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection icon="bell" title="Push notifications">
      <SettingsRow icon="info" title="What this is"
        sub="Fleet events — crashes, updates, backups — delivered to this device by your browser, even with the panel closed. Separate from the in-app notifications, which only report what you do here." />

      {hosts.length === 0 && (
        <SettingsRow icon="server-off" title="No hosts connected" sub="Connect a host to set up push." />
      )}

      {hosts.map(h => {
        const st = state[h.id] || {};
        const list = st.devices || [];
        const here = list.find(d => d.current);
        const others = list.filter(d => !d.current);
        return (
          <SettingsRow
            key={h.id}
            icon={here ? "bell-ring" : "bell"}
            title={h.name || h.id}
            sub={
              st.loading ? "Checking…"
              : st.error ? st.error
              : here ? (st.enabled
                  ? "This device is subscribed." + (others.length ? ` ${others.length} other device${others.length === 1 ? "" : "s"} too.` : "")
                  // Honest: subscribed, but the admin has the channel off, so nothing will arrive.
                  : "This device is subscribed, but push is switched off for this host.")
              : (others.length
                  ? `Not on this device. ${others.length} other device${others.length === 1 ? "" : "s"} subscribed.`
                  : "Not set up on this device.")
            }
          >
            <button
              type="button"
              className="settings-btn-ghost"
              disabled={st.busy || st.loading || !!st.error}
              onClick={() => (here ? disable(h.id, h.name || h.id) : enable(h.id, h.name || h.id))}
            >
              {st.busy ? <Icon name="loader-2" size={14} className="spin" /> : null}
              {here ? "Turn off" : "Turn on"}
            </button>
          </SettingsRow>
        );
      })}

      {/* Devices other than this one, so a person can retire a phone they no longer carry. */}
      {hosts.map(h => {
        const list = (state[h.id] || {}).devices || [];
        const others = list.filter(d => !d.current);
        if (!others.length) return null;
        return others.map(d => (
          <SettingsRow
            key={h.id + ":" + d.id}
            icon="smartphone"
            title={deviceLabel(d)}
            sub={"Added " + fmtRelative(parseTs(d.createdAt))
              + (d.lastSeenAt ? " · last notified " + fmtRelative(parseTs(d.lastSeenAt)) : " · never notified yet")}
          />
        ));
      })}
    </SettingsSection>
  );
}

// A readable name from the user-agent — enough to tell a phone from a laptop. Never guessed beyond
// what the string actually says.
function deviceLabel(d) {
  const ua = d.userAgent || "";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const browser = /Firefox\//.test(ua) ? "Firefox"
    : /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  if (os && browser) return `${browser} on ${os}`;
  return os || browser || "Another device";
}

export { SettingsPush };
export default SettingsPush;

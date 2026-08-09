
import { Icon } from "../components/Icon.jsx";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { useStore } from "../lib/store.js";
import { sessionStore, TIER_LABEL } from "../lib/sessionStore.js";

// SettingsAccess — "Your access": what this person may do, on each node they are signed in to.
//
// A tier is resolved per node from that node's own account for the caller, so admin on one box and
// viewer on another is a normal state rather than a fault. Nothing else on the panel says this out
// loud: every other surface simply omits the controls you cannot use, which answers "what can I do"
// only by elimination and never answers "why not here".
//
// Read from the session records rather than re-fetching /me: the tier the panel GATES on is the one
// in those records, so showing anything else would be showing a number the app does not act on.
//
// Nothing here is editable. A tier is granted by an administrator on the node that holds the
// account, and a page about yourself is the wrong place to imply otherwise.

// A `none` tier is two different facts, and the account status is what separates them. Someone
// awaiting approval is being told to wait; someone this node has never heard of is being told it is
// not their host. Rendered apart, because they need different sentences.
function accessOf(rec) {
  const tier = (rec && rec.tier) || "none";
  const account = (rec && rec.account) || "unknown";
  if (tier !== "none") return { label: TIER_LABEL[tier] || tier, tone: "ok", note: null };
  if (account === "pending") {
    return { label: "Awaiting approval", tone: "warn",
      note: "An administrator on this node has to approve your account before you can do anything here." };
  }
  if (account === "active") {
    return { label: TIER_LABEL.none, tone: "muted",
      note: "Your account is active here but holds no role yet. An administrator grants one." };
  }
  return { label: "No account", tone: "muted",
    note: "You are signed in, but this node has no KGSM account for you." };
}

function SettingsAccess() {
  const byHost = useStore(sessionStore, (s) => s.byHost);

  // Every node this browser holds a live session on. A node in the registry that is not live has
  // no tier to report — an unreachable node's answer is unknown, not "none".
  const nodes = sessionStore.readRegistry()
    .filter((h) => h && h.id && sessionStore.isLive(h.id))
    .map((h) => ({ id: h.id, name: h.name || h.id, rec: byHost[h.id] || null }));

  if (!nodes.length) return null;

  return (
    <SettingsSection icon="shield-check" title="Your access"
      meta={nodes.length > 1
        ? "Each node grants its own role, so these can differ."
        : "What you may do on this node."}>
      {nodes.map(({ id, name, rec }) => {
        const access = accessOf(rec);
        return (
          <SettingsRow key={id} icon="server" title={name} sub={access.note || undefined}
            tone={access.tone === "warn" ? "warn" : undefined}>
            <span className={"settings-access__tier settings-access__tier--" + access.tone}>
              {access.label}
            </span>
          </SettingsRow>
        );
      })}
      <div className="settings-notice">
        <Icon name="info" size={13} /> Roles are granted by an administrator on the node that holds
        your account.
      </div>
    </SettingsSection>
  );
}

export { SettingsAccess };

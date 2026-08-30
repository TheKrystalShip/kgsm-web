import { Icon } from "../components/Icon.jsx";
import { nodeLabel } from "../lib/nodeLabel.js";
import { SettingsRow, SettingsSection } from "../components/settings-primitives.jsx";
import { useStore } from "../lib/store.js";
import { sessionStore, TIER_LABEL } from "../lib/sessionStore.js";
import { hostsStore } from "../lib/stores.js";

// SettingsAccess — "Your access": what this person may do, and any member not honouring it.
//
// One account, one tier, cluster-wide: the anchor resolves it and every member reads the same one
// from its own replica. So this is one row rather than a table, and nothing else on the panel says
// it out loud — every other surface simply omits the controls you cannot use, which answers "what
// can I do" only by elimination and never answers "why not".
//
// Read from the session record rather than by re-fetching: the tier the panel GATES on is the one in
// that record, so showing anything else would be showing a number the app does not act on.
//
// Nothing here is editable. A tier is granted by an administrator, and a page about yourself is the
// wrong place to imply otherwise.

// A `none` tier is two different facts, and the account status is what separates them. Someone
// awaiting approval is being told to wait; someone the cluster has never heard of is being told
// something else entirely. Rendered apart, because they need different sentences.
function accessOf(rec) {
  const tier = (rec && rec.tier) || "none";
  const account = (rec && rec.account) || "unknown";
  if (tier !== "none") return { label: TIER_LABEL[tier] || tier, tone: "ok", note: null };
  if (account === "pending") {
    return { label: "Awaiting approval", tone: "warn",
      note: "An administrator has to approve your account before you can do anything." };
  }
  if (account === "active") {
    return { label: TIER_LABEL.none, tone: "muted",
      note: "Your account is active but holds no role yet. An administrator grants one." };
  }
  return { label: "No account", tone: "muted",
    note: "You are signed in, but this cluster has no account for you." };
}

function SettingsAccess() {
  const session = useStore(sessionStore, (s) => s.session);
  const nodes = useStore(sessionStore, (s) => s.nodes);
  const hosts = useStore(hostsStore, (s) => s.list);
  if (!session) return null;

  const access = accessOf(session);
  // A member that verified the session and would not serve it. Its own answer, not the tier's —
  // which is why it is listed beside the tier rather than changing it.
  const refusing = Object.keys(nodes).filter((id) => nodes[id].accepts === "refusing");

  return (
    <SettingsSection icon="shield-check" title="Your access">
      <SettingsRow icon="key-round" title="Across the cluster" sub={access.note || undefined}
        tone={access.tone === "warn" ? "warn" : undefined}>
        <span className={"settings-access__tier settings-access__tier--" + access.tone}>
          {access.label}
        </span>
      </SettingsRow>

      {refusing.map((id) => (
        <SettingsRow key={id} icon="server-off" title={nodeLabel(id, hosts)} tone="warn"
          sub={nodes[id].reason === "unknown_here"
            ? "This node grants your account nothing."
            : "This node can’t verify your session yet."}>
          <span className="settings-access__tier settings-access__tier--muted">Not served</span>
        </SettingsRow>
      ))}

      <div className="settings-notice">
        <Icon name="info" size={13} /> Roles are granted by an administrator.
      </div>
    </SettingsSection>
  );
}

export { SettingsAccess };

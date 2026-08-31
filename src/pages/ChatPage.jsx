import React from "react";
import { NeedsAttention } from "../components/NeedsAttention.jsx";
import { AssistantHostPicker } from "../chat/AssistantHostPicker.jsx";
import { ChatPage as SharedChatPage } from "../chat/ChatPage.jsx";
import { usableTargets } from "../lib/assistants.js";
import { canOperate, isAdmin } from "../lib/persona.js";
import { useStore } from "../lib/store.js";
import { auditEventHost, fetchAssistantTranscript, hostsStore, serversStore } from "../lib/stores.js";

// The Control Panel's chat: the shared conversation surface (`src/chat/`) wired to a CLUSTER.
//
// Everything here is the difference between this surface and the standalone assistant — several
// assistants and a picker to choose between them, a server roster, an admin review
// mode, and node attribution on evidence rows. The conversation itself is the same code in both,
// which is the point: a divergence between the dock and the standalone SPA would be a bug, not a
// variant, so there is nowhere for one to drift from the other.

function ChatPage(props) {
  const { assistantHost, assistantHosts = [] } = props;
  const servers = useStore(serversStore, (s) => s.list);
  const hosts = useStore(hostsStore, (s) => s.list);

  // The header badge and the usable gate, folded from the target's own state. `message` is the
  // reason it carries — a node's capability says why a leaf is down, a member's standing says why
  // the cluster's assistant is — so each explains itself rather than being described here.
  const connection = !assistantHost
    ? { tone: "muted", label: assistantHosts.length ? "No assistant chosen" : "No assistant", usable: false, message: null }
    : {
        tone: assistantHost.state === "operational" ? "online" : assistantHost.state === "degraded" ? "warn" : "danger",
        label: (assistantHost.state === "operational" ? "Connected · "
          : assistantHost.state === "degraded" ? "Degraded · " : "Unavailable · ") + assistantHost.name,
        usable: !!usableTargets([assistantHost]).length,
        message: assistantHost.message || null,
      };

  // One session, one tier, and every member reads the same one — so this is the account's role and
  // there is no member to resolve it against.
  const canSeeActions = !!(assistantHost && canOperate());
  const canUseActions = !!(assistantHost && isAdmin());

  // Evidence rows name the node an event belongs to, which needs the roster and the store-aware
  // derivation (an event with only a serverId resolves through the server roster).
  const nodes = React.useMemo(
    () => ({ hosts, resolveHost: auditEventHost, showHost: true }),
    [hosts]);

  return (
    <SharedChatPage
      {...props}
      connection={connection}
      canSeeActions={canSeeActions}
      canUseActions={canUseActions}
      servers={servers}
      loadTranscript={fetchAssistantTranscript}
      BriefingPanel={NeedsAttention}
      HostPicker={AssistantHostPicker}
      nodes={nodes}
      // No `onOpenSettings`: the panel's own Settings page is a sidebar click away, and a cog inside
      // the dock would offer the chat's settings on a surface where they are the shell's.
    />
  );
}

// Re-exported so the app and the smoke keep one import path for the chat's pure helpers; they live
// in the shared surface now, but nothing outside needs to know where.
export {
  adaptResultCard, LEAF_COMMAND_VERBS, ChatCommand, ChatPage, composeVerified, latestUsage,
  mergeServerConversations, reduceTurnFrame, scaffoldHistory,
} from "../chat/ChatPage.jsx";
export { ChatPage as default };

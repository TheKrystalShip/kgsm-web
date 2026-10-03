import React from "react";
import { Chat, ChatCommand as BaseChatCommand, useStore } from "@thekrystalship/krystal-ui";
import { assistant } from "../lib/assistantClient.js";
import { assistantSession } from "../lib/assistantSession.js";
import { ChatBlueprintDraft } from "./ChatBlueprintDraft.jsx";
import { ChatEvidence } from "./EvidenceCards.jsx";
import { LEAF_COMMAND_VERBS } from "./chatConstants.js";
import {
  TOGGLE_COPY, kgsmChatProfile, adaptResultCard, adaptBlueprintConfirm, composeVerified,
  latestUsage, mergeServerConversations, reduceTurnFrame, scaffoldHistory,
} from "./chatUtils.jsx";

// ChatPage is the design system's Chat talking to a kgsm assistant, shared by the Control Panel's
// dock and the standalone assistant. Everything that differs between those two surfaces is a prop,
// with defaults describing the smaller one; everything that is the panel's rather than the chat's —
// the evidence cards a kgsm tool's result becomes, the blueprint review card, the lifecycle verbs and
// their verdicts, the opening suggestions — is passed to Chat from here.
//
// `assistantHost` is the identity of the assistant being addressed — `{ id, name }` — because the
// session layer and the client are both keyed by it. The standalone surface names its own.

// The conversation list this browser keeps, under the key it has always had.
const STORAGE_KEY = "krystal:chat:conversations";

const AUTORUN_HINT = {
  on: "Auto-run ON — the assistant carries out start/stop/restart actions immediately, no confirmation. Click to turn off.",
  off: "Auto-run OFF — the assistant proposes actions for you to confirm. Turn on to let it run them automatically.",
  locked: "Needs assistant:autorun",
};

const clientFor = (id) => assistant.host(id);

function ChatPage({
  onOpenServer, onOpenView, assistantHost, canSeeActions = false,
  // The server roster, for the opening suggestions and for naming a command's target. Empty is a
  // fine answer — the suggestions fall back to generic ones and a target is named by its id.
  servers = [],
  // What an evidence card needs to name a node (EvidenceCards' `nodes`).
  nodes,
  ...rest
}) {
  // The assistant accepts the session this surface already holds, whichever standing it has, so there
  // is nothing to sign in to here. A session that is not live is the surface's own gate's business.
  const sessionStatus = useStore(assistantSession, s => s.status);
  const authed = !!assistantHost && sessionStatus === "live" && assistantSession.hasRoute(assistantHost.id);

  const profile = React.useMemo(() => kgsmChatProfile(servers), [servers]);

  // The OPEN blueprint draft's live content, so a chat turn can carry it to the assistant (which lets it
  // revise the draft via revise_blueprint). draftEditsRef maps a draft's cmdId → its current editor text
  // (manual edits included); activeDraftRef is the cmdId of the draft currently being reviewed.
  const draftEditsRef  = React.useRef({});
  const activeDraftRef = React.useRef(null);
  const onDraftEdit   = React.useCallback((cmdId, text) => { if (cmdId) draftEditsRef.current[cmdId] = text; }, []);
  const onDraftActive = React.useCallback((cmdId, active) => {
    if (active) activeDraftRef.current = cmdId;
    else if (activeDraftRef.current === cmdId) activeDraftRef.current = null;
  }, []);
  const turnExtras = React.useCallback(() => {
    const openCmdId = activeDraftRef.current;
    return { draftYaml: openCmdId ? draftEditsRef.current[openCmdId] : undefined };
  }, []);

  // Save = finalize: send the (possibly edited) YAML to the assistant, which re-validates,
  // test-installs, boots + verifies, and runs its repair loop before answering (minutes). The
  // card sits in a "verifying" state meanwhile. On a verified win it flips to the catalog outcome;
  // on repair exhaustion / an invalid edit it comes back editable with a fresh token + boot log
  // (the re-edit loop); anything else is an honest failure. Never fabricates success from the 202.
  const saveBlueprint = (api, msg, editedYaml) => {
    // Patch bpState (+ any outcome fields) onto the one blueprint command message being reviewed.
    const patch = (fields) =>
      api.setMessages(msgs => msgs.map(m =>
        (m.role === "command" && m.verb === "blueprint" && m.cmdId === msg.cmdId) ? { ...m, ...fields } : m));
    const client = api.client();
    if (!client || !msg.token) {
      patch({ bpState: "failed", bpReason: "This draft has expired — ask the assistant to draft it again." });
      return;
    }
    patch({ bpState: "verifying", bpProgress: null });
    // The finalize streams its own steps (research/install/verify/repair) — surface the latest as a live
    // sub-label under the "verifying" spinner so the user sees it advancing, not a dead wait. Cleared on
    // every terminal branch below.
    const onProgress = (evt) => patch({ bpProgress: evt && evt.label ? evt.label : null });
    client.confirm({ token: msg.token, editedContent: editedYaml }, { onProgress }).then(
      resp => {
        const r = adaptBlueprintConfirm(resp);
        if (r.state === "verified") {
          patch({ bpState: "verified", bpSlug: r.slug, bpDisplayName: r.displayName, bpProof: r.proof, bpProgress: null });
        } else if (r.state === "proposed") {
          // Re-edit loop: adopt the returned draft + fresh token + boot evidence, back to editable.
          patch({ bpState: "proposed", token: r.token, draftYaml: r.draftYaml, evidence: r.evidence, bpDisplayName: r.displayName, bpProgress: null });
        } else {
          patch({ bpState: "failed", bpDisplayName: r.displayName, bpReason: r.reason, bpProgress: null });
        }
      },
      err => {
        const expired = err && err.code === 401;
        patch({
          bpState: "failed",
          bpProgress: null,
          bpReason: expired
            ? ((assistantHost && assistantHost.name) || "This host") + "’s session expired — re-authorize this host to continue."
            : (err && err.userMessage) || "The test-install couldn’t run — try saving again.",
        });
      });
  };

  // Abandon is the only terminal Failed a user can reach directly — always offered so a draft can't
  // get stuck in an un-closable loop. Client-side only: the token simply expires unused server-side.
  const giveUpBlueprint = (api, msg) =>
    api.setMessages(msgs => msgs.map(m =>
      (m.role === "command" && m.verb === "blueprint" && m.cmdId === msg.cmdId)
        ? { ...m, bpState: "failed", bpReason: "You dismissed this draft — nothing was added." } : m));

  // The transcript roles that are the panel's: a standalone evidence entry, and the blueprint review
  // card. A transcript under review offers neither the card's Save nor any evidence action.
  const renderEntry = (m, i, api) => {
    if (m.role === "evidence") {
      return <ChatEvidence key={i} cards={m.cards} onOpenServer={onOpenServer} onOpenView={onOpenView}
        onRun={api.run || undefined} nodes={nodes} />;
    }
    if (m.role === "command" && m.verb === "blueprint") {
      return <ChatBlueprintDraft key={i} msg={m}
        onSave={api.readOnly ? undefined : (msg, yaml) => saveBlueprint(api, msg, yaml)}
        onGiveUp={api.readOnly ? undefined : (msg) => giveUpBlueprint(api, msg)}
        onRun={api.run || undefined}
        onDraftEdit={api.readOnly ? undefined : onDraftEdit}
        onDraftActive={api.readOnly ? undefined : onDraftActive} />;
    }
    return undefined;
  };

  const renderCards = (m, api) => (
    <ChatEvidence cards={m.cards} onOpenServer={onOpenServer} onOpenView={onOpenView}
      onRun={api.run || undefined} nodes={nodes} />
  );

  const suggestions = React.useMemo(() => {
    const running = servers.find(s => s.status === "running");
    const srv = running || servers[0] || null;
    if (!srv) {
      return [
        "Run a health check on my server",
        "Why might my server be lagging?",
        "Explain a setting in my server's config file",
        "Server is online but I can't connect — why?",
      ];
    }
    const name = srv.displayName || srv.name || "MyServer";
    const game = srv.game || "my game";
    return [
      `Run a health check on ${name}`,
      `Why might my ${game} server be lagging?`,
      "Explain a setting in my server's config file",
      `Server is online but I can't connect — why?`,
    ];
  }, [servers]);

  // What the assistant can do for you, phrased to match what THIS caller may actually
  // ask of it: somebody who may not run servers can't have it act, so promising start/stop would be a promise
  // the composer's own gating then breaks.
  const primer = canSeeActions
    ? "I can check server health, dig through logs and configuration, start or stop a server, and help work out what’s going wrong."
    : "I can check server health, read through logs and configuration, and help work out what’s going wrong.";

  return (
    <Chat
      {...rest}
      assistantHost={assistantHost}
      canSeeActions={canSeeActions}
      clientFor={clientFor}
      authed={authed}
      storageKey={STORAGE_KEY}
      assistantName="Krystal assistant"
      profile={profile}
      toggleCopy={TOGGLE_COPY}
      suggestions={suggestions}
      primer={primer}
      noAssistant="No connected host is serving an assistant capability."
      autorunHint={AUTORUN_HINT}
      renderEntry={renderEntry}
      renderCards={renderCards}
      turnExtras={turnExtras}
    />
  );
}

// A proposed action as the panel draws it: kgsm's name for the verb, its target, and whether the panel
// can redeem it. The card the chat renders is this, with the target named from the live roster.
const PANEL_PROFILE = kgsmChatProfile([]);
function ChatCommand({ msg, onRun }) {
  const p = PANEL_PROFILE.proposal(msg);
  return <BaseChatCommand msg={msg} onRun={onRun} meta={p.meta} target={p.target}
    runnable={p.runnable} unavailable={p.unavailable} />;
}

export {
  adaptResultCard, LEAF_COMMAND_VERBS, ChatCommand, ChatPage, composeVerified, latestUsage, mergeServerConversations,
  reduceTurnFrame, scaffoldHistory,
};
// Default export so React.lazy(() => import("./ChatPage.jsx")) resolves.
export default ChatPage;

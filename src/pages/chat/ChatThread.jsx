// ChatThread — renders a conversation's message list, dispatching each entry to
// the right message-part component by role. Extracted from ChatPage.jsx (#8): a
// pure render switch, so ChatPage's body no longer imports the nine message-part
// components. Hook-less → no React import (automatic JSX runtime).

import { ChatEvidence } from "./EvidenceCards.jsx";
import {
  ChatContextPill, ChatCommand, ChatScopeNotice,
  ChatCheckpointNotice, ChatToggleNotice, ChatVerify, ChatSystemNotice,
} from "./ChatMessageParts.jsx";
import { ChatMessage } from "./ChatMessage.jsx";

function ChatThread({ messages, user, onOpenServer, onOpenView, onRun }) {
  return (
    <div className="chat-thread">
      {messages.map((m, i) =>
        m.role === "context"
          ? <ChatContextPill key={i} msg={m} />
          : m.role === "system"
            ? <ChatSystemNotice key={i} msg={m} />
          : m.role === "scope"
            ? <ChatScopeNotice key={i} msg={m} />
          : m.role === "checkpoint"
            ? <ChatCheckpointNotice key={i} msg={m} />
          : m.role === "toggle"
            ? <ChatToggleNotice key={i} msg={m} />
            : m.role === "evidence"
              ? <ChatEvidence key={i} cards={m.cards} onOpenServer={onOpenServer} onOpenView={onOpenView} />
              : m.role === "command"
                ? <ChatCommand key={i} msg={m} onRun={onRun} />
                : m.role === "verify"
                  ? <ChatVerify key={i} msg={m} />
                  : <ChatMessage key={i} msg={m} user={user} onOpenServer={onOpenServer} onOpenView={onOpenView} />
      )}
    </div>
  );
}

export { ChatThread };

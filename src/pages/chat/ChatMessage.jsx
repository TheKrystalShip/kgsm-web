// ChatMessage — the message bubble dispatcher. Renders user bubbles,
// assistant bubbles (with thinking, tools, evidence cards), and typing indicators.

import { Icon } from "../../components/Icon.jsx";
import { AccountAvatar } from "../../components/Sidebar.jsx";
import { VoiceNoteBubble } from "../../components/VoiceNote.jsx";
import { renderMarkdown } from "./chatUtils.jsx";
import { ChatThinking, ChatContextPill, ChatPending } from "./ChatMessageParts.jsx";
import { ChatEvidence } from "./EvidenceCards.jsx";

function ChatMessage({ msg, user, onOpenServer, onOpenView }) {
  const isUser = msg.role === "user";
  return (
    <div className={"chat-msg" + (isUser ? " chat-msg--user" : " chat-msg--assistant")}>
      <div className="chat-msg__avatar">
        {isUser
          ? <AccountAvatar user={user} size={28} />
          : <span className="chat-msg__bot"><Icon name="bot" size={16} /></span>}
      </div>
      <div className="chat-msg__body">
        <div className="chat-msg__name">
          {isUser ? (user.display || user.name) : "Krystal assistant"}
          {msg.voice && <span className="chat-msg__voicetag"><Icon name="mic" size={11} strokeWidth={2.2} /> Voice note</span>}
        </div>
        {msg.voice && <VoiceNoteBubble voice={msg.voice} />}
        {!isUser && msg.thinking && <ChatThinking text={msg.thinking} streaming={!msg.content} />}
        {!isUser && msg.tools && msg.tools.map((t, i) => <ChatContextPill key={(t.id || "t") + ":" + i} msg={t} />)}
        <div className="chat-msg__content">
          {msg.content
            ? renderMarkdown(msg.content)
            : (msg.thinking || (msg.tools && msg.tools.length))
              ? null
              : <ChatPending />}
        </div>
        {!isUser && msg.cards && msg.cards.length > 0 && (
          <ChatEvidence cards={msg.cards} onOpenServer={onOpenServer} onOpenView={onOpenView} />
        )}
      </div>
    </div>
  );
}

export { ChatMessage };

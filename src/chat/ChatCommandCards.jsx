// The cards `/help` and `/tools` leave in the transcript. Both render the LEAF's own answer — the
// commands it says this person can type, and the tools it says it can use for them — so nothing here
// is a list maintained in the browser that could drift from what the assistant actually offers.
//
// They stay in the conversation rather than opening a panel because looking something up is part of
// what happened: scrolling back to what you were told is the point.

import { Icon } from "../components/Icon.jsx";

import { usageOf } from "./chatCommands.js";

// Split the same way the leaf's own manifest splits for the Control Panel: what reads and what
// changes something. It is the question someone opens a command list with.
function ChatCommandHelp({ msg }) {
  const commands = msg.commands || [];
  const reads = commands.filter(c => !c.mutates);
  const acts = commands.filter(c => c.mutates);

  return (
    <div className="chat-cmdcard">
      <div className="chat-cmdcard__head">
        <Icon name="terminal" size={13} strokeWidth={2.2} />
        <span>{msg.label || "What you can type here"}</span>
      </div>
      {[["Reference", reads], ["Changes something", acts]].map(([title, group]) => group.length > 0 && (
        <div key={title} className="chat-cmdcard__group">
          <div className="chat-cmdcard__grouphead">{title}</div>
          {group.map(c => (
            <div key={c.name} className="chat-cmdcard__row">
              <code className="chat-cmdcard__name">{usageOf(c)}</code>
              <span className="chat-cmdcard__desc">{c.description}</span>
            </div>
          ))}
        </div>
      ))}
      {commands.length === 0 && (
        <div className="chat-cmdcard__row"><span className="chat-cmdcard__desc">No commands here.</span></div>
      )}
    </div>
  );
}

// Tool descriptions are written for the model and run several sentences; the card shows the first
// one. Truncating by sentence rather than by width keeps a line from stopping mid-word.
function firstSentence(text) {
  if (!text) return "";
  const stop = text.indexOf(". ");
  return stop < 0 ? text : text.slice(0, stop + 1);
}

function ChatCommandTools({ msg }) {
  const tools = msg.tools || [];
  return (
    <div className="chat-cmdcard">
      <div className="chat-cmdcard__head">
        <Icon name="wrench" size={13} strokeWidth={2.2} />
        <span>{msg.label || "What I can do for you"}</span>
      </div>
      {tools.map(t => (
        <div key={t.name} className="chat-cmdcard__row">
          <code className="chat-cmdcard__name">{t.name}</code>
          <span className="chat-cmdcard__desc">{firstSentence(t.description)}</span>
        </div>
      ))}
      {tools.length === 0 && (
        <div className="chat-cmdcard__row"><span className="chat-cmdcard__desc">No tools available.</span></div>
      )}
    </div>
  );
}

export { ChatCommandHelp, ChatCommandTools };

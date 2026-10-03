// ComponentCommands — the commands a component answers to, as the component itself declares them.
// The list comes from the manifest its deploy ships, passed through by whoever served it, so it is
// the command set the running build registers rather than a list written here that would rot the
// moment one was renamed. Nothing on this page is typed here: everything an operator reads —
// the name, what it does, its options, and the action it needs — is the component's own word.
//
// Grouped by the action each command needs, because that is the question someone opens the list
// with: what does it take to run these. The action is what the component checks when a command is
// run; this panel cannot verify that check, so it prints the action and whether the reader holds it,
// and softens nothing.

import { BriefCard, Icon } from "@thekrystalship/krystal-ui";
import { may } from "../../lib/persona.js";

// Where a person types these. The subject differs per surface — the bot is spoken to in Discord, the
// assistant in its chat box — so each is stated whole rather than assembled from the component id.
const SURFACE_WHERE = {
  discord: "Typed at the bot in Discord.",
  chat: "Typed at the assistant in chat.",
};

// What a person types. Required options are angle-bracketed and optional ones square-bracketed — the
// convention every command-line help in the world uses, and the manifest carries which is which.
function usage(cmd) {
  const options = (cmd.options || [])
    .map((o) => {
      // An option offering a fixed set shows the set, because that IS what to type. One taking free
      // text shows its name — the surface suggests values as you go, and the manifest cannot say what
      // they will be.
      const inner = o.values && o.values.length ? o.values.join("|") : o.name;
      return o.required ? "<" + inner + ">" : "[" + inner + "]";
    })
    .join(" ");
  return "/" + cmd.name + (options ? " " + options : "");
}

// The commands under each action, in the order the manifest lists them. A group that only reads comes
// before one that acts, so the list opens on what is safe to try; within that, by action id.
function byAction(commands) {
  const groups = new Map();
  for (const cmd of commands || []) {
    if (!cmd || !cmd.action) continue;
    if (!groups.has(cmd.action)) groups.set(cmd.action, []);
    groups.get(cmd.action).push(cmd);
  }
  return [...groups.entries()]
    .map(([action, list]) => ({ action, list, acts: list.some(c => c.mutates) }))
    .sort((a, b) => Number(a.acts) - Number(b.acts) || a.action.localeCompare(b.action));
}

function CommandRow({ cmd }) {
  return (
    <div className="leaf-cmd">
      <div className="leaf-cmd__head">
        <code className="leaf-cmd__usage">{usage(cmd)}</code>
        {cmd.mutates && (
          <span className="leaf-cmd__tag" title="This command changes something">
            <Icon name="triangle-alert" size={10} strokeWidth={2.2} /> acts
          </span>
        )}
      </div>
      {cmd.description && <div className="leaf-cmd__desc">{cmd.description}</div>}
      {(cmd.options || []).length > 0 && (
        <div className="leaf-cmd__opts">
          {cmd.options.map(o => (
            <div key={o.name} className="leaf-cmd__opt">
              <code className="leaf-cmd__optname">{o.name}</code>
              {o.description && <span className="leaf-cmd__optdesc">{o.description}</span>}
              <span className="leaf-cmd__optmeta">
                {o.required ? "required" : "optional"}
                {o.type ? " · " + o.type : ""}
                {o.autocomplete ? " · suggests values" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Whether the reader holds the action anywhere they reach. A command acting on one server is checked at
// that server when it runs, so "held" here says the reader can run it somewhere, not on every server.
function HeldChip({ action }) {
  return may(action)
    ? <span className="cluster-chip cluster-chip--ok" title="You hold this action on at least one target">held</span>
    : <span className="cluster-chip cluster-chip--muted" title="You hold this action nowhere you can reach">not held</span>;
}

// The manifest arrives from the page rather than being fetched here: the same read decides whether
// this tab exists at all, so there is no state in which it is open without one, and no way for the
// tab and its contents to disagree about what the component takes.
function ComponentCommands({ commands: manifest }) {
  const surface = (manifest && manifest.surface) || null;
  const where = (surface && SURFACE_WHERE[surface]) || null;
  const groups = byAction(manifest && manifest.commands);

  return (
    <div className="leaf-cmds">
      {groups.map(({ action, list, acts }) => {
        // Within a group, what reads comes before what acts.
        const rows = [...list].sort((a, b) => Number(!!a.mutates) - Number(!!b.mutates));
        return (
          <BriefCard key={action} icon={acts ? "zap" : "search"}
            title={action} count={list.length} countTone="neutral"
            meta={where} action={<HeldChip action={action} />}>
            <div className="leaf-cmd__list">{rows.map(c => <CommandRow key={c.name} cmd={c} />)}</div>
          </BriefCard>
        );
      })}
      {groups.length === 0 && (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Nothing registered</div>
          <div className="chat-brief__empty-sub">The component ships a command list and it is empty.</div>
        </div>
      )}
    </div>
  );
}

export { ComponentCommands };
export default ComponentCommands;

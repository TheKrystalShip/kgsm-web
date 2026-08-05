// LeafCommands — the commands a leaf answers to, as the leaf itself declares them. The list comes
// from the manifest the leaf's deploy ships (kgsm-api reads the file and passes it through), so it is
// the command set the running build registers rather than a list written here that would rot the
// moment one was renamed. Nothing on this page is typed here: everything an operator reads —
// the name, what it does, its options, and whether it acts — is the leaf's own word.
//
// Split into what READS and what ACTS, because that is the question someone opens the list with. The
// acting half carries what the leaf checks before running one, which is a fact about the leaf and not
// about this panel: it is stated, never softened.

import { BriefCard } from "../../components/BriefCard.jsx";
import { Icon } from "../../components/Icon.jsx";

const SURFACE_LABEL = { discord: "Discord" };

// What a person types. Required options are angle-bracketed and optional ones square-bracketed — the
// convention every command-line help in the world uses, and the manifest carries which is which.
function usage(cmd) {
  const options = (cmd.options || [])
    .map(o => (o.required ? "<" + o.name + ">" : "[" + o.name + "]"))
    .join(" ");
  return "/" + cmd.name + (options ? " " + options : "");
}

// What the leaf requires of whoever runs a command that acts. `none` is not "unknown" — it is the
// leaf stating that it checks nothing, which is worth saying plainly rather than leaving blank.
function gateNote(gate, surface) {
  if (gate === "actionRole") return "Only members holding the bot’s action role can run these.";
  if (gate === "none") {
    return surface === "discord"
      ? "The bot checks no role before running these — anyone Discord lets use the command can. "
        + "Restrict them per-command in the server’s Integrations settings if that is not what you want."
      : "The leaf checks nothing before running these.";
  }
  return null;
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

// The manifest arrives from the page rather than being fetched here: the same read decides whether
// this tab exists at all, so there is no state in which it is open without one, and no way for the
// tab and its contents to disagree about what the leaf takes.
function LeafCommands({ commands: manifest }) {
  const commands = (manifest && manifest.commands) || [];
  const reads = commands.filter(c => !c.mutates);
  const acts = commands.filter(c => c.mutates);
  const surface = (manifest && manifest.surface) || null;
  const surfaceLabel = (surface && SURFACE_LABEL[surface]) || surface;
  const note = manifest ? gateNote(manifest.gate, surface) : null;

  return (
    <div className="leaf-cmds">
      {reads.length > 0 && (
        <BriefCard icon="search" title="Read-only" count={reads.length} countTone="neutral"
          meta={surfaceLabel ? "Typed at the bot in " + surfaceLabel + ". These change nothing." : "These change nothing."}>
          <div className="leaf-cmd__list">{reads.map(c => <CommandRow key={c.name} cmd={c} />)}</div>
        </BriefCard>
      )}
      {acts.length > 0 && (
        <BriefCard icon="zap" title="Control" count={acts.length} countTone="neutral" meta={note}>
          <div className="leaf-cmd__list">{acts.map(c => <CommandRow key={c.name} cmd={c} />)}</div>
        </BriefCard>
      )}
      {commands.length === 0 && (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Nothing registered</div>
          <div className="chat-brief__empty-sub">The leaf ships a command list and it is empty.</div>
        </div>
      )}
    </div>
  );
}

export { LeafCommands };

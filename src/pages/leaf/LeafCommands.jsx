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

// Where a person types these. The subject differs per surface — the bot is spoken to in Discord, the
// assistant in its chat box — so each is stated whole rather than assembled from the leaf id.
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

// What the leaf requires of whoever runs the commands in a gate bucket. `none` is not "unknown" — it
// is the leaf stating that it checks nothing, which is worth saying plainly rather than leaving
// blank. Every other value is a tier from the ecosystem's shared role map, printed as the leaf's own
// claim: this panel cannot verify a check it does not implement, so it states it and softens nothing.
function gateNote(gate, surface) {
  if (gate === "none") {
    return surface === "discord"
      ? "The bot states the gate none — it checks no role before running these, so anyone Discord lets "
        + "use the command can. Restrict them per-command in the server’s Integrations settings if that "
        + "is not what you want."
      : "The leaf states the gate none — it checks nothing before running these.";
  }
  if (gate === "viewer") return "Anyone with a KGSM account on this host can run these.";
  if (gate === "operator") return "Only an operator or an admin can run these.";
  if (gate === "admin") return "Only an admin can run these.";
  return null;
}

// The gates in the order an operator wants to read them: what anyone can do, down to what almost
// nobody can. A bucket the manifest does not carry simply does not appear.
const GATE_ORDER = ["none", "viewer", "operator", "admin"];

// The heading for a bucket: the tier itself, spelled the way the Users admin spells it, so the
// bucket a command sits in and the tier somebody holds are visibly the same word. A tier this build
// does not know keeps the leaf's own word as its heading, because printing an unfamiliar tier is
// better than hiding the commands under it.
const GATE_TITLE = {
  none: "Unrestricted",
  viewer: "Viewer",
  operator: "Operator",
  admin: "Admin",
};

function orderedGates(gates) {
  return Object.keys(gates || {}).sort((a, b) => {
    const ai = GATE_ORDER.indexOf(a), bi = GATE_ORDER.indexOf(b);
    // A tier this build does not know sorts last rather than being dropped — the leaf said it, and
    // hiding a command because its gate is unfamiliar would be worse than printing the word.
    return (ai < 0 ? GATE_ORDER.length : ai) - (bi < 0 ? GATE_ORDER.length : bi) || a.localeCompare(b);
  });
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
  const gates = (manifest && manifest.gates) || {};
  const surface = (manifest && manifest.surface) || null;
  const where = (surface && SURFACE_WHERE[surface]) || null;
  const total = Object.values(gates).reduce((n, list) => n + (list || []).length, 0);

  return (
    <div className="leaf-cmds">
      {orderedGates(gates).map((gate) => {
        const list = gates[gate] || [];
        if (list.length === 0) return null;

        // Within a bucket, what reads comes before what acts — the same question an operator opens
        // the list with, now asked inside each level of access rather than across the whole leaf.
        const rows = [...list].sort((a, b) => Number(!!a.mutates) - Number(!!b.mutates));
        const acts = list.some(c => c.mutates);
        const meta = [where, gateNote(gate, surface)].filter(Boolean).join(" ");

        return (
          <BriefCard key={gate} icon={acts ? "zap" : "search"}
            title={GATE_TITLE[gate] || gate}
            count={list.length} countTone="neutral" meta={meta || null}>
            <div className="leaf-cmd__list">{rows.map(c => <CommandRow key={c.name} cmd={c} />)}</div>
          </BriefCard>
        );
      })}
      {total === 0 && (
        <div className="chat-brief__empty chat-brief__empty--neutral">
          <div className="chat-brief__empty-title">Nothing registered</div>
          <div className="chat-brief__empty-sub">The leaf ships a command list and it is empty.</div>
        </div>
      )}
    </div>
  );
}

export { LeafCommands };

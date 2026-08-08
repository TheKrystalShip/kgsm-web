// chatCommands — the typed-command surface of the composer, without any React in it.
//
// The catalog is the LEAF's, fetched from its own origin (`GET /commands`) and already filtered to
// what this caller may run — so nothing here decides who can type what, and the composer never
// offers a command the leaf would refuse. The leaf also RUNS every command it lists, so a name in
// the catalog is a name `POST /commands/{name}` honours; this module only parses what was typed and
// works out what to show.
//
// A slash opens the list only as the FIRST character of the composer. A path, a fraction or a date
// mid-message never triggers it, and a leading slash that matches no command is an ordinary message
// that goes to the model — nothing a person types is swallowed.

// What a person typed, split into the command word and its argument. Null when the text is not a
// command line at all, which is the common case and the one that must stay cheap.
function parseCommandLine(text) {
  if (typeof text !== "string" || text.length < 1 || text[0] !== "/") return null;

  const body = text.slice(1);
  // A newline means they have moved on to writing a message; the slash was never a command.
  if (/[\n\r]/.test(body)) return null;

  const space = body.indexOf(" ");
  if (space < 0) return { verb: body, argument: null, complete: false };

  const argument = body.slice(space + 1).trim();
  return { verb: body.slice(0, space), argument: argument || null, complete: true };
}

// The fixed values an option offers, or null when it takes free text. The API emits `values: null`
// for a free-text option rather than omitting the key, so both spellings mean the same thing.
function valuesOf(command) {
  const option = (command && command.options || []).find(o => o.values && o.values.length);
  return option ? option.values : null;
}

// How a command is typed, values included: `/think [on|off]`. Required options are angle-bracketed
// and optional ones square-bracketed — the convention every command-line help uses.
function usageOf(command) {
  const parts = (command.options || []).map((o) => {
    const inner = o.values && o.values.length ? o.values.join("|") : o.name;
    return o.required ? "<" + inner + ">" : "[" + inner + "]";
  });
  return "/" + command.name + (parts.length ? " " + parts.join(" ") : "");
}

// The rows the popover shows for what has been typed so far. Two stages, and which one applies is
// decided by the text rather than by held state, so a backspace walks back out of the value stage
// with nothing to reset:
//
//   "/th"       → the commands whose name starts with "th"
//   "/think "   → that command's values, as runnable entries (`/think on`, `/think off`)
//   "/think o"  → those values narrowed
//
// Empty means no match, and the composer closes rather than showing an empty box: a slash that
// matches nothing is a message, and a popover hanging over it would say otherwise.
function suggestFor(text, catalog) {
  const parsed = parseCommandLine(text);
  if (!parsed || !Array.isArray(catalog) || catalog.length === 0) return [];

  const verb = parsed.verb.toLowerCase();

  if (!parsed.complete) {
    return catalog
      .filter(c => c.name.toLowerCase().startsWith(verb))
      .map(c => ({
        key: c.name,
        command: c,
        insert: "/" + c.name + (valuesOf(c) ? " " : ""),
        // A command taking a value is not runnable until it has one offered; accepting it opens the
        // value stage instead of sending, which is what makes Tab and Enter feel the same here.
        runnable: !valuesOf(c),
        label: usageOf(c),
        detail: c.description,
      }));
  }

  const command = catalog.find(c => c.name.toLowerCase() === verb);
  const values = command ? valuesOf(command) : null;
  if (!command || !values) return [];

  const typed = (parsed.argument || "").toLowerCase();
  return values
    .filter(v => v.toLowerCase().startsWith(typed))
    .map(v => ({
      key: command.name + ":" + v,
      command,
      value: v,
      insert: "/" + command.name + " " + v,
      runnable: true,
      label: "/" + command.name + " " + v,
      detail: command.description,
    }));
}

// The command a line names, or null. This is what decides whether Enter runs a command or sends a
// message, and it is deliberately stricter than the suggestion list: a prefix that merely NARROWS
// the list ("/th") is not a command, only an exact name is.
function resolveCommand(text, catalog) {
  const parsed = parseCommandLine(text);
  if (!parsed || !Array.isArray(catalog)) return null;

  const command = catalog.find(c => c.name.toLowerCase() === parsed.verb.toLowerCase());
  if (!command) return null;

  // An argument the command's own value list does not offer is not a command line — it goes to the
  // model as text, the same as any other unrecognised slash. Refusing it here would turn a typo
  // into an error message about a surface the person may not even know they were using.
  const values = valuesOf(command);
  if (parsed.argument && values && !values.some(v => v.toLowerCase() === parsed.argument.toLowerCase())) {
    return null;
  }
  if (parsed.argument && !values) return null;

  return { command, argument: parsed.argument };
}

export { parseCommandLine, resolveCommand, suggestFor, usageOf, valuesOf };

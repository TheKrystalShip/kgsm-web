// chat constants — what each lifecycle verb a kgsm assistant proposes is called, and which of them
// the panel can redeem.

// The verbs a proposed command's Run button performs, by handing the token back to the leaf that
// staged it. It is the leaf's ConfirmationKind set minus `blueprint`, which the review card owns
// its own Save for. Nothing here is executed anywhere else — a verb missing from this set renders
// as a proposal with no Run, which is how `update` and `backup` used to read despite the leaf
// having always been able to perform them.
const LEAF_COMMAND_VERBS = new Set([
  "start", "stop", "restart", "update", "backup",
  "install", "uninstall", "set_config", "write_file",
]);
const COMMAND_META = {
  start:      { label: "Start",         icon: "play",      tone: "success" },
  stop:       { label: "Stop",          icon: "square",    tone: "danger" },
  restart:    { label: "Restart",       icon: "rotate-cw", tone: "update" },
  update:     { label: "Update",        icon: "download",  tone: "info" },
  install:    { label: "Install",       icon: "download",  tone: "success" },
  uninstall:  { label: "Uninstall",     icon: "trash-2",   tone: "danger" },
  backup:     { label: "Back up",       icon: "database",  tone: "info" },
  set_config: { label: "Update config", icon: "settings",  tone: "info" },
  write_file: { label: "Update config file", icon: "file-pen", tone: "info" },
};
function commandMeta(verb) {
  return COMMAND_META[verb] || { label: (verb || "Run").replace(/_/g, " "), icon: "zap", tone: "info" };
}

// What a conversation is called, and the name of one nothing has been said in, are the design
// system's chat's — re-exported for the panel's pages that list conversations.
export { NEW_CHAT_TITLE, conversationTitle } from "@thekrystalship/krystal-ui";

export { LEAF_COMMAND_VERBS, COMMAND_META, commandMeta };

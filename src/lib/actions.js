// actions.js — every action the panel gates a control on, in one table.
//
// An action is `<component>:<id>`, declared by the component that performs it in its action manifest
// and granted through roles. The panel names the ones its controls perform and looks each up in the
// caller's `/me/access` answers (`access.js`); whether somebody holds one is never decided here.
//
// An action no installed manifest declares is performed by an Owner alone, and every member's report
// says `owner` for exactly that reason — so a control gated on an undeclared action is an Owner's
// until its component declares it. The ids below are the names those components declare.
//
// Imports nothing.

const ACTIONS = {
  // The engine (kgsm/deploy/kgsm.actions.json).
  LIBRARY_READ: "kgsm:library.read",
  BLUEPRINTS_WRITE: "kgsm:blueprints.write",
  LIBRARIES_MANAGE: "kgsm:libraries.manage",
  ENGINE_CONFIG_READ: "kgsm:engine.config.read",
  ENGINE_CONFIG_WRITE: "kgsm:engine.config.write",
  SERVER_READ: "kgsm:server.read",
  SERVER_INSTALL: "kgsm:server.install",
  SERVER_UNINSTALL: "kgsm:server.uninstall",
  SERVER_START: "kgsm:server.start",
  SERVER_STOP: "kgsm:server.stop",
  SERVER_RESTART: "kgsm:server.restart",
  SERVER_UPDATE: "kgsm:server.update",
  SERVER_CONSOLE_READ: "kgsm:server.console.read",
  SERVER_CONSOLE_WRITE: "kgsm:server.console.write",
  SERVER_CONFIG_READ: "kgsm:server.config.read",
  SERVER_CONFIG_WRITE: "kgsm:server.config.write",
  SERVER_WINDOWS_WRITE: "kgsm:server.windows.write",
  SERVER_FILES_READ: "kgsm:server.files.read",
  SERVER_FILES_WRITE: "kgsm:server.files.write",
  SERVER_BACKUPS_READ: "kgsm:server.backups.read",
  SERVER_BACKUPS_CREATE: "kgsm:server.backups.create",
  SERVER_BACKUPS_RESTORE: "kgsm:server.backups.restore",
  SERVER_BACKUPS_MANAGE: "kgsm:server.backups.manage",
  SERVER_PLAYERS_KICK: "kgsm:server.players.kick",
  SERVER_PLAYERS_BAN: "kgsm:server.players.ban",
  SERVER_MOVE: "kgsm:server.move",

  // The Control Panel API's own surfaces.
  HOSTS_READ: "api:hosts.read",
  HOSTS_WRITE: "api:hosts.write",
  BATCHES_READ: "api:batches.read",
  BATCHES_CANCEL: "api:batches.cancel",
  ALERTS_READ: "api:alerts.read",
  AUDIT_READ: "api:audit.read",
  DIAGNOSTICS_READ: "api:diagnostics.read",
  LOGS_READ: "api:logs.read",
  INTEGRATIONS_MANAGE: "api:integrations.manage",
  SERVICES_READ: "api:services.read",
  SERVICES_CONNECT: "api:services.manage",
  MEMBERS_READ: "api:members.read",
  MEMBERS_MANAGE: "api:members.manage",
  MEMBERS_REMOVE: "api:members.remove",

  // Leaves' own surfaces, reached through the node.
  MONITOR_METRICS_READ: "monitor:metrics.read",
  THRESHOLDS_WRITE: "monitor:thresholds.write",
  REACTOR_RULES_WRITE: "reactor:rules.write",
  SCHEDULER_WINDOWS_WRITE: "scheduler:windows.write",

  // The assistant: running a staged command without asking first.
  ASSISTANT_AUTORUN: "assistant:autorun",

  // The DNS anchor (kgsm-dns's Access/DnsActions), all at the cluster.
  DNS_NAMES_READ: "dns:names.read",
  DNS_ZONE_CHECK: "dns:zone.check",
  DNS_CERTIFICATES_RENEW: "dns:certificates.renew",
  DNS_ALIASES_WRITE: "dns:aliases.write",

  // The auth anchor (kgsm-auth/deploy/kgsm-auth-anchor.anchor.actions.json).
  ROLES_EDIT: "auth:roles.edit",
  PERMISSIONS_EDIT: "auth:permissions.edit",
  ROLES_ASSIGN: "auth:roles.assign",
  ACCOUNTS_APPROVE: "auth:accounts.approve",
  ACCOUNTS_DISABLE: "auth:accounts.disable",
  ACCOUNTS_DELETE: "auth:accounts.delete",
  ACCOUNTS_CREATE: "auth:accounts.create",
  SERVICES_MANAGE: "auth:services.manage",
};

// Operating a server: any of its lifecycle verbs. Each verb's control asks for its own action
// (`VERB_ACTION`); this is the question a surface asks before offering any lifecycle control at all.
const SERVER_OPERATE = [ACTIONS.SERVER_START, ACTIONS.SERVER_STOP, ACTIONS.SERVER_RESTART];

// The action each lifecycle verb performs.
const VERB_ACTION = {
  start: ACTIONS.SERVER_START,
  stop: ACTIONS.SERVER_STOP,
  restart: ACTIONS.SERVER_RESTART,
  update: ACTIONS.SERVER_UPDATE,
};

// A component's own configuration, read and written on its standard surface.
const configReadOf = (component) => component + ":config.read";
const configWriteOf = (component) => component + ":config.write";

// Administering access: any action the anchor's management pages perform.
const ADMINISTER_ACCESS = [
  ACTIONS.ROLES_EDIT, ACTIONS.PERMISSIONS_EDIT, ACTIONS.ROLES_ASSIGN, ACTIONS.ACCOUNTS_APPROVE,
  ACTIONS.ACCOUNTS_DISABLE, ACTIONS.ACCOUNTS_DELETE, ACTIONS.ACCOUNTS_CREATE, ACTIONS.SERVICES_MANAGE,
];

export { ACTIONS, ADMINISTER_ACCESS, SERVER_OPERATE, VERB_ACTION, configReadOf, configWriteOf };

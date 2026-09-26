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
  SERVER_READ: "kgsm:server.read",
  SERVER_INSTALL: "kgsm:server.install",
  SERVER_START: "kgsm:server.start",
  SERVER_STOP: "kgsm:server.stop",
  SERVER_RESTART: "kgsm:server.restart",
  SERVER_UPDATE: "kgsm:server.update",
  SERVER_CONSOLE_WRITE: "kgsm:server.console.write",
  SERVER_CONFIG_WRITE: "kgsm:server.config.write",
  SERVER_MOVE: "kgsm:server.move",

  // The Control Panel API's own surfaces.
  ALERTS_READ: "api:alerts.read",
  AUDIT_READ: "api:audit.read",
  MEMBERS_READ: "api:members.read",
  MEMBERS_MANAGE: "api:members.manage",

  // Leaves' own editors, reached through the node.
  THRESHOLDS_WRITE: "monitor:thresholds.write",
  REACTOR_RULES_WRITE: "reactor:rules.write",
  SCHEDULER_WINDOWS_WRITE: "scheduler:windows.write",

  // The assistant: running a staged command without asking first.
  ASSISTANT_AUTORUN: "assistant:autorun",

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

// Operating a server: any of its lifecycle verbs. What decides whether a server's operator tabs and
// controls are offered at all; each control still asks for its own action.
const SERVER_OPERATE = [ACTIONS.SERVER_START, ACTIONS.SERVER_STOP, ACTIONS.SERVER_RESTART];

// Administering access: any action the anchor's management pages perform.
const ADMINISTER_ACCESS = [
  ACTIONS.ROLES_EDIT, ACTIONS.PERMISSIONS_EDIT, ACTIONS.ROLES_ASSIGN, ACTIONS.ACCOUNTS_APPROVE,
  ACTIONS.ACCOUNTS_DISABLE, ACTIONS.ACCOUNTS_DELETE, ACTIONS.ACCOUNTS_CREATE, ACTIONS.SERVICES_MANAGE,
];

export { ACTIONS, ADMINISTER_ACCESS, SERVER_OPERATE };

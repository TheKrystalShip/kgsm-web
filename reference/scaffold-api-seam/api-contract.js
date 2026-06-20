// api-contract.js — the shared shapes between this frontend and the (in-progress)
// Krystal backend. These are JSDoc typedefs: zero runtime cost, but your editor
// gets autocomplete + type-checking, and frontend/backend have one written
// agreement to point at. (If you adopt TypeScript later, this file becomes
// `api-contract.ts` with `export interface` — same shapes.)
//
// Derived from the prototype fixtures + ui_kits/control-panel/docs/architecture.html.
// Keep this file in sync with the backend's OpenAPI/JSON-schema as it firms up.

/**
 * @typedef {"online"|"offline"|"updating"|"installing"|"error"} ServerStatus
 */

/**
 * @typedef {Object} Players
 * @property {number} current
 * @property {number} max
 */

/**
 * @typedef {Object} Ram
 * @property {number} used  Gigabytes in use.
 * @property {number} max   Gigabytes allocated.
 */

/**
 * A single game server instance.
 * @typedef {Object} Server
 * @property {string} id
 * @property {string} name
 * @property {string} game
 * @property {ServerStatus} status
 * @property {string} [uptime]            Human string, e.g. "2d 4h 12m".
 * @property {string} [ip]                "host:port".
 * @property {Players} players
 * @property {number} cpu                 Percent 0–100.
 * @property {Ram} ram
 * @property {string} version
 * @property {string} [update_available]  Version string if an update is pending.
 * @property {string} [last_backup]       ISO timestamp.
 * @property {string} hostId              FK -> Host.id.
 * @property {string} [art]               CSS background fallback when no cover.
 * @property {string} [cover]             Cover-art URL (resolved server-side).
 */

/**
 * A machine running the Krystal agent.
 * @typedef {Object} Host
 * @property {string} id
 * @property {string} name
 * @property {string} hostname
 * @property {string} region
 * @property {boolean} online
 * @property {"admin"|"operator"|"viewer"|"none"} tier  This identity's role ON THIS host.
 * @property {boolean} [authDenied]       True if this identity has no granted role here (403).
 * @property {string} [panel_version]
 */

/**
 * A catalog entry (installable blueprint). "installed" is NOT stored — it's
 * derived live: a game is installed iff >=1 server runs from it.
 * @typedef {Object} CatalogGame
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} players            Display range, e.g. "1–40".
 * @property {string} [addedAt]          ISO date the entry was added.
 * @property {string[]} [hosts]          Host ids that offer it; omitted = all.
 */

/**
 * @typedef {Object} AuditActor
 * @property {string} name
 * @property {"discord"|"system"|"api"} provider
 */

/**
 * One "who did what, when" event. action is a dot-notation enum:
 *   server.{install,start,stop,restart,update,crash,rename,delete}
 *   player.{kick,ban,unban,allow.add,allow.remove,join,leave}
 *   backup.{create,restore,delete,download}
 *   file.{edit,upload,delete} · settings.change
 *   auth.{login,logout,token.create} · discord.webhook.update
 *   host.{connect,update}
 * @typedef {Object} AuditEvent
 * @property {string} id
 * @property {string} ts                 ISO timestamp.
 * @property {AuditActor} actor
 * @property {string} action
 * @property {"success"|"info"|"warn"|"danger"} severity
 * @property {string} summary            Short past-tense phrase.
 * @property {string} [serverId]
 * @property {{kind:string,id?:string,name?:string}} [target]
 * @property {Object} [meta]             Free-form extra context.
 */

// No runtime exports — this module is types only. Importing it for its side
// effects is a no-op; reference the typedefs via JSDoc `import(...)` instead.
export {};

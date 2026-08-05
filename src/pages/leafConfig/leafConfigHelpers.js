// leafConfigHelpers — pure derivations for the leaf configuration page: the draft/reset
// bookkeeping, the provenance vocabulary, and the filter predicates. No React, no API.

// ---- Provenance ---------------------------------------------------------
// Which tier a field's effective value came from. `unknown` is a state of its own: the host
// could not read the source that would supply the value, so what the leaf is running with is
// genuinely not known. It is never presented as the default.
const SOURCE_TITLE = {
  override: "Set here, in the Control Panel's override layer",
  floor: "Comes from the leaf's own deploy config — its unit, env file or settings file",
  default: "The leaf's coded default; nothing on this host sets it",
  unknown: "This host could not read the source that would supply this value, so what the leaf is running with is unknown",
};

// ---- Value display ------------------------------------------------------
// "unset" and "empty" are different facts and the page says which: nothing supplies a value at
// all, versus the leaf's own config supplying an empty one (several settings read that as "fall
// back to the machine name"). Neither is coerced into the other.
function valueText(f, effective) {
  if (f.isSecret) return f.set ? "•••••• set" : "not set";
  if (effective == null) return null;
  if (effective === "") return "empty";
  return String(effective) + (f.unit ? " " + f.unit : "");
}
function isBlank(f, effective) {
  const t = valueText(f, effective);
  return t == null || t === "empty" || t === "not set";
}

// ---- Draft bookkeeping --------------------------------------------------
// A draft is only a change when it differs from what the leaf is running with. Comparison is on
// strings because that is what the wire carries and what every control produces.
function currentOf(f) {
  return f.effective == null ? "" : String(f.effective);
}
function draftOf(f, drafts) {
  const d = drafts[f.key];
  return d === undefined ? currentOf(f) : d;
}
function isDirty(f, drafts, resets) {
  if (resets.has(f.key)) return true;
  if (f.isSecret) return typeof drafts[f.key] === "string" && drafts[f.key] !== "";
  const d = drafts[f.key];
  return d !== undefined && String(d) !== currentOf(f);
}
function dirtyFields(fields, drafts, resets) {
  return (fields || []).filter(f => isDirty(f, drafts, resets));
}
function isOverridden(f) {
  return f.overridden || f.source === "override";
}

// The PUT body: everything staged, in one request, so the leaf restarts once. A key being reset
// is never also sent as a value — reset wins, and clearing the draft when reset is toggled keeps
// the two from disagreeing.
function buildPayload(fields, drafts, resets) {
  const values = {};
  const reset = [];
  (fields || []).forEach(f => {
    if (resets.has(f.key)) { reset.push(f.key); return; }
    if (!isDirty(f, drafts, resets)) return;
    values[f.key] = String(drafts[f.key]);
  });
  return { values, reset };
}

// ---- Filtering ----------------------------------------------------------
const FILTERS = {
  all: () => true,
  modified: (f, ctx) => isDirty(f, ctx.drafts, ctx.resets) || isOverridden(f),
  risky: (f) => f.risk === "wiring" || f.risk === "destructive",
  unknown: (f) => f.source === "unknown",
};

function matchesQuery(f, q) {
  if (!q) return true;
  const hay = (f.label + " " + (f.envName || "") + " " + f.key + " " + (f.description || "")).toLowerCase();
  return hay.includes(q);
}

function filterFields(fields, { query, filter, drafts, resets }) {
  const q = (query || "").trim().toLowerCase();
  const pred = FILTERS[filter] || FILTERS.all;
  return (fields || []).filter(f => matchesQuery(f, q) && pred(f, { drafts, resets }));
}

// Fields bucketed into their descriptor groups, in declared order. A field whose group is absent
// from the descriptor (or that has none) falls into a trailing "Other" bucket rather than
// vanishing — the page must never silently drop a setting the leaf declares.
function groupFields(config, fields) {
  const groups = (config && config.groups) || [];
  const out = [];
  groups.forEach(g => {
    const inGroup = fields.filter(f => (f.group || "") === g.id);
    if (inGroup.length) out.push({ id: g.id, label: g.label, fields: inGroup });
  });
  const known = new Set(groups.map(g => g.id));
  const rest = fields.filter(f => !known.has(f.group || ""));
  if (rest.length) out.push({ id: "__other", label: groups.length ? "Other" : "Settings", fields: rest });
  return out;
}

export {
  SOURCE_TITLE, valueText, isBlank, currentOf, draftOf, isDirty, dirtyFields, isOverridden,
  buildPayload, filterFields, groupFields,
};

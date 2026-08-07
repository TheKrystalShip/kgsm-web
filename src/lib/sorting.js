// sorting — the ONE comparator every sortable surface orders rows with: the sortable
// `<CardTable>` columns and the card grids' toolbar sort.
//
// It compares the VALUE a column's accessor returns, never the string the cell happens to
// render. A cell showing "27.0 s" beside one showing "878 ms" is two renderings of one
// number, and ordering their text puts them in an order no reader can explain.
//
// Three kinds of value, one rule each:
//
//   Date    → its epoch millis. A timestamp is the value a "Last seen" column sorts by, and
//             comparing it as text orders the table by the weekday name `Date#toString`
//             happens to lead with.
//   number  → numerically.
//   other   → case-insensitively, digit-aware ("srv2" before "srv10").
//
// And one rule for the absence of a value. `null`, `undefined`, `""`, an unparseable date and
// a non-finite number are all MISSING, and MISSING is never coerced to `0` or `""` — an
// unmeasured median is not the fastest one, and a player who has never been seen is not the
// longest-ago. A missing row sinks to the bottom in BOTH directions, so flipping a column
// never promotes "unknown" to the top of the answer.

const MISSING = Symbol("missing");

function sortValue(v) {
  if (v == null || v === "") return MISSING;
  if (v instanceof Date) {
    const t = v.getTime();
    return isFinite(t) ? t : MISSING;
  }
  if (typeof v === "number") return isFinite(v) ? v : MISSING;
  return v;
}

/// Order two accessor values ascending. Returns 0 for a pair that carries no order.
function compareValues(a, b) {
  const av = sortValue(a), bv = sortValue(b);
  if (av === MISSING || bv === MISSING) return 0;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
}

/// Order two accessor values in `dir`, with missing values pinned last either way. This is the
/// comparator itself — the direction flip lives here rather than at the call site, because the
/// pinning must survive it.
function compareBy(accessor, a, b, dir) {
  const av = sortValue(accessor(a)), bv = sortValue(accessor(b));
  if (av === MISSING || bv === MISSING) return av === bv ? 0 : av === MISSING ? 1 : -1;
  const cmp = compareValues(av, bv);
  return dir === "asc" ? cmp : -cmp;
}

/// Sort a list by an accessor. Returns a NEW array; the input is never mutated.
function sortByAccessor(list, accessor, dir = "desc") {
  return [...(list || [])].sort((a, b) => compareBy(accessor, a, b, dir));
}

export { compareBy, compareValues, sortByAccessor };

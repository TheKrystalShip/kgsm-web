import React from "react";
import { Icon } from "./Icon.jsx";

// CardTable — tabular data dressed in the shared briefing-card chrome. It
// reuses .chat-brief for the frame + header, so a table sits in the same card
// family as Alerts and Recent activity (titled header, count pill, optional
// "View all →"). One fixed grid template drives the column-header row AND every
// body row, so cells line up regardless of content.
//
// Generic on purpose — first used by the diagnostics "Processes" panel, but
// built to be reused for any compact, headered table.
//
//   columns: [{ key, label, width, align, render(row), sort(row) }]
//     width  — any CSS grid track ("minmax(0,1.7fr)", "56px"); default "1fr".
//     align  — "right" or "center" aligns the header + cells (tabular
//              numerals); default is left.
//     render — returns the cell node; without it the cell shows row[key].
//     sort   — value accessor that makes the column sortable: returns the
//              value to order by (number or string). Columns without it have
//              no sort control. Strings sort case-insensitively, numbers
//              numerically.
//   rows:    array of records. Pass getKey(row) for a stable React key
//            (falls back to row.id, then the index).
//   defaultSort: { key, dir } — initial ordering ("asc" | "desc").
//   rowClass(row): optional — extra className appended to that row's element
//                  (e.g. tint a "stuck" process row). Purely additive.
//   max:     cap the number of rows shown AFTER sorting (so "show the top N by
//            whatever column is active" works); omit to show every row.
//
// The card header (title / count / "View all") is only rendered when at least
// one of title, count, or onViewAll is given — pass none to get a bare table
// (just column heads + rows) that can sit under an external toolbar.
function CardTable({ icon, title, count, onViewAll, viewAllLabel = "View all", columns, rows = [], getKey, max, defaultSort = null, rowClass, empty = "Nothing to show" }) {
  const [sort, setSort] = React.useState(defaultSort);
  const template = columns.map(c => c.width || "1fr").join(" ");
  const keyFor = (row, i) => (getKey ? getKey(row) : (row.id != null ? row.id : i));

  const toggleSort = (col) => {
    if (!col.sort) return;
    setSort(prev =>
      (prev && prev.key === col.key)
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.defaultDir || "desc" });
  };

  const ordered = React.useMemo(() => {
    let r = rows;
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      if (col && col.sort) {
        r = [...rows].sort((a, b) => {
          const av = col.sort(a), bv = col.sort(b);
          let cmp;
          if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
          else cmp = String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), undefined, { numeric: true, sensitivity: "base" });
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return max != null ? r.slice(0, max) : r;
  }, [rows, sort, columns, max]);

  return (
    <div className="chat-brief card-table">
      {(title != null || count != null || onViewAll) && (
        <div className="chat-brief__head">
          <span className="chat-brief__title">
            {icon && <Icon name={icon} size={13} />}{title}
            {count != null && <span className="chat-brief__count chat-brief__count--neutral">{count}</span>}
          </span>
          {onViewAll && (
            <button className="dash-section__more" onClick={onViewAll}>
              {viewAllLabel} <Icon name="arrow-right" size={11} strokeWidth={2.2} />
            </button>
          )}
        </div>
      )}
      <div className="card-table__head" style={{ gridTemplateColumns: template }}>
        {columns.map(c => {
          const active = sort && sort.key === c.key;
          const cls = "card-table__th" + (c.align ? " card-table__th--" + c.align : "");
          if (!c.sort) return <span key={c.key} className={cls}>{c.label}</span>;
          return (
            <button
              key={c.key}
              type="button"
              className={cls + " card-table__th--sort" + (active ? " is-active" : "")}
              onClick={() => toggleSort(c)}
              title={"Sort by " + c.label}
              aria-label={"Sort by " + c.label}>
              <span className="card-table__th-label">{c.label}</span>
              <Icon name={active && sort.dir === "asc" ? "chevron-up" : "chevron-down"} size={12} strokeWidth={2.4} className="card-table__sort-ico" />
            </button>
          );
        })}
      </div>
      <div className="card-table__body">
        {ordered.length === 0 ? (
          <div className="card-table__empty">{empty}</div>
        ) : ordered.map((row, i) => (
          <div className={"card-table__row" + (rowClass ? " " + rowClass(row) : "")} key={keyFor(row, i)} style={{ gridTemplateColumns: template }}>
            {columns.map(c => (
              <span key={c.key} className={"card-table__cell" + (c.align ? " card-table__cell--" + c.align : "")}>
                {c.render ? c.render(row) : row[c.key]}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export { CardTable };

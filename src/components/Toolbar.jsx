import React from "react";
import { Icon } from "./Icon.jsx";
import { useDebouncedValue } from "./Pagination.jsx";

// Toolbar — the reusable filter / search / sort / action bar.
//
// One quiet row that sits directly on the page (no heavy bordered card),
// echoing the modernized assistant header: transparent ghost controls,
// surface-2 hovers, a single teal accent reserved for active state, and
// secondary dimensions tucked into a popover instead of a wall of inline
// selects.
//
// Composition, not configuration — a page assembles the pieces it needs:
//
//   <Toolbar>
//     <ToolbarSearch value={q} onChange={setQ} pending={searching} placeholder="Search…" />
//     <ToolbarFilters fields={[
//       { id:"status", label:"Status", value:status, onChange:setStatus, default:"all",
//         options:[{ value:"all", label:"All", count:6 }, { value:"online", label:"Online", count:3 }] },
//       { id:"game", label:"Game", value:game, onChange:setGame, default:"all", options:gameOpts },
//     ]} onReset={resetAll} />
//     <ToolbarSpacer />
//     <ToolbarCount shown={n} total={m} unit="servers" />
//     <ToolbarButton icon="refresh-cw" onClick={refresh} spinning={busy}>Refresh</ToolbarButton>
//   </Toolbar>
//
// ToolbarFilters owns the single "Filters" popover AND the inline active-filter
// chips, so the two always stay in sync. ToolbarSort is the dedicated ordering
// control that sits beside it — an always-active popover (sort key + asc/desc
// direction), the card-grid counterpart to CardTable's sortable headers. Pages
// whose rows are a table (Players, Processes) sort via CardTable headers; pages
// whose rows are tiles/cards (Servers, Library) sort via ToolbarSort.

function Toolbar({ children, className }) {
  return <div className={"toolbar" + (className ? " " + className : "")}>{children}</div>;
}

function ToolbarSearch({ value, onChange, placeholder, pending, autoFocus, ariaLabel }) {
  return (
    <div className="toolbar__search">
      <Icon name="search" size={16} />
      <input
        placeholder={placeholder || "Search…"}
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck="false"
        autoFocus={autoFocus}
        aria-label={ariaLabel || placeholder || "Search"} />
      {pending && (
        <span className="toolbar__search-pending" title="Searching…"><Icon name="loader-2" size={14} /></span>
      )}
      {value && !pending && (
        <button className="toolbar__search-clear" onClick={() => onChange("")} title="Clear" aria-label="Clear search">
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

function ToolbarSpacer() { return <span className="toolbar__spacer" />; }

// ToolbarSort — the ordering control for card/tile grids that can't carry
// sortable column headers. A single always-on popover: pick the sort key
// (radio list) and the direction (Asc/Desc segmented toggle). Re-picking the
// active key flips direction, mirroring CardTable's header behaviour, so the
// two sort surfaces feel identical across the app.
//
//   value:   current sort key
//   dir:     "asc" | "desc"
//   onChange(key, dir)
//   options: [{ value, label, defaultDir }]  — defaultDir applied when you
//            switch TO that key (numbers usually "desc", names "asc").
function ToolbarSort({ value, dir = "desc", onChange, options, label = "Sort" }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const opts = options || [];
  const current = opts.find(o => o.value === value) || opts[0];
  const pick = (o) => {
    if (o.value === value) onChange(o.value, dir === "asc" ? "desc" : "asc");
    else onChange(o.value, o.defaultDir || "desc");
  };
  const setDir = (d) => { if (d !== dir) onChange(value, d); };

  return (
    <div className="toolbar-filter toolbar-sort" ref={ref}>
      <button
        className={"toolbar-btn toolbar-filter__trigger" + (open ? " toolbar-btn--on" : "")}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog" aria-expanded={open} title="Sort order">
        <Icon name="arrow-up-down" size={14} />
        <span>{label}{current ? ": " + current.label : ""}</span>
        <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} size={13} strokeWidth={2.3} className="toolbar-sort__dir-ico" />
      </button>

      {open && (
        <div className="toolbar-filter__menu toolbar-sort__menu" role="dialog" aria-label="Sort">
          <div className="toolbar-filter__head">
            <span className="toolbar-filter__head-label">{label} by</span>
            <div className="toolbar-sort__dir" role="group" aria-label="Direction">
              <button
                className={"toolbar-sort__dir-btn" + (dir === "asc" ? " is-on" : "")}
                onClick={() => setDir("asc")} aria-pressed={dir === "asc"} title="Ascending">
                <Icon name="arrow-up" size={12} strokeWidth={2.4} /> Asc
              </button>
              <button
                className={"toolbar-sort__dir-btn" + (dir === "desc" ? " is-on" : "")}
                onClick={() => setDir("desc")} aria-pressed={dir === "desc"} title="Descending">
                <Icon name="arrow-down" size={12} strokeWidth={2.4} /> Desc
              </button>
            </div>
          </div>
          <div className="toolbar-filter__body">
            <div className="toolbar-filter__opts">
              {opts.map(o => {
                const on = o.value === value;
                return (
                  <button
                    key={o.value}
                    className={"toolbar-filter__opt" + (on ? " toolbar-filter__opt--on" : "")}
                    onClick={() => pick(o)}
                    role="radio" aria-checked={on}>
                    <span className="toolbar-filter__radio" />
                    <span className="toolbar-filter__opt-label">{o.label}</span>
                    {on && <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} size={13} strokeWidth={2.4} className="toolbar-filter__opt-dir" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// sortByAccessor — the shared comparator behind every card-grid sort, matching
// CardTable's rules exactly: numbers compare numerically, everything else
// case-insensitively with numeric awareness. Returns a NEW array. `dir` flips
// the result. Pages pass an accessor(row) -> comparable value.
function sortByAccessor(list, accessor, dir = "desc") {
  const sorted = [...(list || [])].sort((a, b) => {
    const av = accessor(a), bv = accessor(b);
    let cmp;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), undefined, { numeric: true, sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function ToolbarCount({ shown, total, unit, children }) {
  if (children) return <span className="toolbar__count">{children}</span>;
  return <span className="toolbar__count"><b>{shown}</b> of {total} {unit}</span>;
}

function ToolbarButton({ icon, children, onClick, disabled, title, spinning, active, ariaLabel }) {
  return (
    <button
      className={"toolbar-btn" + (active ? " toolbar-btn--on" : "") + (children ? "" : " toolbar-btn--icon")}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || (typeof children === "string" ? children : title)}>
      {icon && <Icon name={icon} size={children ? 13 : 15} className={spinning ? "is-spinning" : ""} />}
      {children && <span>{children}</span>}
    </button>
  );
}

// Resolve a field's currently-selected option (for chip labels).
function optionFor(field) {
  return (field.options || []).find(o => o.value === field.value) || null;
}
function fieldActive(field) {
  return field.value !== (field.default != null ? field.default : (field.options && field.options[0] && field.options[0].value));
}

// ToolbarFilters — single Filters popover + inline active-filter chips.
function ToolbarFilters({ fields, onReset, label = "Filters" }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const visible = (fields || []).filter(f => !f.hidden);
  const active = visible.filter(fieldActive);
  const reset = () => {
    visible.forEach(f => f.onChange(f.default != null ? f.default : (f.options[0] && f.options[0].value)));
    if (onReset) onReset();
  };

  return (
    <div className="toolbar-filter" ref={ref}>
      <button
        className={"toolbar-btn toolbar-filter__trigger" + (open ? " toolbar-btn--on" : "")}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog" aria-expanded={open} title="Filters">
        <Icon name="sliders-horizontal" size={14} />
        <span>{label}</span>
        {active.length > 0 && <span className="toolbar-filter__badge">{active.length}</span>}
      </button>

      {/* inline active-filter chips — clearing the field, not just the chip */}
      {active.map(f => {
        const opt = optionFor(f);
        return (
          <button
            key={f.id}
            className="toolbar-chip"
            title={"Clear " + f.label.toLowerCase() + " filter"}
            onClick={() => f.onChange(f.default != null ? f.default : (f.options[0] && f.options[0].value))}>
            <span className="toolbar-chip__key">{f.label}</span>
            <span className="toolbar-chip__val">{opt ? opt.label : f.value}</span>
            <Icon name="x" size={12} strokeWidth={2.4} />
          </button>
        );
      })}

      {open && (
        <div className="toolbar-filter__menu" role="dialog" aria-label="Filters">
          <div className="toolbar-filter__head">
            <span className="toolbar-filter__head-label">{label}</span>
            {active.length > 0 && (
              <button className="toolbar-filter__reset" onClick={reset}>
                <Icon name="rotate-ccw" size={12} /> Reset
              </button>
            )}
          </div>
          <div className="toolbar-filter__body">
            {visible.map(f => (
              <div className="toolbar-filter__group" key={f.id}>
                <div className="toolbar-filter__group-label">{f.label}</div>
                <div className="toolbar-filter__opts">
                  {(f.options || []).map(o => {
                    const on = o.value === f.value;
                    return (
                      <button
                        key={o.value}
                        className={"toolbar-filter__opt" + (on ? " toolbar-filter__opt--on" : "")}
                        onClick={() => f.onChange(o.value)}
                        role="radio" aria-checked={on}>
                        <span className="toolbar-filter__radio" />
                        <span className="toolbar-filter__opt-label">{o.label}</span>
                        {o.count != null && <span className="toolbar-filter__opt-count">{o.count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// useFilters — optional state helper so a page declares its filter schema once
// instead of wiring N useState calls. Pages with bespoke filtering logic can
// keep their own state and just feed the Toolbar; this is the convenience path.
//
//   const f = useFilters({ search:"", status:"all", game:"all" });
//   f.query, f.setQuery, f.debouncedQuery, f.searchPending
//   f.values.status, f.set("status", v), f.reset(), f.activeCount
function useFilters(defaults = {}, { debounce = 250 } = {}) {
  const { search = "", ...rest } = defaults;
  const [query, setQuery] = React.useState(search);
  const [values, setValues] = React.useState(rest);
  const debouncedQuery = useDebouncedValue(query, debounce);
  const searchPending = query.trim() !== debouncedQuery.trim();
  const set = React.useCallback((key, val) => setValues(v => ({ ...v, [key]: val })), []);
  const reset = React.useCallback(() => { setQuery(search); setValues(rest); }, []); // eslint-disable-line
  const activeCount =
    (query.trim() ? 1 : 0) +
    Object.keys(rest).filter(k => values[k] !== rest[k]).length;
  return { query, setQuery, debouncedQuery, searchPending, values, set, reset, activeCount };
}

export { Toolbar, ToolbarButton, ToolbarCount, ToolbarFilters, ToolbarSearch, ToolbarSort, ToolbarSpacer, sortByAccessor, useFilters };

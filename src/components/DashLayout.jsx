import React from "react";
import { Icon } from "./Icon.jsx";

// DashLayout — client-side reordering of the dashboard's vertical bands.
//
// Scope (v1): the top-level bands stack vertically (KPIs, capacity, the feed,
// recently-added, servers). Users drag whole bands up/down to reorder them; the
// order persists per-browser in localStorage — exactly how sidebar collapse and
// the assistant dock width are remembered (krystal:* keys, try/catch wrapped).
//
// Deliberately NOT a free 2D canvas: reorder within the existing structured
// layout only, so the responsive grids inside each band keep working. Dragging
// is gated behind an explicit "Customize" mode and an explicit grip handle, so
// it can never fire by accident against the cards' normal click-to-drill.
//
// Persistence is a list of band ids. Restore is MERGE-SAFE: bands that aren't
// present this session keep their saved slot, and bands new to the saved order
// fall in at their natural position — never a blind index restore.

  const DASH_ORDER_KEY = "krystal:dash:order";

  // Generic per-key band-order persistence. The dashboard and the server-detail
  // overview each own their own storage key, but both go through here so the
  // string-only filter and the try/catch storage guard live in exactly one place.
  function loadBandOrder(key) {
    try {
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
    } catch (e) { return []; }
  }
  function saveBandOrder(key, order) {
    try { localStorage.setItem(key, JSON.stringify(order)); } catch (e) {}
  }

  // Back-compat: the dashboard's original entry points, now thin wrappers over
  // the generic helpers keyed to the dashboard's own slot.
  function loadDashOrder() { return loadBandOrder(DASH_ORDER_KEY); }
  function saveDashOrder(order) { saveBandOrder(DASH_ORDER_KEY, order); }

  // Saved order, projected onto the bands actually present this render: saved
  // ids first (in saved order), then any present-but-unsaved ids appended in
  // their natural array order. Absent saved ids are dropped from the view.
  function orderedVisible(stored, present) {
    const presentSet = new Set(present);
    const seen = new Set();
    const out = [];
    for (const id of stored) if (presentSet.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
    for (const id of present) if (!seen.has(id)) { out.push(id); seen.add(id); }
    return out;
  }

  // Fold a freshly reordered *visible* sequence back into the full saved order,
  // so bands absent this session keep their anchor slot relative to the rest.
  function mergeStored(stored, newVisible, present) {
    const presentSet = new Set(present);
    const result = [];
    const used = new Set();
    let vi = 0;
    for (const id of stored) {
      if (presentSet.has(id)) {
        if (vi < newVisible.length) { result.push(newVisible[vi]); used.add(newVisible[vi]); vi++; }
      } else if (!used.has(id)) {
        result.push(id); used.add(id);
      }
    }
    while (vi < newVisible.length) { if (!used.has(newVisible[vi])) { result.push(newVisible[vi]); used.add(newVisible[vi]); } vi++; }
    return result;
  }

  // One band: its content wrapped with a grip rail. The rail is the ONLY drag
  // initiator (a real <button>, so ↑/↓ reorder works without a mouse). Dragging
  // is pointer-based — see DashBandList — not native HTML5 DnD, which fires
  // dragenter/leave erratically and can't animate.
  function DashBand({ id, label, customize, dragging, onGripDown, onMove }) {
    if (!customize) return null; // grip only renders in edit mode
    return (
      <button
        type="button"
        data-band-id={id}
        className="dash-band__grip"
        aria-label={"Reorder " + (label || "section") + " \u2014 drag, or use arrow keys"}
        title="Drag to reorder (or use ↑ / ↓)"
        onPointerDown={(e) => onGripDown(id, e)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); onMove(id, -1); }
          else if (e.key === "ArrowDown") { e.preventDefault(); onMove(id, 1); }
        }}
      >
        <Icon name="grip-vertical" size={16} strokeWidth={2} />
      </button>
    );
  }

  // The stack. `bands` is [{ id, label, node }]. `storedOrder` is the persisted
  // id list; `onReorder` receives the new FULL stored order to persist.
  //
  // Drag model (smooth sortable): on grip press we snapshot every band's rect.
  // The dragged band tracks the cursor 1:1 (no transition); the others slide by
  // exactly one dragged-band-height (with a transition) to open/close the slot.
  // The drop index is decided by MIDPOINT CROSSING against the snapshot centers
  // — so the whole upper/lower half of each neighbour is a valid target, not a
  // narrow edge. Reorder is committed once, on release.
  function DashBandList({ bands, customize, storedOrder, onReorder }) {
    const present = bands.map(b => b.id);
    const byId = React.useMemo(() => Object.fromEntries(bands.map(b => [b.id, b])), [bands]);
    const visible = orderedVisible(storedOrder || [], present);

    const [dragId, setDragId] = React.useState(null);
    const listRef = React.useRef(null);
    const drag = React.useRef(null); // live drag geometry (no re-render per move)

    function clearTransforms(nodes) {
      nodes.forEach((n) => { n.style.transform = ""; n.style.zIndex = ""; n.style.transition = ""; });
    }

    function onGripDown(id, e) {
      // Mouse: left button only. Touch/pen: always.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const list = listRef.current;
      if (!list) return;
      const nodes = Array.from(list.querySelectorAll(".dash-band"));
      const order = visible.slice(); // DOM order == visible (no active drag yet)
      const from = order.indexOf(id);
      if (from < 0) return;
      const rects = nodes.map((n) => n.getBoundingClientRect());
      const centers = rects.map((r) => r.top + r.height / 2);
      const gap = nodes.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 16;
      const step = rects[from].height + gap; // distance neighbours slide

      drag.current = { id, from, to: from, order, nodes, centers, step, startY: e.clientY };
      setDragId(id);

      // The dragged node tracks the pointer with no transition; siblings animate.
      const dn = nodes[from];
      dn.style.transition = "none";
      dn.style.zIndex = "6";
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
      window.addEventListener("pointercancel", onPointerUp, { once: true });
      e.preventDefault();
    }

    function onPointerMove(e) {
      const st = drag.current;
      if (!st) return;
      const dy = e.clientY - st.startY;
      st.nodes[st.from].style.transform = "translateY(" + dy + "px)";

      // Drop index = where the dragged band's centre now sits relative to the
      // ORIGINAL neighbour centres (stable, generous half-band hit zones).
      const projected = st.centers[st.from] + dy;
      let to = st.from;
      while (to < st.order.length - 1 && projected > st.centers[to + 1]) to++;
      while (to > 0 && projected < st.centers[to - 1]) to--;
      st.to = to;

      for (let i = 0; i < st.nodes.length; i++) {
        if (i === st.from) continue;
        let t = 0;
        if (st.from < to && i > st.from && i <= to) t = -st.step;
        else if (to < st.from && i >= to && i < st.from) t = st.step;
        st.nodes[i].style.transform = t ? "translateY(" + t + "px)" : "";
      }
    }

    function onPointerUp() {
      const st = drag.current;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      drag.current = null;
      if (!st) { setDragId(null); return; }
      // Clear inline transforms and commit in the same tick: React re-renders to
      // the new DOM order, which matches where the bands visually settled.
      clearTransforms(st.nodes);
      setDragId(null);
      if (st.to !== st.from) {
        const next = st.order.slice();
        next.splice(st.to, 0, next.splice(st.from, 1)[0]);
        onReorder(mergeStored(storedOrder || [], next, present));
      }
    }

    function move(id, dir) {
      const idx = visible.indexOf(id);
      const ni = idx + dir;
      if (idx < 0 || ni < 0 || ni >= visible.length) return;
      const next = visible.slice();
      next.splice(ni, 0, next.splice(idx, 1)[0]);
      onReorder(mergeStored(storedOrder || [], next, present));
      // Keep keyboard focus on the band just moved so repeated ↑/↓ keeps working.
      requestAnimationFrame(() => {
        const el = listRef.current && listRef.current.querySelector('.dash-band__grip[data-band-id="' + id + '"]');
        if (el) el.focus();
      });
    }

    return (
      <div
        ref={listRef}
        className={"dash-bands" + (customize ? " dash-bands--edit" : "") + (dragId ? " dash-bands--reordering" : "")}
      >
        {visible.map((id) => {
          const band = byId[id];
          if (!band) return null;
          return (
            <div
              key={id}
              data-band-id={id}
              className={"dash-band" + (customize ? " dash-band--edit" : "") + (dragId === id ? " dash-band--dragging" : "")}
            >
              <DashBand
                id={id}
                label={band.label}
                customize={customize}
                dragging={dragId === id}
                onGripDown={onGripDown}
                onMove={move}
              />
              <div className="dash-band__inner">{band.node}</div>
            </div>
          );
        })}
      </div>
    );
  }

export { DashBandList, loadBandOrder, loadDashOrder, saveBandOrder, saveDashOrder };

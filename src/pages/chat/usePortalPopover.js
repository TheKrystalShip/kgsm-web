// usePortalPopover — a generic hook for portaled popovers that float over the
// page (z-indexed above the dock). Returns { pos, menuRef }: render via
// createPortal(..., document.body) with style={pos} and attach menuRef.
// Auto-places on both axes; outside-click closes.

import React from "react";

function usePortalPopover(open, setOpen, ref) {
  const menuRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, setOpen, ref]);
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const horiz = (r.left + r.right) / 2 > vw / 2
        ? { right: Math.round(vw - r.right) }
        : { left: Math.round(Math.max(0, r.left)) };
      const vert = r.top > vh / 2
        ? { bottom: Math.round(vh - r.top + 8) }
        : { top: Math.round(r.bottom + 8) };
      setPos({ ...horiz, ...vert });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, ref]);
  return { pos, menuRef };
}

export { usePortalPopover };

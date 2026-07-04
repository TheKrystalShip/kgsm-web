// useMobileSwipe — mobile edge-swipe: drag in from LEFT opens nav drawer,
// drag in from RIGHT opens assistant dock. Symmetric gesture model.

import React from "react";

function useMobileSwipe(drawerOpen, setDrawerOpen, assistantOpen, setAssistantOpen) {
  React.useEffect(() => {
    if (window.innerWidth > 768) return;
    let sx = 0, sy = 0, fromLeft = false, fromRight = false, tracking = false;
    const EDGE = 28, THRESH = 60;
    const onStart = (e) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      fromLeft = sx <= EDGE;
      fromRight = sx >= window.innerWidth - EDGE;
      tracking = fromLeft || fromRight || drawerOpen || assistantOpen;
    };
    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < THRESH || Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 0) {
        if (fromLeft && !drawerOpen) setDrawerOpen(true);
        else if (assistantOpen) setAssistantOpen(false);
      } else {
        if (fromRight && !assistantOpen) setAssistantOpen(true);
        else if (drawerOpen) setDrawerOpen(false);
      }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [drawerOpen, assistantOpen]);
}

export { useMobileSwipe };

// useRouteSync — the bidirectional URL <-> route sync. The address bar is the
// source of truth (Back/Forward, deep links, refresh).

import React from "react";
import { KrystalRouter } from "../lib/router.js";

function useRouteSync(route, setRoute, landingResolved) {
  const routeRef = React.useRef(route);
  routeRef.current = route;
  const didInitUrl = React.useRef(false);

  // route -> URL
  React.useEffect(() => {
    if (!landingResolved) return;
    const desired = KrystalRouter.routeToHash(route);
    if (window.location.hash === desired) { didInitUrl.current = true; return; }
    if (!didInitUrl.current) {
      didInitUrl.current = true;
      try { window.history.replaceState(null, "", desired); return; } catch {}
    }
    try { window.location.hash = desired; } catch {}
  }, [route, landingResolved]);

  // URL -> route
  React.useEffect(() => {
    const onHashChange = () => {
      const next = KrystalRouter.parseHash();
      if (!KrystalRouter.sameRoute(next, routeRef.current)) setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
}

export { useRouteSync };

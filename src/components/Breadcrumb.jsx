// Breadcrumb — a projection of the resolved route + the policy. The root
// "Home" crumb appears only when the persona can reach the dashboard.
//
// This is the ONE breadcrumb: it is rendered by the shell above every page, so a page that draws its
// own would sit under a second trail rather than replace it. A page that goes deeper adds its crumbs
// here instead.
//
// A crumb carries the route it opens, not just a kind, so a trail can step through a parameterised
// place (a node, then that node's Services tab) — which is what makes it able to mirror a nested URL
// rather than approximate it.

import React from "react";
import { can } from "../lib/persona.js";

function breadcrumbTrail(route, ctx) {
  const trail = [];
  if (can("nav.dashboard")) trail.push({ label: "Home", to: { kind: "home" } });
  switch (route.kind) {
    case "home":      break;
    case "servers":   trail.push({ label: "Servers", to: { kind: "servers" } }); break;
    case "server":    trail.push({ label: "Servers", to: { kind: "servers" } }, { label: ctx.serverName || "Server" }); break;
    case "library":   trail.push({ label: ctx.catalogLabel }); break;
    case "game":      trail.push({ label: ctx.catalogLabel, to: { kind: "library" } }, { label: ctx.gameName || "Game" }); break;
    case "attention": trail.push({ label: "Alerts" }); break;
    case "audit":     trail.push({ label: "Audit log" }); break;
    case "cluster":     route.hostId
                        ? trail.push({ label: "Cluster", to: { kind: "cluster" } }, { label: ctx.hostName || "Host" })
                        : trail.push({ label: "Cluster" });
                      break;
    // The leaf page hangs off its node's Services tab, and the trail says so — each crumb opens the
    // place its word names, so walking back up the breadcrumb walks back up the URL.
    case "leaf":        trail.push(
                        { label: "Cluster", to: { kind: "cluster" } },
                        { label: ctx.hostName || route.hostId || "Host", to: { kind: "cluster", hostId: route.hostId } },
                        { label: "Services", to: { kind: "cluster", hostId: route.hostId, tab: "services" } },
                        // The leaf's display name comes from the services board; until that answers, its
                        // id is what we actually know — shown as-is rather than held blank.
                        { label: ctx.leafName || route.leaf || "Leaf" });
                      break;
    case "leafConfig":  trail.push(
                        { label: "Cluster", to: { kind: "cluster" } },
                        { label: ctx.hostName || route.hostId || "Host", to: { kind: "cluster", hostId: route.hostId } },
                        { label: "Configuration" });
                      break;
    case "settings":  trail.push({ label: "Settings", to: { kind: "settings" } }); break;
    default:          break;
  }
  return trail;
}

function Breadcrumb({ route, ctx, onNavigate }) {
  const trail = breadcrumbTrail(route, ctx);
  return (
    <div className="content__breadcrumb">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        const clickable = !last && !!c.to;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: "var(--fg-4)" }}>/</span>}
            <span
              style={{
                color: last ? "var(--fg-1)" : "var(--fg-3)",
                fontWeight: last ? 600 : 500,
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={clickable ? () => onNavigate(c.to) : undefined}>
              {c.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export { Breadcrumb };

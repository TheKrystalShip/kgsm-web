// Breadcrumb — a projection of the resolved route + the policy. The root
// "Home" crumb appears only when the persona can reach the dashboard.

import React from "react";
import { can } from "../lib/persona.js";

function breadcrumbTrail(route, ctx) {
  const trail = [];
  if (can("nav.dashboard")) trail.push({ label: "Home", kind: "home" });
  switch (route.kind) {
    case "home":      break;
    case "servers":   trail.push({ label: "Servers", kind: "servers" }); break;
    case "server":    trail.push({ label: "Servers", kind: "servers" }, { label: ctx.serverName || "Server" }); break;
    case "library":   trail.push({ label: ctx.catalogLabel }); break;
    case "game":      trail.push({ label: ctx.catalogLabel, kind: "library" }, { label: ctx.gameName || "Game" }); break;
    case "attention": trail.push({ label: "Alerts" }); break;
    case "audit":     trail.push({ label: "Audit log" }); break;
    case "fleet":     route.hostId
                        ? trail.push({ label: "Fleet", kind: "fleet" }, { label: ctx.hostName || "Host" })
                        : trail.push({ label: "Fleet" });
                      break;
    case "discord":   trail.push({ label: "Discord" }); break;
    case "settings":  trail.push({ label: "Settings" }); break;
    case "chat":      trail.push({ label: "Assistant" }); break;
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
        const clickable = !last && !!c.kind;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: "var(--fg-4)" }}>/</span>}
            <span
              style={{
                color: last ? "var(--fg-1)" : "var(--fg-3)",
                fontWeight: last ? 600 : 500,
                cursor: clickable ? "pointer" : "default",
              }}
              onClick={clickable ? () => onNavigate({ kind: c.kind }) : undefined}>
              {c.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export { Breadcrumb };

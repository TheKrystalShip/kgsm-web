import React from "react";
import { icons } from "lucide-react";

// Icon — wraps lucide-react so the rest of the app keeps using kebab-case names
// (e.g. <Icon name="rotate-cw" />), exactly as the prototype did. That means
// every existing `<Icon name="…" />` call site ports over with zero changes.
//
// lucide-react ships each icon as a PascalCase component plus an `icons` map.
// We convert the kebab name and look it up; unknown names render an empty,
// correctly-sized box so layout never jumps.
const toPascal = (name) =>
  String(name || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

// lucide renamed several icons since the prototype's CDN build. Map the old
// kebab names the app uses to their current lucide-react components so call
// sites stay unchanged.
const ALIASES = {
  "alert-triangle": "TriangleAlert",
  "help-circle": "CircleHelp",
  home: "House",
  "line-chart": "ChartLine",
  "loader-2": "LoaderCircle",
  "terminal-square": "SquareTerminal",
};

export function Icon({ name, size = 18, strokeWidth = 1.7, className, style }) {
  const Cmp = icons[ALIASES[name] || toPascal(name)];
  const base = { display: "inline-flex", ...(style || {}) };
  if (!Cmp) {
    if (import.meta.env.DEV && name) console.warn(`[Icon] unknown lucide icon: "${name}"`);
    return <span className={className} style={{ ...base, width: size, height: size }} aria-hidden="true" />;
  }
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={base} aria-hidden="true" />;
}

export default Icon;

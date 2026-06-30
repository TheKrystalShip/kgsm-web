import React from "react";
import { Icon } from "./Icon.jsx";

// The one styled <select> for the whole app. appearance:none + a custom chevron so
// the control reads identically across browsers/OSes — the native OS arrow is what
// made every ad-hoc <select> look different. Extra props spread straight onto the
// native <select>, so value / onChange(event) / disabled / aria-* behave exactly like
// a plain select. Children are the <option> elements (callers map their own list).
//
//   variant="field" (default) — full-width form field: install modal, settings,
//                                host & leaf config. 38px tall.
//   variant="chip"            — compact inline source picker for card headers
//                                (game console + host logs).
export function Select({ variant = "field", className = "", children, ...rest }) {
  return (
    <span className={"k-select k-select--" + variant + (className ? " " + className : "")}>
      <select className="k-select__el" {...rest}>{children}</select>
      <Icon name="chevron-down" size={variant === "chip" ? 13 : 16} className="k-select__chev" />
    </span>
  );
}

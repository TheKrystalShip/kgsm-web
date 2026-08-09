import { Icon } from "./Icon.jsx";
import { themeStore, useThemePref, THEME_OPTS } from "../lib/theme.js";

// ThemePicker — the themes as swatches, grouped by the light or dark they are.
//
// Each swatch paints itself IN the theme it offers. `tokens.css` keys every colour off a plain
// `[data-theme="…"]` attribute selector rather than `:root[data-theme]`, so the attribute works on
// any element: a preview tile carrying it resolves that palette's own tokens and its children
// inherit them. So a swatch is never a hand-picked colour list that drifts when a palette is
// retuned — it is the palette, rendered small. Add a theme to `tokens.css` + `THEME_OPTS` and its
// swatch is correct with no work here.
//
// The tile is a miniature of the app it is previewing — canvas, a bar, a card on it, an accent mark
// and two lines of text — because what somebody is choosing between is how the PANEL will look, and
// four bare colour chips do not answer that.
//
// The label sits OUTSIDE the tile, so it renders in the theme currently applied and stays readable
// whatever palette the tile is painting.
//
// Switching is live and instant (`themeStore.set` re-cascades `<html data-theme>`), so there is no
// apply step and nothing to confirm — clicking a swatch IS the preview.
function ThemePicker() {
  const pref = useThemePref();
  const groups = [
    { mode: "dark", label: "Dark" },
    { mode: "light", label: "Light" },
  ];

  return (
    <div className="theme-picker">
      {/* Auto first and on its own: it is not a palette, it is a rule about which of the two to
          follow, so it neither belongs in a group nor sorts among them. Its tile shows both halves
          because both are what it means. */}
      <div className="theme-picker__grid">
        <ThemeSwatch opt={THEME_OPTS.find((o) => o.id === "auto")} selected={pref === "auto"} />
      </div>

      {groups.map((g) => (
        <div key={g.mode}>
          <div className="theme-picker__group">{g.label}</div>
          <div className="theme-picker__grid">
            {THEME_OPTS.filter((o) => o.mode === g.mode).map((o) => (
              <ThemeSwatch key={o.id} opt={o} selected={pref === o.id} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ThemeSwatch({ opt, selected }) {
  const isAuto = opt.id === "auto";
  return (
    <button
      type="button"
      className={"theme-swatch" + (selected ? " theme-swatch--on" : "")}
      aria-pressed={selected}
      title={opt.label}
      onClick={() => themeStore.set(opt.id)}
    >
      <span className="theme-swatch__tile">
        {isAuto
          ? (
            <>
              <span className="theme-swatch__half theme-swatch__half--first"><Mini theme="dark" /></span>
              <span className="theme-swatch__half"><Mini theme="light" /></span>
            </>
          )
          : <Mini theme={opt.id} />}
        {selected && (
          <span className="theme-swatch__check"><Icon name="check" size={12} strokeWidth={3} /></span>
        )}
      </span>
      <span className="theme-swatch__label">{opt.label}</span>
    </button>
  );
}

// The miniature. Everything inside resolves against the `data-theme` on this element, so every
// value here is a token and none is a literal.
function Mini({ theme }) {
  return (
    <span className="theme-mini" data-theme={theme}>
      <span className="theme-mini__bar" />
      <span className="theme-mini__card">
        <span className="theme-mini__dot" />
        <span className="theme-mini__lines">
          <span className="theme-mini__line" />
          <span className="theme-mini__line theme-mini__line--dim" />
        </span>
      </span>
    </span>
  );
}

export { ThemePicker };

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
// `compact` shrinks the tiles for the standalone assistant's 240px conversation rail. It changes
// nothing about what a tile contains — the same miniature, smaller — because a rail that offered a
// reduced set of themes, or told you less about each one, would be the surface where the picker
// matters MOST answering with less: the standalone assistant has no Settings page behind it.
// Two packs get their OWN section rather than being folded into Dark and Light, because somebody
// arrives at this picker on one of three errands: wanting a look, wanting a particular screen
// quoted back at them, or needing a palette they can read. Mixed into one grid of thirty-odd, the
// palettes built for a deficiency would only be findable by knowing their names already, and the
// tributes would read as more editor colour schemes. Each section carries a sentence, because
// neither "LCARS" nor "Deuteranopia Dark" explains itself from the label.
//
// The colour-vision tiles are badged as well as grouped — the section heading is not always in
// view, the assistant's rail scrolls, and the badge is what identifies one of those on its own.
// The tributes are not: which screen a palette is quoting is decoration, and a mark on every
// second tile would cost the grid more than it tells anyone.
//
// The tributes are also the only themes that re-value STRUCTURE — corners, border weight,
// elevation, the UI font, transition durations — so the section says so in its note and each
// tile's tooltip carries the `shape` sentence under the `tribute` one. The miniature shows it
// too, without any help: it is built from the same tokens, so an LCARS tile is visibly rounder
// and a Windows 95 tile visibly squarer than the palette alone would make it.
function ThemePicker({ compact = false }) {
  const pref = useThemePref();
  const groups = [
    { mode: "dark", label: "Dark" },
    { mode: "light", label: "Light" },
  ];
  const tributes = THEME_OPTS.filter((o) => o.tribute);
  const cvd = THEME_OPTS.filter((o) => o.cvd);

  return (
    <div className={"theme-picker" + (compact ? " theme-picker--compact" : "")}>
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
            {THEME_OPTS.filter((o) => o.mode === g.mode && !o.cvd && !o.tribute).map((o) => (
              <ThemeSwatch key={o.id} opt={o} selected={pref === o.id} />
            ))}
          </div>
        </div>
      ))}

      <div>
        <div className="theme-picker__group">Tributes</div>
        <p className="theme-picker__note">
          Palettes borrowed from screens you have already stared at. These are the only themes
          that change the panel&rsquo;s shape as well as its colours &mdash; corners, borders and
          how fast things move. Hover one to see what it is quoting.
        </p>
        <div className="theme-picker__grid">
          {tributes.map((o) => (
            <ThemeSwatch key={o.id} opt={o} selected={pref === o.id} />
          ))}
        </div>
      </div>

      <div>
        <div className="theme-picker__group">Colour-vision friendly</div>
        <p className="theme-picker__note">
          Status colours held apart under a simulation of each deficiency, so running, warning
          and down never collapse into one another.
        </p>
        <div className="theme-picker__grid">
          {cvd.map((o) => (
            <ThemeSwatch key={o.id} opt={o} selected={pref === o.id} />
          ))}
        </div>
      </div>
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
      title={
        opt.cvd
          ? `${opt.label} — for ${opt.cvd}`
          : opt.tribute
            ? `${opt.tribute}${opt.shape ? `\n${opt.shape}` : ""}`
            : opt.label
      }
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
        {opt.cvd && (
          <span className="theme-swatch__badge"><Icon name="eye" size={10} strokeWidth={2.4} /></span>
        )}
        {selected && (
          <span className="theme-swatch__check"><Icon name="check" size={12} strokeWidth={3} /></span>
        )}
      </span>
      <span className="theme-swatch__label">{opt.label}</span>
    </button>
  );
}

// The miniature — the panel itself, shrunk: the sidebar with its brand mark and nav, a heading, the
// dashboard's KPI strip with its status lights, and a card below it. Recognisable on purpose, so
// what a swatch shows is the thing being chosen rather than an abstract set of chips.
//
// It is also what makes a swatch informative. A palette is not one colour: the tiles differ in how
// the rail sits against the canvas, how much a card lifts off it, whether the status lights read at
// a glance. Two chips cannot show any of that; this shows all of it, and shows the colours in the
// relationships they are actually used in.
//
// Everything inside resolves against the `data-theme` on this element, so every value below is that
// palette's own token and none is a literal.
function Mini({ theme }) {
  return (
    <span className="theme-mini" data-theme={theme}>
      <span className="theme-mini__rail">
        <span className="theme-mini__brand" />
        <span className="theme-mini__nav" />
        <span className="theme-mini__nav" />
        <span className="theme-mini__nav" />
      </span>
      <span className="theme-mini__main">
        <span className="theme-mini__title" />
        <span className="theme-mini__kpis">
          <span className="theme-mini__kpi"><span className="theme-mini__led theme-mini__led--ok" /></span>
          <span className="theme-mini__kpi"><span className="theme-mini__led theme-mini__led--warn" /></span>
          <span className="theme-mini__kpi"><span className="theme-mini__led theme-mini__led--bad" /></span>
        </span>
        <span className="theme-mini__card">
          <span className="theme-mini__dot" />
          <span className="theme-mini__lines">
            <span className="theme-mini__line" />
            <span className="theme-mini__line theme-mini__line--dim" />
          </span>
        </span>
      </span>
    </span>
  );
}

export { ThemePicker };

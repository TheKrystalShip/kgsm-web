import { Icon } from "./Icon.jsx";

// SubTabs — the shared in-page section switcher (desktop button strip + a mobile
// <select>). Used by the server-detail tabs (App.jsx) and the host diagnostics
// deep-dive (DiagnosticsPage.jsx). Lives here, not inlined in either, so the two
// can't drift and neither has to import the other (the diagnostics page is imported
// BY App, so pulling SubTabs from App would be a circular import — this was the
// "SubTabs is not defined" crash the host deep-dive hit once it rendered with
// real telemetry).
export function SubTabs({ tabs, active, onChange }) {
  const current = tabs.find(t => t.id === active) || tabs[0];
  return (
    <>
      <div className="subtabs">
        {tabs.map(t => (
          <button key={t.id}
            className={"subtab" + (t.id === active ? " subtab--active" : "")}
            onClick={() => onChange(t.id)}>
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.badge > 0 && <span className={"subtab__badge subtab__badge--" + (t.badgeTone || "info")}>{t.badge}</span>}
          </button>
        ))}
      </div>
      <label className="subtabs-mobile" aria-label="Section">
        <Icon name={current.icon} size={16} />
        <span className="subtabs-mobile__label">{current.label}</span>
        <select value={active} onChange={e => onChange(e.target.value)}>
          {tabs.map(t => (
            <option key={t.id} value={t.id}>{t.label}{t.badge ? " · " + t.badge + " alert" + (t.badge === 1 ? "" : "s") : ""}</option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </label>
    </>
  );
}

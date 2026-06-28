import React from "react";
import { Icon } from "./Icon.jsx";
import { can } from "../lib/persona.js";
import { fmtFootprintMb, offeringHosts } from "../pages/LibraryPage.jsx";
import { Toggle } from "../pages/ServerSettings.jsx";

// InstallModal — overlay form for spinning up a new game server.
// Props:
//   game     — catalog entry from the library store (name, art, rawg_slug…)
//   onClose  — () => void
//   onInstall — (config) => void   // called when user confirms

// Standard build channels — offered until the backend reports per-game versions.
const VERSION_OPTIONS = [
  { value: "stable",      label: "Latest stable" },
  { value: "beta",        label: "Public beta" },
  { value: "experimental", label: "Experimental" },
];

function shortId() {
  return Math.random().toString(36).slice(2, 9);
}

function InstallModal({ game, onClose, onInstall, hosts = [], defaultHostId = null }) {
  const id = React.useMemo(shortId, []);
  // Seed the form from the backend blueprint DTO — never a hardcoded per-game
  // map. `ports` is served today so the game port pre-fills for real; the query
  // port has no honest blueprint designation (left blank/optional) and max
  // players comes from `specs.maxPlayers` (null today → blank). The install dir
  // is just a suggested name derived from the blueprint id. (kgsm assigns the
  // real ports/dir at install time — only `blueprint`+`name` reach the API.)
  const defaultPort = (game.ports && game.ports[0] && game.ports[0].start) || "";
  const defaultSlots = (game.specs && game.specs.maxPlayers != null) ? game.specs.maxPlayers : "";
  // Only hosts that OFFER this blueprint can install it. Absent game.hosts =
  // every host offers it (the common case). The catalog is the union across
  // the fleet, so a game added by one host alone is installable only there.
  const offered = offeringHosts ? offeringHosts(game, hosts) : hosts;
  const restricted = offered.length > 0 && offered.length < hosts.length;
  // Default to the requested host only if it actually offers the game.
  const initialHost = (offered.some(h => h.id === defaultHostId) ? defaultHostId : null)
    || (offered.find(h => h.online) || offered[0] || {}).id || null;
  const [form, setForm] = React.useState({
    name:    `My ${game.name.split(":")[0]} Server`,
    version: "stable",
    hostId:  initialHost,
    port:    defaultPort,
    query:   "",
    slots:   defaultSlots,
    password: "",
    autostart: true,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  // Reveal-password toggle for the (optional) server password field.
  const [showPw, setShowPw] = React.useState(false);

  // The install directory is PER HOST — each box runs its own KGSM with its own config. Derive it from the
  // currently-selected host so switching host in a multi-host setup instantly reflects that host's default
  // (the value is already on the host object — no extra fetch). null when the host didn't report one.
  const selectedHost = offered.find(h => h.id === form.hostId) || null;
  const installDir = (selectedHost && selectedHost.installDirectory) || null;

  // Close on ESC.
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // If the offering changes while the modal is open (a host syncs its catalog)
  // and the picked host no longer offers the game, fall back to a valid one.
  const offeredIds = offered.map(h => h.id).join(",");
  React.useEffect(() => {
    if (form.hostId && !offered.some(h => h.id === form.hostId)) {
      set("hostId", (offered.find(h => h.online) || offered[0] || {}).id || null);
    }
  }, [offeredIds]);

  const submit = (e) => {
    e.preventDefault();
    onInstall({ game, ...form, id });
  };

  // Cover art comes from the backend on the catalog entry (game.cover); falls
  // back to the themed gradient. See architecture.html §3·i.
  const cover = game.cover || null;
  const artBg = cover
    ? `linear-gradient(to bottom, rgba(11,15,20,0.2) 0%, var(--surface-1) 100%), url("${cover}")`
    : game.art;

  return (
    <div className="k-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="k-modal" onSubmit={submit}>
        <div className="k-modal__art" style={{ backgroundImage: artBg, backgroundSize: "cover", backgroundPosition: "center" }}></div>
        <div className="k-modal__head">
          <Icon name="download" size={18} style={{ color: "var(--krystal-teal)" }} />
          <span className="k-modal__title">Install {game.name}</span>
          <button type="button" className="k-modal__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="k-modal__sub">
          Krystal will download the server build, allocate ports, and write a starter config you can edit later.
        </div>

        <div className="k-modal__body">
          {offered.length > 0 && (
            <div className="k-field">
              <label>Host</label>
              <select value={form.hostId || ""} onChange={e => set("hostId", e.target.value)} disabled={offered.length <= 1}>
                {offered.map(h => <option key={h.id} value={h.id}>{h.name} — {h.hostname}{h.online ? "" : " (offline)"}</option>)}
              </select>
              <span className="k-field__help">
                {restricted
                  ? <><Icon name="server" size={11} />&nbsp; Only {offered.map(h => h.name).join(", ")} {offered.length === 1 ? "offers" : "offer"} {game.name.split(":")[0]}.</>
                  : offered.length <= 1 ? "The only connected host — its KGSM defaults fill the fields below." : "Which machine this server runs on — its KGSM config supplies the defaults below."}
              </span>
            </div>
          )}

          <div className="k-field">
            <label>Server name</label>
            <input value={form.name} onChange={e => set("name", e.target.value)} autoFocus />
            <span className="k-field__help">Shown in the sidebar and Discord notifications.</span>
          </div>

          <div className="k-field">
            <label>Version</label>
            <select value={form.version} disabled>
              {VERSION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="k-field__help">Version selection isn't available yet — the latest build is installed.</span>
          </div>

          <div className="k-field__row">
            <div className="k-field">
              <label>Game port</label>
              <input type="number" className="mono" value={form.port} onChange={e => set("port", +e.target.value)} />
            </div>
            <div className="k-field">
              <label>Query port <small>(optional)</small></label>
              <input type="number" className="mono" value={form.query} placeholder="—" onChange={e => set("query", e.target.value ? +e.target.value : "")} />
            </div>
          </div>

          <div className="k-field__row">
            <div className="k-field">
              <label>Max players</label>
              <input type="number" className="mono" value={form.slots} onChange={e => set("slots", +e.target.value)} />
            </div>
            <div className="k-field">
              <label>Password <small>(optional)</small></label>
              <div className="k-input-affix">
                <input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  placeholder="leave blank for open"
                  onChange={e => set("password", e.target.value)} />
                <button
                  type="button"
                  className="k-input-affix__btn"
                  tabIndex={-1}
                  onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  title={showPw ? "Hide password" : "Show password"}>
                  <Icon name={showPw ? "eye-off" : "eye"} size={15} />
                </button>
              </div>
            </div>
          </div>

          <div className="k-field">
            <label>Install directory</label>
            <input className="mono" value={installDir || ""} placeholder="Set by this host's KGSM config" readOnly />
            <span className="k-field__help">
              {installDir
                ? <>From {selectedHost ? selectedHost.name : "the host"}'s KGSM config. Installs under <code style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>{installDir}/{game.id}/</code>.</>
                : "This host's KGSM hasn't reported a default install directory."}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 6px" }}>
            <Toggle on={form.autostart} onChange={v => set("autostart", v)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--fg-1)", fontSize: 13.5, fontWeight: 500 }}>Start immediately after install</span>
              <span style={{ color: "var(--fg-3)", fontSize: 12 }}>Otherwise it'll sit at "offline" until you hit Start.</span>
            </div>
          </div>
        </div>

        <div className="k-modal__foot">
          <span style={{ flex: 1, color: "var(--fg-3)", fontSize: 12 }}>
            <Icon name="hard-drive" size={12} />&nbsp;
            {game.specs && game.specs.baseDiskMb != null
              ? <>~{fmtFootprintMb(game.specs.baseDiskMb)} download</>
              : "Download size unknown"}
          </span>
          <button type="button" className="icon-btn" style={{ width: "auto", padding: "0 14px", fontSize: 13, fontWeight: 600, height: 38 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="fb-editor__btn" style={{ height: 38, padding: "0 18px" }}>
            <Icon name="download" size={14} strokeWidth={2.2} />&nbsp;Install
          </button>
        </div>
      </form>
    </div>
  );
}

export { InstallModal };

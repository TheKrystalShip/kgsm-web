// DiagResources — the Resources sub-tab: CPU core grid, RAM bar, disk list,
// network interface table, open-ports table. Pure render from props — no hooks,
// no stores.

import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { StatusLed } from "./diagComponents.jsx";

function DiagResources({ host, fresh, servers = [], onOpenServerSettings }) {
  const frozen = !!(fresh && fresh.frozen);
  const noTelemetry = !host.cpu || !Array.isArray(host.cpu.per_core) || host.cpu.per_core.length === 0 || !host.ram || !host.ram.total_gb;
  if (noTelemetry) {
    return (
      <div className="diag-empty">
        <Icon name="activity" size={18} strokeWidth={1.8} />
        <p>Live metrics are unavailable on this host{fresh && fresh.message ? " \u2014 " + fresh.message : "."}</p>
        <p className="diag-empty__sub">CPU, memory, disk and network telemetry need the host's metrics agent to be running.</p>
      </div>
    );
  }
  const ageShort = fresh && fresh.label ? fresh.label.replace(/\s*ago$/, "") : null;
  const ramPct = Math.round((host.ram.used_gb / host.ram.total_gb) * 100);
  const hasBreakdown = host.ram.cached_gb != null && host.ram.buffers_gb != null;
  const cachedPct = hasBreakdown ? (host.ram.cached_gb / host.ram.total_gb) * 100 : 0;
  const bufPct = hasBreakdown ? (host.ram.buffers_gb / host.ram.total_gb) * 100 : 0;
  const serverName = (id) => (servers.find(s => s.id === id) || {}).name || id;
  const portExposure = (p) => p.exposure || (p.app === "sshd" ? "lan" : "public");
  const PORT_COLS = "92px minmax(110px, 1fr) minmax(150px, 1.4fr) 104px 18px";
  return (
    <>
      <div className="diag-2col">
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="cpu" size={13} /> CPU
              <span className="chat-brief__count chat-brief__count--neutral">{host.cpu.cores} cores</span>
            </span>
            <span className="diag-meta-line">{host.cpu.model}</span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="core-grid" style={{ "--core-count": host.cpu.per_core.length }}>
              {host.cpu.per_core.map((pct, i) => (
                <div key={i} className="core-cell" title={"core " + i + ": " + pct + "%"}>
                  <div className="core-cell__bar"><i style={{ height: pct + "%", background: pct > 80 ? "var(--danger)" : pct > 60 ? "var(--warning)" : "var(--krystal-teal)" }}></i></div>
                  <span className="core-cell__lbl">{i}</span>
                </div>
              ))}
            </div>
            <div className="diag-meta-line" style={{ marginTop: 14 }}>
              load 1m / 5m / 15m: <b>{host.cpu.load_avg[0].toFixed(1)}</b> · <b>{host.cpu.load_avg[1].toFixed(1)}</b> · <b>{host.cpu.load_avg[2].toFixed(1)}</b>
            </div>
          </div>
        </div>

        <div className={"chat-brief" + (frozen ? " is-frozen" : "")}>
          <div className="chat-brief__head">
            <span className="chat-brief__title">
              <Icon name="memory-stick" size={13} /> Memory
              <span className="chat-brief__count chat-brief__count--neutral">{host.ram.total_gb} GB</span>
            </span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="ram-bar">
              <div className="ram-bar__seg" style={{ width: (ramPct - cachedPct - bufPct) + "%", background: "var(--krystal-teal)" }}></div>
              <div className="ram-bar__seg" style={{ width: cachedPct + "%",                       background: "var(--info)" }}></div>
              <div className="ram-bar__seg" style={{ width: bufPct + "%",                          background: "var(--update)" }}></div>
            </div>
            <div className="ram-legend">
              <span><span className="swatch" style={{ background: "var(--krystal-teal)" }}></span>used <b>{host.ram.used_gb.toFixed(1)} GB</b></span>
              {hasBreakdown && <span><span className="swatch" style={{ background: "var(--info)" }}></span>cached <b>{host.ram.cached_gb.toFixed(1)} GB</b></span>}
              {hasBreakdown && <span><span className="swatch" style={{ background: "var(--update)" }}></span>buffers <b>{host.ram.buffers_gb.toFixed(1)} GB</b></span>}
              <span><span className="swatch" style={{ background: "var(--surface-3)" }}></span>free <b>{host.ram.free_gb.toFixed(1)} GB</b></span>
            </div>
            <div className="diag-meta-line" style={{ marginTop: 14 }}>
              swap: <b>{host.ram.swap_used_gb} / {host.ram.swap_total_gb} GB</b>
              {host.ram.swap_used_gb / host.ram.swap_total_gb > 0.3 && (
                <span style={{ color: "var(--warning-fg)", marginLeft: 10 }}>↑ rising — investigate</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Disks */}
      {host.disks && host.disks.length > 0 && (
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")} style={{ marginTop: 16 }}>
          <div className="chat-brief__head">
            <span className="chat-brief__title"><Icon name="database" size={13} /> Disk{host.disks.length > 1 ? "s" : ""}</span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="disk-list">
              {host.disks.map((d, i) => {
                const pct = d.total_gb > 0 ? (d.used_gb / d.total_gb) * 100 : 0;
                return (
                  <div className="disk-row" key={i}>
                    <span className="disk-row__mount">{d.mount}</span>
                    <div className="disk-row__bar"><div className="disk-row__fill" style={{ width: pct + "%" }}></div></div>
                    <span className="disk-row__pct">{Math.round(pct)}%</span>
                    <span className="disk-row__size">{d.used_gb} / {d.total_gb} GB</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Network interfaces */}
      {host.network && host.network.interfaces && host.network.interfaces.length > 0 && (
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")} style={{ marginTop: 16 }}>
          <div className="chat-brief__head">
            <span className="chat-brief__title"><Icon name="network" size={13} /> Network</span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="net-iface-grid">
              {host.network.interfaces.map((iface, i) => (
                <div className="net-iface" key={i}>
                  <span className="net-iface__name">{iface.name}</span>
                  <span className="net-iface__speed">{iface.speed_mbps ? iface.speed_mbps + " Mbps" : "\u2014"}</span>
                  <span className="net-iface__rx"><Icon name="arrow-down" size={11} /> {iface.rx_kbps || 0} kbps</span>
                  <span className="net-iface__tx"><Icon name="arrow-up" size={11} /> {iface.tx_kbps || 0} kbps</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Open ports */}
      {host.network && host.network.open_ports && host.network.open_ports.length > 0 && (
        <div className={"chat-brief" + (frozen ? " is-frozen" : "")} style={{ marginTop: 16 }}>
          <div className="chat-brief__head">
            <span className="chat-brief__title"><Icon name="door-open" size={13} /> Open ports</span>
            <StatusLed live={!frozen} label={frozen ? ageShort : null} />
          </div>
          <div className="chat-brief__pad">
            <div className="port-grid" style={{ gridTemplateColumns: PORT_COLS }}>
              <span className="port-grid__head">Port</span>
              <span className="port-grid__head">Protocol</span>
              <span className="port-grid__head">Owner</span>
              <span className="port-grid__head">Exposure</span>
              <span></span>
              {host.network.open_ports.map((p, i) => (
                <React.Fragment key={i}>
                  <span className="port-grid__cell">{p.port}</span>
                  <span className="port-grid__cell">{p.proto || "tcp"}</span>
                  <span className="port-grid__cell">{p.server ? serverName(p.server) : "\u2014"}</span>
                  <span className={"port-grid__cell port-grid__cell--" + portExposure(p)}>{portExposure(p)}</span>
                  <span className="port-grid__cell">
                    {p.server && onOpenServerSettings && (
                      <button className="port-grid__go" onClick={() => onOpenServerSettings(p.server)} title="Open server settings">
                        <Icon name="arrow-right" size={12} strokeWidth={2.2} />
                      </button>
                    )}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { DiagResources };

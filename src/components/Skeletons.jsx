// Skeletons.jsx — loading placeholders for the data-heavy surfaces.
//
// Rule: a skeleton occupies the SAME footprint the real content will, so the
// page settles in place when data arrives (zero layout shift). We reuse the
// real grid containers (.game-grid, .server-grid, .fleet-grid, .dash-summary,
// .audit-row…) so columns + gaps are identical; only the item internals are
// placeholder blocks. Static chrome (page titles) is NOT skeletonized — it
// renders immediately so the user can orient. Counts that depend on data show
// a placeholder, never a wrong "0".
//
// Shown whenever a surface's store status === "loading" — naturally on Refresh
// and reconnect re-hydration, and on demand via the ?dev "Slow network" toggle
// (or ?slow=1). Shimmer respects prefers-reduced-motion (see kit.css).

function Skel({ w = "100%", h = 12, r = 6, style = {} }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}
function srange(n) { return Array.from({ length: n }, (_, i) => i); }

// ---- Item skeletons (mirror one real card/row) ----
function ServerTileSkeleton() {
  return (
    <div className="skel-card">
      <div className="skel-card__art" style={{ height: 88 }}></div>
      <div style={{ padding: "14px 16px" }}>
        <div className="skel-row"><Skel w="52%" h={15} /><Skel w={58} h={20} r={999} /></div>
        <div className="skel-row" style={{ marginTop: 14, gap: 14, justifyContent: "flex-start" }}>
          <Skel w={44} h={11} /><Skel w={44} h={11} /><Skel w={58} h={11} />
        </div>
        <div className="skel-row" style={{ marginTop: 16, gap: 8 }}>
          <Skel w="33%" h={32} r={8} /><Skel w="33%" h={32} r={8} /><Skel w="33%" h={32} r={8} />
        </div>
      </div>
    </div>
  );
}

function GameCardSkeleton() {
  return (
    <div className="skel-card">
      <div className="skel-card__art" style={{ aspectRatio: "16 / 10" }}></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, padding: "14px 14px 0" }}>
        {srange(3).map(i => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Skel w={44} h={12} /><Skel w={32} h={9} />
          </div>
        ))}
      </div>
      <div className="skel-row" style={{ padding: "12px 14px", marginTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
        <Skel w={84} h={11} /><Skel w={56} h={11} />
      </div>
    </div>
  );
}

function FleetCardSkeleton() {
  return (
    <div className="skel-card" style={{ padding: 18 }}>
      <div className="skel-row"><Skel w={132} h={15} /><Skel w={40} h={18} r={999} /></div>
      <Skel w={168} h={11} style={{ marginTop: 12 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
        {srange(3).map(i => (
          <div key={i}><Skel w="58%" h={10} /><Skel w="100%" h={6} r={999} style={{ marginTop: 8 }} /></div>
        ))}
      </div>
      <div className="skel-row" style={{ marginTop: 18, gap: 14, justifyContent: "flex-start" }}>
        {srange(4).map(i => <Skel key={i} w={50} h={10} />)}
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="skel-card" style={{ padding: "14px 16px" }}>
      <Skel w="52%" h={11} />
      <Skel w="38%" h={26} r={8} style={{ marginTop: 18 }} />
      <Skel w="72%" h={11} style={{ marginTop: 14 }} />
    </div>
  );
}

// ---- Page skeletons (compose the above into each surface's layout) ----
function ServersSkeleton() {
  return (
    <>
      <div className="skel-toolbar">
        <Skel w="44%" h={38} r={8} /><span style={{ flex: 1 }}></span>
        <Skel w={118} h={32} r={8} /><Skel w={130} h={32} r={8} />
      </div>
      <div className="server-grid server-grid--page">{srange(6).map(i => <ServerTileSkeleton key={i} />)}</div>
    </>
  );
}

function LibrarySkeleton() {
  return (
    <>
      <div className="skel-toolbar">
        <Skel w="42%" h={38} r={8} /><span style={{ flex: 1 }}></span>
        <Skel w={210} h={32} r={8} /><Skel w={90} h={32} r={8} />
      </div>
      <div className="game-grid">{srange(8).map(i => <GameCardSkeleton key={i} />)}</div>
    </>
  );
}

function AuditSkeleton() {
  return (
    <>
      <div className="skel-toolbar">
        <Skel w="34%" h={38} r={8} /><Skel w={120} h={32} r={8} /><Skel w={120} h={32} r={8} />
        <span style={{ flex: 1 }}></span><Skel w={150} h={28} r={8} />
      </div>
      <div className="audit-timeline">
        <section className="audit-group">
          <Skel w={96} h={12} style={{ margin: "8px 4px 6px" }} />
          <div className="audit-group__events">
            {srange(8).map(i => (
              <div className="audit-row" key={i}>
                <Skel w={28} h={28} r={999} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                  <Skel w="58%" h={13} />
                  <div className="skel-row" style={{ gap: 8, justifyContent: "flex-start" }}>
                    <Skel w={94} h={16} r={999} /><Skel w={62} h={16} r={999} />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                  <Skel w={42} h={11} /><Skel w={34} h={10} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function FleetSkeleton() {
  return (
    <>
      <div className="fleet-summary">
        {srange(4).map(i => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skel w={42} h={22} /><Skel w={48} h={10} />
          </div>
        ))}
        <span style={{ flex: 1 }}></span><Skel w={260} h={13} />
      </div>
      <div className="skel-toolbar"><Skel w="60%" h={38} r={8} /><span style={{ flex: 1 }}></span><Skel w={120} h={20} r={6} /></div>
      <div className="fleet-grid">{srange(3).map(i => <FleetCardSkeleton key={i} />)}</div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="dash-summary">{srange(4).map(i => <KpiSkeleton key={i} />)}</div>
      <div className="skel-card" style={{ padding: 18 }}>
        <div className="skel-row"><Skel w={150} h={14} /><Skel w={72} h={12} /></div>
        <Skel w="100%" h={52} r={8} style={{ marginTop: 16 }} />
      </div>
      <div className="dash-feed">
        {srange(2).map(i => (
          <div className="skel-card" key={i} style={{ padding: 16 }}>
            <Skel w="42%" h={13} />
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {srange(3).map(j => (
                <div className="skel-row" key={j} style={{ gap: 10, justifyContent: "flex-start" }}>
                  <Skel w={28} h={28} r={999} />
                  <div style={{ flex: 1 }}><Skel w="78%" h={12} /><Skel w="38%" h={10} style={{ marginTop: 6 }} /></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="skel-card" style={{ padding: 16 }}>
        <Skel w="28%" h={13} />
        <div className="server-grid" style={{ marginTop: 14 }}>{srange(3).map(i => <ServerTileSkeleton key={i} />)}</div>
      </div>
    </>
  );
}

export { AuditSkeleton, DashboardSkeleton, FleetCardSkeleton, FleetSkeleton, GameCardSkeleton, KpiSkeleton, LibrarySkeleton, ServerTileSkeleton, ServersSkeleton, Skel };

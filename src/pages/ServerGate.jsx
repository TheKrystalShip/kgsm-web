import { Icon } from "../components/Icon.jsx";

// ServerGate — the async-state gate for the server-detail route. `serverForRender`
// is legitimately null in three non-crash cases: the servers store is still on its
// first fetch (a deep-link / hard refresh lands here before it resolves), that
// first fetch FAILED, or the store is loaded but no server carries this id. We
// discriminate them off the store's own state machine and render an honest
// loading / error / not-found surface — NEVER ServerDetailPage with a null server,
// whose every child dereferences `server.*` and would throw into the content
// boundary (the crash this replaces). `everLoaded` is the real "first fetch
// finished" signal: a warm refresh preserves the list, so a null past everLoaded
// is a true 404, not a transient.
function ServerGate({ id, status, everLoaded, onBack, onRetry }) {
  const wrap = { textAlign: "center", padding: "64px 0", color: "var(--fg-3)" };
  const title = { marginTop: 12, fontSize: 14, color: "var(--fg-2)", fontWeight: 600 };
  const sub = { fontSize: 12.5, maxWidth: 460, margin: "4px auto 0" };
  if (!everLoaded && status === "error") {
    return (
      <div style={wrap}>
        <Icon name="circle-x" size={26} strokeWidth={1.7} />
        <div style={title}>Couldn't load your servers</div>
        <div style={sub}>The server list didn't load, so this page can't open yet.</div>
        <div style={{ marginTop: 18 }}>
          <button className="chip" onClick={onRetry}><Icon name="rotate-cw" size={14} /> Try again</button>
        </div>
      </div>
    );
  }
  if (!everLoaded) {
    return (
      <div style={wrap}>
        <span style={{ display: "inline-block", animation: "act-spin 1.4s linear infinite" }}>
          <Icon name="loader-2" size={26} strokeWidth={1.7} />
        </span>
        <div style={title}>Loading server…</div>
        <div style={sub}>Fetching this server from its host.</div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <Icon name="server-off" size={26} strokeWidth={1.6} />
      <div style={title}>Server not found</div>
      <div style={sub}>No server with the id "{id}" is on any connected host — it may have been removed, or the link is out of date.</div>
      <div style={{ marginTop: 18 }}>
        <button className="chip" onClick={onBack}><Icon name="arrow-left" size={14} /> Back to servers</button>
      </div>
    </div>
  );
}

export { ServerGate };

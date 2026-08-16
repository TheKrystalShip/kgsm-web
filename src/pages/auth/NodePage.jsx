import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { adoptNode, knownNodes, probeNode } from "../../lib/authFlow.js";
import { normalizeHostUrl } from "../../lib/connect.js";
import { AuthError, AuthShell } from "./AuthChrome.jsx";

// NodePage — which host you are signing in to.
//
// A node is a row: a status dot, the name it calls itself, its region, its address and
// its build. Everything on it comes from ONE anonymous GET /api/v1, which is also the
// reachability probe — so nothing is green because an address was typed in, only because
// something answered as a kgsm-api. A node that does not answer stays on the list with
// its reason and its own Retry; dropping it would read as "I deleted it", which is a
// different and much worse thought than "that one is off right now".
//
// The last row is the way out of the list, shaped like a node so the whole set reads as
// one choice. With an empty registry there is no list and that form IS the screen.

function NodeRow({ node, selected, onPick, onRetry }) {
  if (node.probing) {
    return (
      <div className="nodepick__row is-down">
        <span className="svc-dot svc-dot--probing" />
        <span className="nodepick__id">
          <span className="nodepick__name">{node.name || node.origin.replace(/^https?:\/\//, "")}</span>
          <span className="nodepick__meta">{node.origin.replace(/^https?:\/\//, "")}</span>
        </span>
        <span className="nodepick__meta">Checking…</span>
      </div>
    );
  }

  if (!node.reachable) {
    return (
      <div className="nodepick__row is-down">
        <span className="svc-dot svc-dot--down" />
        <span className="nodepick__id">
          <span className="nodepick__name">{node.name || node.origin.replace(/^https?:\/\//, "")}</span>
          <span className="nodepick__why">{node.reason}</span>
        </span>
        <button type="button" className="btn-link" onClick={() => onRetry(node.origin)}>
          <Icon name="rotate-cw" size={13} /> Retry
        </button>
      </div>
    );
  }

  const label = node.label || node.name || node.origin.replace(/^https?:\/\//, "");
  return (
    <button
      type="button"
      className={"nodepick__row" + (selected ? " is-on" : "")}
      onClick={() => onPick(node)}>
      <span className="svc-dot svc-dot--up" />
      <span className="nodepick__id">
        <span className="nodepick__name">
          {label}
          {node.region ? <span className="nodepick__region"><Icon name="globe" size={11} /> {node.region}</span> : null}
        </span>
        <span className="nodepick__meta">
          {node.origin.replace(/^https?:\/\//, "")}{node.build ? ` · kgsm-api ${node.build}` : ""}
        </span>
      </span>
      <span className="nodepick__go"><Icon name="chevron-right" size={17} /></span>
    </button>
  );
}

// The one screen that asks for an address. Everything else on the way in is chosen from
// something a host already told us.
function ConnectForm({ firstRun, onConnected, onCancel }) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const typed = value.trim();
  const looksUsable = !!normalizeHostUrl(typed);

  const connect = async (e) => {
    if (e) e.preventDefault();
    if (!looksUsable || busy) return;
    setBusy(true);
    setError(null);
    const probe = await probeNode(typed);
    setBusy(false);
    if (!probe.reachable) { setError(probe.reason); return; }
    adoptNode(probe);
    onConnected(probe);
  };

  return (
    <>
      <div className="login-card">
        <div className="login-card__heading">{firstRun ? "Connect your first host" : "Connect a host"}</div>
        <div className="login-card__sub">
          A host runs the kgsm-api control panel. Enter its address — we’ll check it’s a kgsm-api and
          remember it on this device.
        </div>

        <AuthError>{error}</AuthError>

        <form className="login-form" onSubmit={connect}>
          <label className="login-form__label" htmlFor="node-address">Host address</label>
          <div className={"addr" + (typed && !looksUsable ? " addr--bad" : "")}>
            <span className="addr__scheme">https://</span>
            <input
              id="node-address"
              value={value}
              onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
              placeholder="127.0.0.1:8097 · your-host.example"
              spellCheck="false" autoCapitalize="off" autoCorrect="off"
              disabled={busy} />
          </div>
          {typed && !looksUsable
            ? <div className="field-note field-note--bad"><Icon name="x" size={13} /> <span>That isn’t a usable address.</span></div>
            : <div className="field-hint">A bare host defaults to <code>https</code>. Add <code>http://</code> for a loopback address.</div>}

          <button type="submit" className="login-form__submit" disabled={!looksUsable || busy}>
            {busy ? (<><span className="oauth-spinner" /> Checking the host…</>) : (<><Icon name="plug" size={16} /> Connect</>)}
          </button>
        </form>

        <div className="login-note">
          <Icon name="shield-check" size={14} />
          <span>Each host issues its own session and checks your role independently — access can differ per host.</span>
        </div>
      </div>

      <div className="foot-row">
        {onCancel
          ? <button type="button" className="btn-link btn-link--quiet" onClick={onCancel}><Icon name="arrow-left" size={13} /> Back to the list</button>
          : <span>Your hosts are remembered on this device.</span>}
      </div>
    </>
  );
}

function NodePage({ onPick, lastOrigin }) {
  const known = React.useMemo(() => knownNodes(), []);
  const [adding, setAdding] = React.useState(known.length === 0);
  const [probes, setProbes] = React.useState(() =>
    known.map(n => ({ origin: n.origin, name: n.name, probing: true })));

  // Probe every known node once on mount. Reachability is measured, never assumed, and
  // the same answer supplies the label and build the row shows — so a row cannot claim
  // to be a node that never spoke.
  const runProbes = React.useCallback((origins) => {
    const targets = origins || known.map(n => n.origin);
    if (!targets.length) return;
    setProbes(prev => prev.map(p => (targets.includes(p.origin) ? { ...p, probing: true } : p)));
    targets.forEach(async (origin) => {
      const result = await probeNode(origin);
      setProbes(prev => prev.map(p => (p.origin === origin ? { ...p, ...result, probing: false } : p)));
    });
    // `known` is captured once from the module-load connection set and never changes
    // within this screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => { runProbes(); }, [runProbes]);

  const settled = probes.filter(p => !p.probing);
  const noneAnswered = probes.length > 0 && settled.length === probes.length && !settled.some(p => p.reachable);

  if (adding) {
    return (
      <AuthShell tagline={known.length ? "Connect another host." : "First, connect to a kgsm-api host."}>
        <ConnectForm
          firstRun={known.length === 0}
          onConnected={onPick}
          onCancel={known.length ? () => setAdding(false) : null} />
      </AuthShell>
    );
  }

  return (
    <AuthShell tagline="Pick the host you’re signing in to.">
      <div className="login-card">
        <div className="login-card__heading">{noneAnswered ? "No host answered" : "Choose a node"}</div>
        <div className="login-card__sub">
          {noneAnswered
            ? "The hosts remembered on this device are all unreachable right now."
            : "Your session is minted by the node you sign in through, and vouches onto the rest of the cluster."}
        </div>

        <div className="nodepick">
          {probes.map(node => (
            <NodeRow
              key={node.origin}
              node={node}
              selected={!!lastOrigin && node.origin === lastOrigin && node.reachable}
              onPick={onPick}
              onRetry={(origin) => runProbes([origin])} />
          ))}
          <button type="button" className="nodepick__add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> Connect a different host
          </button>
        </div>

        {noneAnswered ? (
          <div className="login-note login-note--warn">
            <Icon name="alert-triangle" size={14} />
            <span>
              Nothing here is signed out — these hosts simply aren’t answering. Check they’re running,
              or connect a different one.
            </span>
          </div>
        ) : (
          <div className="login-note">
            <Icon name="shield-check" size={14} />
            <span>Each host issues its own session and checks your role independently — access can differ per host.</span>
          </div>
        )}
      </div>

      <div className="foot-row"><span>Your hosts are remembered on this device.</span></div>
    </AuthShell>
  );
}

export { NodePage };

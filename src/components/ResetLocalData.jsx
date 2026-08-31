import React from "react";

import { Modal } from "./Modal.jsx";
import { SettingsRow } from "./settings-primitives.jsx";
import { clearLocalState } from "../lib/localState.js";

// ResetLocalData — the way out when this browser is holding something wrong.
//
// Stale client state is recoverable by clearing site data, except in the one place people actually
// hit it: an installed app has no address bar and no site-data controls, so the only route left is
// uninstalling it. That is too big a hammer for "the node list is out of date", and it is why this
// is a control rather than a support instruction.
//
// It changes nothing on any node. Everything it clears was this browser's own, which is what makes
// it safe to offer next to a delete that is not.
function ResetLocalData() {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // The reload is the point: half the cleared state is read once at boot, so a live page carrying it
  // in memory would look unchanged and invite a second press.
  const run = () => {
    setBusy(true);
    clearLocalState().then(
      () => window.location.reload(),
      () => window.location.reload());
  };

  return (
    <>
      <SettingsRow icon="eraser" title="Clear local data"
        sub="Everything this browser remembers about Krystal. Nothing on any node changes.">
        <button className="settings-btn-danger" onClick={() => setConfirming(true)}>Clear</button>
      </SettingsRow>

      {confirming && (
        <Modal onClose={busy ? undefined : () => setConfirming(false)} canClose={!busy}>
          <div className="modal host-remove">
            <h2 className="host-remove__title">Clear local data?</h2>
            <p className="host-remove__text">
              This browser forgets the nodes it has connected, your session, your dashboard layout,
              and everything else saved here. You will be signed out and the app reloads.
            </p>
            <p className="host-remove__text">
              Nothing on any node changes, and your account is untouched.
            </p>
            <div className="settings-users__actions">
              <span style={{ flex: 1 }} />
              <button className="host-btn host-btn--ghost" onClick={() => setConfirming(false)}
                disabled={busy}>Cancel</button>
              <button className="host-btn host-btn--danger" onClick={run} disabled={busy}>
                {busy ? "Clearing…" : "Clear and reload"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export { ResetLocalData };

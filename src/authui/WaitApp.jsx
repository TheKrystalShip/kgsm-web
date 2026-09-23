import React from "react";
import { PendingPage } from "../pages/auth/PendingPage.jsx";
import { getJson } from "./api.js";

// WaitApp — an account an administrator has not approved yet, returned to the client that asked once
// they do.
//
// The panel's own waiting screen. What it polls is the anchor's answer for the request in flight:
// still waiting, or the client's address carrying a code — at which point it goes there.

function WaitApp() {
  const [who, setWho] = React.useState(null);

  React.useEffect(() => {
    getJson("/authorize/context").then((r) => {
      if (r.ok && r.body && r.body.account) {
        setWho({ display: r.body.account.displayName, name: r.body.account.username, id: null });
      }
    });
  }, []);

  const check = React.useCallback(async () => {
    const r = await getJson("/authorize/wait");
    if (r.ok && r.body && r.body.redirect) window.location.assign(r.body.redirect);
  }, []);

  return <PendingPage account="pending" user={who} onCheck={check} />;
}

export { WaitApp };

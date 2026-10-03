import React from "react";
import { useStore } from "@thekrystalship/krystal-ui/lib/store";
import { accountNamesStore, resolveAccountNames } from "../stores/accountNames.js";

// The username behind `accountId` on `hostId`, asking that node once. Returns the id itself until a
// name arrives and when the node holds none, so a surface always has something truthful to print.
function useAccountName(hostId, accountId) {
  React.useEffect(() => {
    if (hostId && accountId) resolveAccountNames(hostId, [accountId]);
  }, [hostId, accountId]);
  const name = useStore(accountNamesStore, (s) =>
    (hostId && accountId && s.byHost[hostId] ? s.byHost[hostId][accountId] : undefined));
  return accountId ? (name || accountId) : null;
}

export { useAccountName };

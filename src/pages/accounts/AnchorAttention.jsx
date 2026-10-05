// AnchorAttention — the auth anchor's "needs a look": what it is waiting on a person for, each item
// shown only to somebody who can act on it. The items and how they are read are
// `lib/stores/anchorAttention.js`, which the sidebar's anchor row counts from too. Each row opens the
// provider's own admin page where it is dealt with.

import React from "react";

import { BriefCard, useStore } from "@thekrystalship/krystal-ui";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { sessionStore } from "../../lib/sessionStore.js";
import { anchorAttentionStore, startAnchorAttention, stopAnchorAttention } from "../../lib/stores/anchorAttention.js";
import { LeafBriefEmpty, LeafBriefItem } from "../leaf/leafOverviewKit.jsx";

function detailOf(it) {
  if (it.detail) return it.detail;
  if (!it.at) return null;
  const at = parseTs(it.at);
  return isNaN(at.getTime()) ? null : fmtRelative(at);
}

function AnchorAttention() {
  React.useEffect(() => { startAnchorAttention(); return stopAnchorAttention; }, []);
  // Opening the overview is a reason to read again, whatever the cadence last did.
  React.useEffect(() => { anchorAttentionStore.refresh(); }, []);
  const items = useStore(anchorAttentionStore, (s) => s.items);

  if (items === null) return null;

  return (
    <BriefCard icon="triangle-alert" title="Needs a look" count={items.length || null}>
      {items.length === 0 ? (
        <LeafBriefEmpty title="Nothing waiting" />
      ) : (
        <div className="chat-brief__list">
          {items.map((it) => {
            const page = sessionStore.adminPage(it.page);
            return (
              <LeafBriefItem key={it.key} tone={it.tone} icon={it.icon} title={it.title} detail={detailOf(it)}
                action={page ? "Open" : null}
                onClick={page ? () => window.open(page, "_blank", "noopener") : undefined} />
            );
          })}
        </div>
      )}
    </BriefCard>
  );
}

export { AnchorAttention };

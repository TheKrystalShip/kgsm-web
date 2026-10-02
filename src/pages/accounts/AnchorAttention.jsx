// AnchorAttention — the auth anchor's "needs a look": what it is waiting on a person for, each item
// shown only to somebody who can act on it. The items and how they are read are
// `lib/stores/anchorAttention.js`, which the sidebar's anchor row counts from too. Each row opens the
// tab where it is dealt with.

import React from "react";

import { BriefCard } from "../../components/BriefCard.jsx";
import { fmtRelative, parseTs } from "../../lib/formatting.js";
import { useStore } from "../../lib/store.js";
import { anchorAttentionStore, startAnchorAttention, stopAnchorAttention } from "../../lib/stores/anchorAttention.js";
import { LeafBriefEmpty, LeafBriefItem } from "../leaf/leafOverviewKit.jsx";

function detailOf(it) {
  if (it.detail) return it.detail;
  if (!it.at) return null;
  const at = parseTs(it.at);
  return isNaN(at.getTime()) ? null : fmtRelative(at);
}

function AnchorAttention({ onSelectTab }) {
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
          {items.map((it) => (
            <LeafBriefItem key={it.key} tone={it.tone} icon={it.icon} title={it.title} detail={detailOf(it)}
              action={onSelectTab ? "Open" : null}
              onClick={onSelectTab ? () => onSelectTab(it.tab) : undefined} />
          ))}
        </div>
      )}
    </BriefCard>
  );
}

export { AnchorAttention };

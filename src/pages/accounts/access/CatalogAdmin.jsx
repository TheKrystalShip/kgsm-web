// CatalogAdmin — every action the cluster's members declare, grouped by component, with its effect,
// the scope kind it is granted at, and which members at which versions declare it.
//
// *Unmapped* is an action filed into no permission: nobody but an Owner can perform it until it is. It
// is a filter here, and an unmapped action is filed into a permission from its own row.

import React from "react";

import { SettingsSection } from "../../../components/settings-primitives.jsx";
import { Select } from "../../../components/Select.jsx";
import { ACTIONS, may } from "../../../lib/persona.js";
import { authorityStore } from "../../../lib/stores/authority.js";
import { RefusalNote, authorityGate, componentOf, useAuthority } from "./accessKit.jsx";

function CatalogAdmin() {
  const state = useAuthority();
  const view = state.view;
  const canFile = may(ACTIONS.PERMISSIONS_EDIT, { cluster: true });
  const [onlyUnmapped, setOnlyUnmapped] = React.useState(false);
  const [refusal, setRefusal] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const groups = React.useMemo(() => {
    if (!view) return [];
    const by = {};
    view.catalog
      .filter((a) => !onlyUnmapped || a.unmapped)
      .forEach((a) => { (by[componentOf(a.action)] = by[componentOf(a.action)] || []).push(a); });
    return Object.keys(by).sort().map((c) => ({
      component: c, actions: by[c].sort((a, b) => a.action.localeCompare(b.action)),
    }));
  }, [view, onlyUnmapped]);

  const gate = authorityGate(state);
  if (gate) return gate;

  const unmapped = view.catalog.filter((a) => a.unmapped).length;

  const fileInto = async (action, permissionId) => {
    const p = view.permissions.find((x) => x.id === permissionId);
    if (!p) return;
    setBusy(true);
    setRefusal(null);
    const r = await authorityStore.edit({ kind: "permission.actions", permissionId, actions: [...p.actions, action] });
    setBusy(false);
    if (!r.ok) setRefusal(r.refusal);
  };

  return (
    <SettingsSection icon="list-checks" title="Catalog"
      meta={view.catalog.length + " actions · " + unmapped + " unmapped"}
      action={
        <div className="access-filter" role="group" aria-label="Show">
          <button type="button" className={"access-filter__opt" + (!onlyUnmapped ? " is-on" : "")}
            aria-pressed={!onlyUnmapped} onClick={() => setOnlyUnmapped(false)}>All</button>
          <button type="button" className={"access-filter__opt" + (onlyUnmapped ? " is-on" : "")}
            aria-pressed={onlyUnmapped} onClick={() => setOnlyUnmapped(true)}>Unmapped</button>
        </div>
      }>
      <RefusalNote refusal={refusal} />
      {groups.length === 0 && <div className="access-sub access-sub--empty">{onlyUnmapped ? "Every action is filed." : "No member declares any action."}</div>}
      {groups.map((g) => (
        <div key={g.component} className="access-group">
          <div className="access-group__title">{g.component}</div>
          {g.actions.map((a) => (
            <div key={a.action} className="access-action" data-action={a.action}>
              <div className="access-action__main">
                <span className="access-action__title">{a.title}</span>
                <code className="access-check__id">{a.action}</code>
              </div>
              <span className={"access-pill access-pill--" + a.effect}>{a.effect}</span>
              <span className="access-pill">{a.self ? "self" : a.scope}</span>
              <span className="access-action__by">
                {a.declaredBy.map((d) => d.member + (d.version ? " " + d.version : "")).join(", ") || "—"}
              </span>
              {a.unmapped && (
                canFile && view.permissions.length > 0
                  ? (
                    <Select className="access-action__file" value="" aria-label={"File " + a.action + " into a permission"}
                      disabled={busy} onChange={(e) => { if (e.target.value) fileInto(a.action, e.target.value); }}>
                      <option value="">File into…</option>
                      {view.permissions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  )
                  : <span className="access-pill access-pill--warn">unmapped</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </SettingsSection>
  );
}

export { CatalogAdmin };

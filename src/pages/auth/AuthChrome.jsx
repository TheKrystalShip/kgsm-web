import React from "react";
import { Icon } from "../../components/Icon.jsx";
import { OAuthIcon, providerLabel } from "../../components/host-helpers.jsx";

// The furniture the three auth screens share — the shell, the brand, the provider
// buttons and the doorway chip. Kept here rather than duplicated per screen, because
// the whole point of the flow is that node, sign-in and register are one surface.

function AuthShell({ tagline, children }) {
  return (
    <div className="login-shell">
      <div className="login-shell__inner">
        <div className="login-shell__brand">
          <img src="/assets/tks-mark.png" alt="" />
          <div className="login-shell__brand-name">The Krystal Ship</div>
          {tagline ? <div className="login-shell__tagline">{tagline}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

// The providers a node offers, in the order it reports them.
//
// One is a branded full-width button; several are a neutral 2-up grid carrying their own
// marks. Four brand fills stacked in a column is a paint chart, and it implies a
// recommendation the host never made — every provider on a node is equally a way in.
function ProviderButtons({ providers, verb, busy, disabled, onPick }) {
  const list = providers || [];
  if (!list.length) return null;

  if (list.length === 1) {
    const p = list[0];
    return (
      <div className="oauth-stack">
        <button
          type="button"
          className={"oauth-btn oauth-btn--" + p}
          disabled={disabled || !!busy}
          onClick={() => onPick(p)}>
          {busy === p
            ? (<><span className="oauth-spinner" /> Redirecting to {providerLabel(p)}…</>)
            : (<><OAuthIcon provider={p} /> {verb === "register" ? "Sign up" : "Continue"} with {providerLabel(p)}</>)}
        </button>
      </div>
    );
  }

  return (
    <div className="oauth-grid">
      {list.map(p => (
        <button
          key={p}
          type="button"
          className="oauth-btn"
          disabled={disabled || !!busy}
          onClick={() => onPick(p)}>
          {busy === p
            ? (<><span className="oauth-spinner" /> {providerLabel(p)}…</>)
            : (<><OAuthIcon provider={p} /> {providerLabel(p)}</>)}
        </button>
      ))}
    </div>
  );
}

// Which node this is against, and the way back to the list.
//
// It uses the host's OWN label, read from the anonymous GET /api/v1 — not the address
// this browser happened to be typed at, which is a fact about this browser rather than
// about the host. The verb changes with the screen because "signing in through" and
// "creating your account on" are different facts about the same node.
function DoorwayChip({ node, verb, down, onOpen }) {
  if (!node) return null;
  const name = node.label || (node.origin || "").replace(/^https?:\/\//, "");
  return (
    <button type="button" className="doorway" onClick={onOpen} title="Choose a different node">
      <span className={"svc-dot " + (down ? "svc-dot--down" : "svc-dot--up")} />
      <span>{verb === "register" ? "Creating your account on" : "Signing in through"} <b>{name}</b></span>
      {node.region ? <span className="doorway__meta">{node.region}</span> : null}
      <Icon name="chevron-down" size={13} />
    </button>
  );
}

// A password field with a reveal toggle. `right` is whatever sits opposite the label.
function PasswordField({ id, label, value, onChange, autoComplete, disabled, right, children }) {
  const [shown, setShown] = React.useState(false);
  return (
    <>
      <label className="login-form__label" htmlFor={id}>
        <span>{label}</span>
        {right}
      </label>
      <span className="login-form__wrap">
        <input
          id={id}
          className="login-form__input"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={onChange} />
        <button
          type="button"
          className="login-form__reveal"
          onClick={() => setShown(s => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          title={shown ? "Hide password" : "Show password"}>
          <Icon name={shown ? "eye-off" : "eye"} size={16} />
        </button>
      </span>
      {children}
    </>
  );
}

// Four segments and a word. The word is the honest part — the bar is the glance.
function PasswordMeter({ strength }) {
  if (!strength || !strength.level) return null;
  return (
    <div className="pw-meter" data-level={strength.level}>
      <div className="pw-meter__track">
        <i className="pw-meter__seg" /><i className="pw-meter__seg" />
        <i className="pw-meter__seg" /><i className="pw-meter__seg" />
      </div>
      <div className="pw-meter__label">{strength.label}</div>
    </div>
  );
}

// A refusal. `field` places it inside the form, above what it is about; without it the
// message sits at the top of the card, which is where a fact about the HOST belongs
// because that invalidates every door on the card rather than one of them.
function AuthError({ children, field }) {
  if (!children) return null;
  return (
    <div className={"login-error" + (field ? " login-error--field" : "")} role="alert">
      <Icon name="alert-triangle" size={15} />
      <div>{children}</div>
    </div>
  );
}

export { AuthError, AuthShell, DoorwayChip, PasswordField, PasswordMeter, ProviderButtons };

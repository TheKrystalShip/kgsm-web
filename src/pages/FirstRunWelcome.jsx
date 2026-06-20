import React from "react";
import { Icon } from "../components/Icon.jsx";

// FirstRunWelcome — shown once, immediately after a brand-new user signs in.
// Routes them into the library to install their first server.

function FirstRunWelcome({ user, onStart, onSkip }) {
  return (
    <div className="welcome-shell" onClick={(e) => { if (e.target === e.currentTarget) onSkip(); }}>
      <div className="welcome-card">
        <span className="welcome-card__hello">Welcome aboard</span>
        <h1 className="welcome-card__title">Hey {user.display || user.name}, your ship is ready.</h1>
        <div className="welcome-card__body">
          Krystal is your home for every dedicated game server you run. Pick a game, name it, and we'll handle the install, port-forwarding, and config defaults.
        </div>

        <div className="welcome-card__steps">
          <div className="welcome-card__step"><span className="num">1</span> Pick a game from the library</div>
          <div className="welcome-card__step"><span className="num">2</span> Name your server and set a port</div>
          <div className="welcome-card__step"><span className="num">3</span> Hit install — we'll ping you in Discord when it's online</div>
        </div>

        <div className="welcome-card__cta">
          <button type="button" className="fb-editor__btn" style={{ height: 42, padding: "0 22px", fontSize: 14 }} onClick={onStart}>
            <Icon name="library" size={14} strokeWidth={2.2} />&nbsp; Browse the library
          </button>
          <button type="button" className="skip" onClick={onSkip}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}

export { FirstRunWelcome };

import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import './Header.css';

/**
 * Header component for the application
 * 
 * Displays the application title, theme toggle, and user authentication controls
 */
const Header: React.FC = () => {
  const { isAuthenticated, user, login, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="header">
      <div className="header-title">
        <h1>KGSM Web Admin Panel</h1>
      </div>
      
      <div className="header-controls">
        {/* Theme toggle button */}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        
        {/* Authentication controls */}
        {isAuthenticated ? (
          <div className="user-menu">
            {user?.picture && (
              <img
                src={user.picture}
                alt={user.name || 'User'}
                className="user-avatar"
              />
            )}
            <span className="user-name">{user?.name}</span>
            <button className="btn btn-secondary" onClick={logout}>
              Log Out
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={login}>
            Log In
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import HamburgerMenu from './HamburgerMenu';
import './Header.css';

interface HeaderProps {
  isSidebarOpen: boolean;
  onSidebarToggle: () => void;
}

/**
 * Header component for the application
 *
 * Displays the application logo, title, theme toggle, hamburger menu, and user authentication controls
 * with modern design elements that match the overall website aesthetic
 */
const Header: React.FC<HeaderProps> = ({ isSidebarOpen, onSidebarToggle }) => {
  const { isAuthenticated, user, login, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  // Add scroll effect for enhanced header appearance
  useEffect(() => {
    const handleScroll = () => {
      const isScrolled = window.scrollY > 10;
      if (isScrolled !== scrolled) {
        setScrolled(isScrolled);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [scrolled]);

  return (
    <header className={`header ${scrolled ? 'header-scrolled' : ''}`}>
      <div className="header-left">
        <HamburgerMenu
          isOpen={isSidebarOpen}
          onToggle={onSidebarToggle}
        />
        <div className="logo-container">
          <svg className="logo-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
            <path d="M25 5C14.35 5 5.6 12.65 5.6 22c0 3.9 1.45 7.45 3.85 10.4-2.5 4.2-5.35 7.15-5.35 7.15-.35.35-.5.85-.4 1.3.1.45.45.85.9 1.05 0 0 1.2.5 3.1.5 3.25 0 7.2-1.15 10.8-4.5 2.2.65 4.55 1.1 7 1.1 10.15 0 18.4-7.15 18.4-16.05C43.9 12.65 35.65 5 25 5zM15 19c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm10 0c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm10 0c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" fill="currentColor"/>
          </svg>
          <div className="header-title">
            <h1>
              <span className="title-kgsm">KGSM</span>
              <span className="title-separator"></span>
              <span className="title-admin">Web Admin Panel</span>
            </h1>
          </div>
        </div>
      </div>

      <div className="header-controls">
        {/* Theme toggle button with better icon representation */}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          {theme === 'light' ? (
            <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          ) : (
            <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          )}
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
            <button className="btn btn-secondary btn-with-icon" onClick={logout}>
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Log Out
            </button>
          </div>
        ) : (
          <button className="btn btn-primary btn-with-icon" onClick={login}>
            <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
              <polyline points="10 17 15 12 10 7"></polyline>
              <line x1="15" y1="12" x2="3" y2="12"></line>
            </svg>
            Log In
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;

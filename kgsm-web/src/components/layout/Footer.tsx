import React from 'react';
import './Footer.css';

/**
 * Footer component with standard footer sections
 */
const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-grid">
          {/* KGSM Project Section */}
          <div className="footer-section">
            <h3 className="footer-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
              KGSM Project
            </h3>
            <ul className="footer-links">
              <li>
                <a href="https://github.com/TheKrystalShip/KGSM" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                  </svg>
                  Repository
                </a>
              </li>
              <li>
                <a href="https://github.com/TheKrystalShip/KGSM/issues" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  Report Issues
                </a>
              </li>
              <li>
                <a href="https://github.com/TheKrystalShip/KGSM/releases" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 1v6m0 6v6"></path>
                    <path d="m9 9 3 3 3-3"></path>
                  </svg>
                  Releases
                </a>
              </li>
              <li>
                <a href="https://github.com/TheKrystalShip/KGSM/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  </svg>
                  Contributing
                </a>
              </li>
              <li>
                <a href="https://github.com/TheKrystalShip/KGSM/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14,2 14,8 20,8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10,9 9,9 8,9"></polyline>
                  </svg>
                  Changelog
                </a>
              </li>
            </ul>
          </div>

          {/* Documentation Section */}
          <div className="footer-section">
            <h3 className="footer-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
              </svg>
              Documentation
            </h3>
            <ul className="footer-links">
              <li>
                <a href="/docs/getting-started">Getting Started</a>
              </li>
              <li>
                <a href="/docs/installation">Installation Guide</a>
              </li>
              <li>
                <a href="/docs/configuration">Configuration</a>
              </li>
              <li>
                <a href="/docs/troubleshooting">Troubleshooting</a>
              </li>
              <li>
                <a href="/docs/api">API Reference</a>
              </li>
            </ul>
          </div>

          {/* Community Section */}
          <div className="footer-section">
            <h3 className="footer-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              Community
            </h3>
            <ul className="footer-links">
              <li>
                <a href="https://github.com/TheKrystalShip/KGSM/discussions" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  Discussions
                </a>
              </li>
              <li>
                <a href="https://discord.gg/kgsm" target="_blank" rel="noopener noreferrer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 9a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"></path>
                    <path d="M14.5 9a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z"></path>
                    <path d="M8.5 4.5c-.8 0-1.5.7-1.5 1.5v13c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5V6c0-.8-.7-1.5-1.5-1.5h-7z"></path>
                  </svg>
                  Discord Server
                </a>
              </li>
              <li>
                <a href="/community/forums">Community Forums</a>
              </li>
              <li>
                <a href="/community/showcase">User Showcase</a>
              </li>
            </ul>
          </div>

          {/* Support Section */}
          <div className="footer-section">
            <h3 className="footer-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              Support
            </h3>
            <ul className="footer-links">
              <li>
                <a href="/support/help">Help Center</a>
              </li>
              <li>
                <a href="/support/contact">Contact Support</a>
              </li>
              <li>
                <a href="/support/faq">FAQ</a>
              </li>
              <li>
                <a href="/support/system-requirements">System Requirements</a>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="footer-bottom">
          <div className="footer-bottom-content">
            <div className="footer-copyright">
              <p>
                © {currentYear} <strong>TheKrystalShip</strong>. All rights reserved.
              </p>
              <p className="footer-description">
                KGSM - Krystal Game Server Manager. Open source game server management made simple.
              </p>
            </div>

            <div className="footer-legal">
              <a href="https://github.com/TheKrystalShip/KGSM/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14,2 14,8 20,8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                License
              </a>
              <span className="footer-separator">•</span>
              <a href="/privacy">Privacy Policy</a>
              <span className="footer-separator">•</span>
              <a href="/terms">Terms of Service</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

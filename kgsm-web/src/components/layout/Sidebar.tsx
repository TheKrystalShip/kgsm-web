import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

interface SidebarItem {
  path: string;
  label: string;
  icon: string;
}

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const sidebarItems: SidebarItem[] = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/blueprints', label: 'Blueprints', icon: '📋' },
  { path: '/instances', label: 'Instances', icon: '🖥️' },
  { path: '/system', label: 'System', icon: '⚙️' },
  { path: '/docs', label: 'Docs', icon: '📚' },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLinkClick = () => {
    if (isMobile) {
      onToggle(); // Close sidebar on mobile when a link is clicked
    }
  };

  const handleOverlayClick = () => {
    if (isMobile && isOpen) {
      onToggle();
    }
  };

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-content">
          <nav className="sidebar-nav">
            <ul className="sidebar-menu">
              {sidebarItems.map((item) => (
                <li key={item.path} className="sidebar-menu-item">
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? 'active' : ''}`
                    }
                    end={item.path === '/'}
                    onClick={handleLinkClick}
                  >
                    <span className="sidebar-icon">{item.icon}</span>
                    <span className="sidebar-label">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div
          className="sidebar-overlay"
          onClick={handleOverlayClick}
          aria-hidden="true"
        />
      )}
    </>
  );
};

export default Sidebar;

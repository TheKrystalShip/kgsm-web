import React from 'react';
import './HamburgerMenu.css';

interface HamburgerMenuProps {
  isOpen: boolean;
  onToggle: () => void;
}

const HamburgerMenu: React.FC<HamburgerMenuProps> = ({ isOpen, onToggle }) => {
  return (
    <button
      className={`hamburger-menu ${isOpen ? 'open' : ''}`}
      onClick={onToggle}
      aria-label="Toggle navigation menu"
      aria-expanded={isOpen}
    >
      <span className="hamburger-line"></span>
      <span className="hamburger-line"></span>
      <span className="hamburger-line"></span>
    </button>
  );
};

export default HamburgerMenu;

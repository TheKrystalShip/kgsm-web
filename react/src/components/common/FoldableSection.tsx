import React, { useState } from 'react';
import './FoldableSection.css';

interface FoldableSectionProps {
  title: React.ReactNode;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Foldable section component that can be expanded or collapsed
 */
const FoldableSection: React.FC<FoldableSectionProps> = ({ 
  title, 
  defaultExpanded = true, 
  children, 
  className = '' 
}) => {
  // Generate a stable ID from the title (if string) or a random one
  const [id] = useState(() => {
    const titleString = typeof title === 'string' 
      ? title.toLowerCase().replace(/\s+/g, '-') 
      : Math.random().toString(36).substr(2, 9);
    return `foldable-section-${titleString}`;
  });

  // Check localStorage for saved state, fallback to defaultExpanded
  const [isExpanded, setIsExpanded] = useState(() => {
    try {
      const savedState = localStorage.getItem(`foldable-state-${id}`);
      return savedState !== null ? savedState === 'true' : defaultExpanded;
    } catch (e) {
      return defaultExpanded;
    }
  });

  const toggleExpanded = () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    // Save to localStorage
    try {
      localStorage.setItem(`foldable-state-${id}`, String(newState));
    } catch (e) {
      console.warn('Failed to save section state to localStorage', e);
    }
  };

  return (
    <div className={`foldable-section ${className} ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div 
        className="foldable-header" 
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={id}
        id={`${id}-header`}
      >
        <h2 className="foldable-title">{title}</h2>
        <button 
          className="fold-toggle-btn" 
          aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
          title={isExpanded ? 'Collapse section' : 'Expand section'}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded();
          }}
        >
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            className="fold-icon"
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {isExpanded ? (
              <polyline points="18 15 12 9 6 15" />
            ) : (
              <polyline points="6 9 12 15 18 9" />
            )}
          </svg>
        </button>
      </div>
      <div 
        className="foldable-content" 
        role="region" 
        aria-labelledby={`${id}-header`}
        id={id}
      >
        {children}
      </div>
    </div>
  );
};

export default FoldableSection;

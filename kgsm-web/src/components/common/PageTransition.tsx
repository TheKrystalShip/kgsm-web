import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { HomePage, InstancesPage, BlueprintsPage, SystemPage, DocsPage, PreferencesPage, InstanceDetailsPage } from '../../pages';
import { usePreferences } from '../../contexts/PreferencesContext';
import './PageTransition.css';

// Default page order for fallback
const DEFAULT_PAGE_ORDER = ['/', '/blueprints', '/instances', '/system', '/docs', '/preferences'];

/**
 * Wrapper component that provides smooth directional fade transitions between pages
 */
const PageTransition: React.FC = () => {
  const location = useLocation();
  const { preferences } = usePreferences();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState('fade-in');
  const [transitionDirection, setTransitionDirection] = useState<'up' | 'down' | 'none'>('none');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get the index of a path in the default page order
  const getPageIndex = useCallback((pathname: string) => {
    return DEFAULT_PAGE_ORDER.indexOf(pathname);
  }, []);

  // Determine transition direction based on page order
  const getTransitionDirection = useCallback((fromPath: string, toPath: string): 'up' | 'down' | 'none' => {
    const fromIndex = getPageIndex(fromPath);
    const toIndex = getPageIndex(toPath);

    if (fromIndex === -1 || toIndex === -1) return 'none';

    if (toIndex > fromIndex) {
      return 'up'; // Moving to a page above in sidebar
    } else if (toIndex < fromIndex) {
      return 'down'; // Moving to a page below in sidebar
    }

    return 'none';
  }, [getPageIndex]);

  useEffect(() => {
    if (location.pathname !== displayLocation.pathname && !isTransitioning) {
      // Skip transitions if animations are disabled or reduced motion is enabled
      if (!preferences.enableAnimations || preferences.reduceMotion) {
        setDisplayLocation(location);
        return;
      }

      const direction = getTransitionDirection(displayLocation.pathname, location.pathname);

      setIsTransitioning(true);
      setTransitionDirection(direction);
      setTransitionStage('fade-out');

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Wait for fade-out to complete, then switch content and start fade-in
      timeoutRef.current = setTimeout(() => {
        setDisplayLocation(location);
        setTransitionStage('fade-in');
        setIsTransitioning(false);
      }, 200);
    }
  }, [location.pathname, displayLocation.pathname, isTransitioning, getTransitionDirection, location, preferences.enableAnimations, preferences.reduceMotion]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getPageComponent = (pathname: string) => {
    // Check for instance details route pattern
    if (pathname.startsWith('/instances/')) {
      return <InstanceDetailsPage />;
    }

    switch (pathname) {
      case '/':
        return <HomePage />;
      case '/instances':
        return <InstancesPage />;
      case '/blueprints':
        return <BlueprintsPage />;
      case '/system':
        return <SystemPage />;
      case '/docs':
        return <DocsPage />;
      case '/preferences':
        return <PreferencesPage />;
      default:
        return <HomePage />;
    }
  };

  const getTransitionClass = () => {
    const baseClass = `page-transition ${transitionStage}`;

    if (transitionDirection === 'none') {
      return baseClass;
    }

    return `${baseClass} ${transitionDirection}`;
  };

  return (
    <div className={getTransitionClass()}>
      {getPageComponent(displayLocation.pathname)}
    </div>
  );
};

export default PageTransition;

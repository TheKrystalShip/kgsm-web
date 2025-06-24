import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchBlueprints, installBlueprint, clearError, clearInstallError } from '../store/blueprintsSlice';
import { usePreferences } from '../contexts/PreferencesContext';

/**
 * Custom hook for managing blueprints with Redux store
 * Provides caching, background refresh, and installation capabilities
 */
export const useBlueprintsStore = () => {
  const dispatch = useAppDispatch();
  const { preferences } = usePreferences();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const {
    blueprints,
    loading,
    silentRefresh,
    error,
    lastUpdated,
    installing,
    installError
  } = useAppSelector((state) => state.blueprints);

  // Check if blueprints are cached (have been loaded before)
  const isCached = lastUpdated !== null && Object.keys(blueprints).length > 0;

  // Initial load - only fetch if not cached
  useEffect(() => {
    if (!isCached && !loading) {
      dispatch(fetchBlueprints({}));
    }
  }, [dispatch, isCached, loading]);

  // Auto-update effect - background refresh when enabled
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Set up auto-update if enabled and data is cached
    if (preferences.enableBlueprintsAutoUpdate && isCached) {
      // Auto-refresh every 60 seconds when cached
      intervalRef.current = setInterval(() => {
        dispatch(fetchBlueprints({ silent: true }));
      }, 60000);
    }

    // Cleanup on unmount or when preferences change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [dispatch, preferences.enableBlueprintsAutoUpdate, isCached]);

  // Refresh blueprints (manual refresh)
  const refreshBlueprints = () => {
    dispatch(fetchBlueprints({}));
  };

  // Silent refresh (background update)
  const silentRefreshBlueprints = () => {
    dispatch(fetchBlueprints({ silent: true }));
  };

  // Install a blueprint
  const handleInstallBlueprint = async (
    blueprintName: string,
    instanceId?: string,
    installDir?: string,
    version?: string
  ) => {
    try {
      await dispatch(installBlueprint({
        blueprintName,
        instanceId,
        installDir,
        version
      })).unwrap();
      return true;
    } catch (error) {
      return false;
    }
  };

  // Clear errors
  const handleClearError = () => {
    dispatch(clearError());
  };

  const handleClearInstallError = () => {
    dispatch(clearInstallError());
  };

  // Format last updated timestamp
  const getLastUpdatedText = (): string | null => {
    if (!lastUpdated) return null;

    const now = Date.now();
    const diff = now - lastUpdated;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  return {
    // Data
    blueprints,
    isCached,
    lastUpdated,
    lastUpdatedText: getLastUpdatedText(),

    // Loading states
    loading,
    silentRefresh,

    // Error states
    error,
    installError,
    installing,

    // Actions
    refreshBlueprints,
    silentRefreshBlueprints,
    installBlueprint: handleInstallBlueprint,
    clearError: handleClearError,
    clearInstallError: handleClearInstallError,
  };
};

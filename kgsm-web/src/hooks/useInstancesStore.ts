import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  fetchInstances,
  startInstance,
  stopInstance,
  restartInstance,
  updateInstance,
  uninstallInstance,
  clearError,
  clearActionError
} from '../store/instancesSlice';

/**
 * Custom hook for managing instances with Redux store
 * Provides caching, background refresh, and instance management capabilities
 */
export const useInstancesStore = () => {
  const dispatch = useAppDispatch();
  const {
    instances,
    loading,
    silentRefresh,
    error,
    lastUpdated,
    starting,
    stopping,
    restarting,
    updating,
    uninstalling,
    actionError
  } = useAppSelector((state) => state.instances);

  // Check if instances are cached (have been loaded before)
  const isCached = lastUpdated !== null && Object.keys(instances).length >= 0; // Allow empty instances

  // Initial load - only fetch if not cached
  useEffect(() => {
    if (!isCached && !loading) {
      dispatch(fetchInstances({}));
    }
  }, [dispatch, isCached, loading]);

  // Refresh instances (manual refresh)
  const refreshInstances = () => {
    dispatch(fetchInstances({}));
  };

  // Silent refresh (background update)
  const silentRefreshInstances = () => {
    dispatch(fetchInstances({ silent: true }));
  };

  // Instance management actions
  const handleStartInstance = async (instanceName: string) => {
    try {
      await dispatch(startInstance(instanceName)).unwrap();
      // Refresh instances after successful start
      dispatch(fetchInstances({ silent: true }));
      return true;
    } catch (error) {
      return false;
    }
  };

  const handleStopInstance = async (instanceName: string) => {
    try {
      await dispatch(stopInstance(instanceName)).unwrap();
      // Refresh instances after successful stop
      dispatch(fetchInstances({ silent: true }));
      return true;
    } catch (error) {
      return false;
    }
  };

  const handleRestartInstance = async (instanceName: string) => {
    try {
      await dispatch(restartInstance(instanceName)).unwrap();
      // Refresh instances after successful restart
      dispatch(fetchInstances({ silent: true }));
      return true;
    } catch (error) {
      return false;
    }
  };

  const handleUpdateInstance = async (instanceName: string, version?: string) => {
    try {
      await dispatch(updateInstance({ instanceName, version })).unwrap();
      // Refresh instances after successful update
      dispatch(fetchInstances({ silent: true }));
      return true;
    } catch (error) {
      return false;
    }
  };

  const handleUninstallInstance = async (instanceName: string) => {
    try {
      await dispatch(uninstallInstance(instanceName)).unwrap();
      // No need to refresh as the slice removes the instance from state
      return true;
    } catch (error) {
      return false;
    }
  };

  // Clear errors
  const handleClearError = () => {
    dispatch(clearError());
  };

  const handleClearActionError = () => {
    dispatch(clearActionError());
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
    instances,
    isCached,
    lastUpdated,
    lastUpdatedText: getLastUpdatedText(),

    // Loading states
    loading,
    silentRefresh,

    // Error states
    error,
    actionError,

    // Action states
    starting,
    stopping,
    restarting,
    updating,
    uninstalling,

    // Actions
    refreshInstances,
    silentRefreshInstances,
    startInstance: handleStartInstance,
    stopInstance: handleStopInstance,
    restartInstance: handleRestartInstance,
    updateInstance: handleUpdateInstance,
    uninstallInstance: handleUninstallInstance,
    clearError: handleClearError,
    clearActionError: handleClearActionError,
  };
};

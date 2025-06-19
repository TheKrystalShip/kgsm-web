import { useState, useEffect, useCallback } from 'react';
import kgsmService from '../services/kgsmService';
import { KgsmInstance } from '../models/kgsm';

/**
 * Custom hook for fetching and managing KGSM instances
 */
export const useInstances = () => {
  const [instances, setInstances] = useState<Record<string, KgsmInstance>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch all instances
  const fetchInstances = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await kgsmService.getInstances();
      setInstances(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch instances'));

      // In development, set mock data if API is not available
      if (process.env.NODE_ENV === 'development') {
        setInstances(getMockInstances());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Start an instance
  const startInstance = useCallback(async (instanceName: string) => {
    try {
      await kgsmService.startInstance(instanceName);
      // Update local state to reflect the change without a full refetch
      setInstances(prev => ({
        ...prev,
        [instanceName]: {
          ...prev[instanceName],
          Status: 'active'
        }
      }));
      // Still fetch all instances to ensure everything is up to date
      fetchInstances();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to start instance: ${instanceName}`));
    }
  }, [fetchInstances]);

  // Stop an instance
  const stopInstance = useCallback(async (instanceName: string) => {
    try {
      await kgsmService.stopInstance(instanceName);
      // Update local state to reflect the change without a full refetch
      setInstances(prev => ({
        ...prev,
        [instanceName]: {
          ...prev[instanceName],
          Status: 'inactive'
        }
      }));
      // Still fetch all instances to ensure everything is up to date
      fetchInstances();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to stop instance: ${instanceName}`));
    }
  }, [fetchInstances]);

  // Restart an instance
  const restartInstance = useCallback(async (instanceName: string) => {
    try {
      await kgsmService.restartInstance(instanceName);
      fetchInstances();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to restart instance: ${instanceName}`));
    }
  }, [fetchInstances]);

  // Update an instance to the latest version
  const updateInstance = useCallback(async (instanceName: string) => {
    try {
      await kgsmService.updateInstance(instanceName);
      // Refresh instances to get updated version info
      fetchInstances();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to update instance: ${instanceName}`));
    }
  }, [fetchInstances]);

  // Uninstall an instance
  const uninstallInstance = useCallback(async (instanceName: string) => {
    try {
      await kgsmService.uninstallInstance(instanceName);
      // Remove the instance from local state
      setInstances(prev => {
        const newInstances = { ...prev };
        delete newInstances[instanceName];
        return newInstances;
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to uninstall instance: ${instanceName}`));
    }
  }, []);

  // Fetch instances on component mount
  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  return {
    instances,
    loading,
    error,
    fetchInstances,
    startInstance,
    stopInstance,
    restartInstance,
    updateInstance,
    uninstallInstance
  };
};

/**
 * Generate mock instances for development
 */
function getMockInstances(): Record<string, KgsmInstance> {
  return {
    "minecraft": {
      "Name": "minecraft",
      "LifecycleManager": "systemd",
      "Status": "active",
      "PID": "12345",
      "LogsDirectory": "/var/log/minecraft",
      "Directory": "/opt/minecraft",
      "InstallationDate": "2024-10-22T20:11:57",
      "Version": "1.21.2",
      "Blueprint": "/opt/kgsm/blueprints/minecraft.bp",
      "ServiceFile": "/etc/systemd/system/minecraft.service",
      "SocketFile": "/opt/minecraft/.minecraft.stdin",
      "FirewallRule": ""
    },
    "factorio": {
      "Name": "factorio",
      "LifecycleManager": "systemd",
      "Status": "inactive",
      "PID": "None",
      "LogsDirectory": "None",
      "Directory": "/opt/factorio",
      "InstallationDate": "2025-05-06T13:10:31",
      "Version": "2.0.47",
      "Blueprint": "/opt/kgsm/blueprints/factorio.bp",
      "ServiceFile": "/etc/systemd/system/factorio.service",
      "SocketFile": "/opt/factorio/.factorio.stdin",
      "FirewallRule": ""
    },
    "terraria": {
      "Name": "terraria",
      "LifecycleManager": "systemd",
      "Status": "inactive",
      "PID": "None",
      "LogsDirectory": "None",
      "Directory": "/opt/terraria",
      "InstallationDate": "2024-12-25T22:57:05",
      "Version": "1449",
      "Blueprint": "/opt/kgsm/blueprints/terraria.bp",
      "ServiceFile": "/etc/systemd/system/terraria.service",
      "SocketFile": "/opt/terraria/.terraria.stdin",
      "FirewallRule": ""
    }
  };
}

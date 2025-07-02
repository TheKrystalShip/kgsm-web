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
      "name": "minecraft",
      "blueprint_file": "minecraft.bp",
      "install_datetime": "2024-01-15 10:30:00",
      "working_dir": "/home/gameserver/minecraft",
      "backups_dir": "/home/gameserver/minecraft/backups",
      "install_dir": "/home/gameserver/minecraft",
      "saves_dir": "/home/gameserver/minecraft/saves",
      "temp_dir": "/home/gameserver/minecraft/temp",
      "logs_dir": "/home/gameserver/minecraft/logs",
      "launch_dir": "/home/gameserver/minecraft",
      "executable_subdirectory": "bin/x64",
      "executable_file": "java",
      "management_file": "/home/gameserver/minecraft/.kgsm",
      "compose_file": "",
      "version_file": "/home/gameserver/minecraft/version.txt",
      "pid_file": "/home/gameserver/minecraft/.pid",
      "tail_pid_file": "/home/gameserver/minecraft/.tail.pid",
      "socket_file": "/tmp/kgsm-minecraft.sock",
      "lifecycle_manager": "systemd",
      "runtime": "native",
      "platform": "linux",
      "auto_update": "0",
      "logs_redirect": "1",
      "level_name": "default",
      "executable_arguments": "-Xmx4096M -Xms4096M -jar server.jar nogui",
      "steam_app_id": "0",
      "is_steam_account_required": "0",
      "ports": "25565/udp",
      "enable_port_forwarding": "0",
      "upnp_ports": "",
      "enable_firewall_management": "1",
      "firewall_rule_file": "/etc/ufw/applications.d/minecraft",
      "stop_command": "/stop",
      "save_command": "/save-all",
      "save_command_timeout_seconds": "30",
      "stop_command_timeout_seconds": "60",
      "compress_backups": "1",
      "enable_systemd": "1",
      "systemd_service_file": "/etc/systemd/system/kgsm-minecraft.service",
      "systemd_socket_file": "/etc/systemd/system/kgsm-minecraft.socket",
      "enable_command_shortcuts": "1",
      "command_shortcut_file": "/usr/local/bin/minecraft"
    },
    "factorio": {
      "name": "factorio",
      "blueprint_file": "factorio.bp",
      "install_datetime": "2024-01-20 14:15:30",
      "working_dir": "/home/gameserver/factorio",
      "backups_dir": "/home/gameserver/factorio/backups",
      "install_dir": "/home/gameserver/factorio",
      "saves_dir": "/home/gameserver/factorio/saves",
      "temp_dir": "/home/gameserver/factorio/temp",
      "logs_dir": "/home/gameserver/factorio/logs",
      "launch_dir": "/home/gameserver/factorio",
      "executable_subdirectory": "bin/x64",
      "executable_file": "factorio",
      "management_file": "/home/gameserver/factorio/.kgsm",
      "compose_file": "",
      "version_file": "/home/gameserver/factorio/version.txt",
      "pid_file": "/home/gameserver/factorio/.pid",
      "tail_pid_file": "/home/gameserver/factorio/.tail.pid",
      "socket_file": "/tmp/kgsm-factorio.sock",
      "lifecycle_manager": "systemd",
      "runtime": "native",
      "platform": "linux",
      "auto_update": "0",
      "logs_redirect": "1",
      "level_name": "default",
      "executable_arguments": "--start-server saves/default",
      "steam_app_id": "0",
      "is_steam_account_required": "0",
      "ports": "34197",
      "enable_port_forwarding": "0",
      "upnp_ports": "",
      "enable_firewall_management": "1",
      "firewall_rule_file": "/etc/ufw/applications.d/factorio",
      "stop_command": "/quit",
      "save_command": "/save",
      "save_command_timeout_seconds": "30",
      "stop_command_timeout_seconds": "60",
      "compress_backups": "1",
      "enable_systemd": "1",
      "systemd_service_file": "/etc/systemd/system/kgsm-factorio.service",
      "systemd_socket_file": "/etc/systemd/system/kgsm-factorio.socket",
      "enable_command_shortcuts": "1",
      "command_shortcut_file": "/usr/local/bin/factorio"
    },
    "terraria": {
      "name": "terraria",
      "blueprint_file": "terraria.bp",
      "install_datetime": "2024-02-01 09:45:15",
      "working_dir": "/home/gameserver/terraria",
      "backups_dir": "/home/gameserver/terraria/backups",
      "install_dir": "/home/gameserver/terraria",
      "saves_dir": "/home/gameserver/terraria/saves",
      "temp_dir": "/home/gameserver/terraria/temp",
      "logs_dir": "/home/gameserver/terraria/logs",
      "launch_dir": "/home/gameserver/terraria",
      "executable_subdirectory": "",
      "executable_file": "TerrariaServer.bin.x86_64",
      "management_file": "/home/gameserver/terraria/.kgsm",
      "compose_file": "",
      "version_file": "/home/gameserver/terraria/version.txt",
      "pid_file": "/home/gameserver/terraria/.pid",
      "tail_pid_file": "/home/gameserver/terraria/.tail.pid",
      "socket_file": "/tmp/kgsm-terraria.sock",
      "lifecycle_manager": "systemd",
      "runtime": "native",
      "platform": "linux",
      "auto_update": "0",
      "logs_redirect": "1",
      "level_name": "default",
      "executable_arguments": "-config serverconfig.txt",
      "steam_app_id": "0",
      "is_steam_account_required": "0",
      "ports": "7777",
      "enable_port_forwarding": "0",
      "upnp_ports": "",
      "enable_firewall_management": "1",
      "firewall_rule_file": "/etc/ufw/applications.d/terraria",
      "stop_command": "exit",
      "save_command": "save",
      "save_command_timeout_seconds": "30",
      "stop_command_timeout_seconds": "60",
      "compress_backups": "1",
      "enable_systemd": "1",
      "systemd_service_file": "/etc/systemd/system/kgsm-terraria.service",
      "systemd_socket_file": "/etc/systemd/system/kgsm-terraria.socket",
      "enable_command_shortcuts": "1",
      "command_shortcut_file": "/usr/local/bin/terraria"
    }
  };
}

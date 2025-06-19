import { useState, useEffect, useCallback } from 'react';
import kgsmService, { KgsmBlueprint } from '../services/kgsmService';

/**
 * Custom hook for fetching and managing KGSM blueprints
 */
export const useBlueprints = () => {
  const [blueprints, setBlueprints] = useState<Record<string, KgsmBlueprint>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch all blueprints
  const fetchBlueprints = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await kgsmService.getBlueprints();
      setBlueprints(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch blueprints'));
      
      // In development, set mock data if API is not available
      if (process.env.NODE_ENV === 'development') {
        setBlueprints(getMockBlueprints());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Install a new instance from a blueprint
  const installBlueprint = useCallback(async (
    blueprintName: string, 
    instanceId?: string, 
    installDir?: string,
    version?: string
  ) => {
    try {
      await kgsmService.installInstance(blueprintName, instanceId, installDir, version);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(`Failed to install blueprint: ${blueprintName}`));
      return false;
    }
  }, []);

  // Fetch blueprints on component mount
  useEffect(() => {
    fetchBlueprints();
  }, [fetchBlueprints]);

  return {
    blueprints,
    loading,
    error,
    fetchBlueprints,
    installBlueprint
  };
};

/**
 * Generate mock blueprints for development
 */
function getMockBlueprints(): Record<string, KgsmBlueprint> {
  return {
    "minecraft.bp": {
      "Name": "minecraft",
      "Port": "25565/udp",
      "AppId": "0",
      "SteamAccountRequired": "0",
      "LaunchBin": "java",
      "LevelName": "default",
      "InstallSubdirectory": "",
      "LaunchArgs": "-Xmx4G -Xms4G -jar server.jar nogui",
      "StopCommand": "stop",
      "SaveCommand": "/save-all"
    },
    "factorio.bp": {
      "Name": "factorio",
      "Port": "34197",
      "AppId": "0",
      "SteamAccountRequired": "0",
      "LaunchBin": "factorio",
      "LevelName": "default",
      "InstallSubdirectory": "bin/x64",
      "LaunchArgs": "--start-server /",
      "StopCommand": "/quit",
      "SaveCommand": "/save"
    },
    "terraria.bp": {
      "Name": "terraria",
      "Port": "7777",
      "AppId": "0",
      "SteamAccountRequired": "0",
      "LaunchBin": "TerrariaServer.bin.x86_64",
      "LevelName": "default",
      "InstallSubdirectory": "",
      "LaunchArgs": "-config serverconfig.txt",
      "StopCommand": "exit",
      "SaveCommand": "save"
    },
    "valheim.bp": {
      "Name": "valheim",
      "Port": "2456-2458/udp",
      "AppId": "896660",
      "SteamAccountRequired": "0",
      "LaunchBin": "valheim_server.x86_64",
      "LevelName": "default",
      "InstallSubdirectory": "",
      "LaunchArgs": "-name \"My Server\" -port 2456 -world \"Dedicated\" -password \"secret\"",
      "StopCommand": "",
      "SaveCommand": ""
    }
  };
}

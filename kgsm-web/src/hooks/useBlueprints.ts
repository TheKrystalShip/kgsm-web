import { useState, useEffect, useCallback } from 'react';
import kgsmService from '../services/kgsmService';
import { KgsmBlueprint } from '../models/kgsm';

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
      "Ports": "25565/udp",
      "BlueprintType": "Native",
      "SteamAppId": "0",
      "IsSteamAccountRequired": "0",
      "ExecutableFile": "java",
      "LevelName": "default",
      "ExecutableSubdirectory": "bin/x64",
      "ExecutableArguments": "-Xmx4096M -Xms4096M -jar server.jar nogui",
      "StopCommand": "/stop",
      "SaveCommand": "/save-all"
    },
    "factorio.bp": {
      "Name": "factorio",
      "Ports": "34197",
      "BlueprintType": "Native",
      "SteamAppId": "0",
      "IsSteamAccountRequired": "0",
      "ExecutableFile": "factorio",
      "LevelName": "default",
      "ExecutableSubdirectory": "bin/x64",
      "ExecutableArguments": "--start-server saves/default",
      "StopCommand": "/quit",
      "SaveCommand": "/save"
    },
    "terraria.bp": {
      "Name": "terraria",
      "Ports": "7777",
      "BlueprintType": "Native",
      "SteamAppId": "0",
      "IsSteamAccountRequired": "0",
      "ExecutableFile": "TerrariaServer.bin.x86_64",
      "LevelName": "default",
      "ExecutableSubdirectory": "",
      "ExecutableArguments": "-config serverconfig.txt",
      "StopCommand": "exit",
      "SaveCommand": "save"
    },
    "valheim.bp": {
      "Name": "valheim",
      "Ports": "2456-2458/udp",
      "BlueprintType": "Native",
      "SteamAppId": "896660",
      "IsSteamAccountRequired": "0",
      "ExecutableFile": "valheim_server.x86_64",
      "LevelName": "default",
      "ExecutableSubdirectory": "",
      "ExecutableArguments": "-name 'My Server' -port 2456 -world 'Dedicated' -password 'secret'",
      "StopCommand": "",
      "SaveCommand": ""
    }
  };
}

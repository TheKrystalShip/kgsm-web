/**
 * KGSM Models
 *
 * Type definitions for KGSM entities and API responses
 */

export interface KgsmInstance {
  Name: string;
  LifecycleManager: string;
  Status: string;
  PID: string;
  LogsDirectory: string;
  Directory: string;
  InstallationDate: string;
  Version: string;
  Blueprint: string;
  ServiceFile: string;
  SocketFile: string;
  FirewallRule: string;
}

export interface KgsmBlueprint {
  Name: string;
  Port: string;
  AppId: string;
  SteamAccountRequired: string;
  LaunchBin: string;
  LevelName: string;
  InstallSubdirectory: string;
  LaunchArgs: string;
  StopCommand: string;
  SaveCommand: string;
}

export interface KgsmInstancesResponse {
  [key: string]: KgsmInstance;
}

export interface KgsmBlueprintsResponse {
  [key: string]: KgsmBlueprint;
}

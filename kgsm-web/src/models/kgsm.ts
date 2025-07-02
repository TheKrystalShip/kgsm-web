/**
 * KGSM Models
 *
 * Type definitions for KGSM entities and API responses
 */

export interface KgsmInstance {
  name: string;
  blueprint_file: string;
  install_datetime: string;
  working_dir: string;
  backups_dir: string;
  install_dir: string;
  saves_dir: string;
  temp_dir: string;
  logs_dir: string;
  launch_dir: string;
  executable_subdirectory: string;
  executable_file: string;
  management_file: string;
  compose_file: string;
  version_file: string;
  pid_file: string;
  tail_pid_file: string;
  socket_file: string;
  lifecycle_manager: string;
  runtime: string;
  platform: string;
  auto_update: string;
  logs_redirect: string;
  level_name: string;
  executable_arguments: string;
  steam_app_id: string;
  is_steam_account_required: string;
  ports: string;
  enable_port_forwarding: string;
  upnp_ports: string;
  enable_firewall_management: string;
  firewall_rule_file: string;
  stop_command: string;
  save_command: string;
  save_command_timeout_seconds: string;
  stop_command_timeout_seconds: string;
  compress_backups: string;
  enable_systemd: string;
  systemd_service_file: string;
  systemd_socket_file: string;
  enable_command_shortcuts: string;
  command_shortcut_file: string;
}

export interface KgsmInstanceStatus {
  instance_name: string;
  status: boolean;
  process: {
    pid: number | null;
    status: string | null;
    start_time: string | null;
  };
  version: {
    current: string;
    latest: string;
    updates_available: boolean;
  };
  configuration: {
    blueprint: string;
    runtime: string;
    lifecycle_manager: string;
    directory: string;
    ports: string;
  };
  resources: {
    disk_usage: string;
  };
  backups: {
    count: number;
  };
  recent_logs: string[];
}

export interface KgsmBlueprint {
  Name: string;
  Ports: string;
  BlueprintType: string;
  SteamAppId: string;
  IsSteamAccountRequired: string;
  ExecutableFile: string;
  LevelName: string;
  ExecutableSubdirectory: string;
  ExecutableArguments: string;
  StopCommand: string;
  SaveCommand: string;
}

export interface KgsmInstancesResponse {
  [key: string]: KgsmInstance;
}

export interface KgsmBlueprintsResponse {
  [key: string]: KgsmBlueprint;
}

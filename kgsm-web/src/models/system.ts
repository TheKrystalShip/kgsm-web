/**
 * System Models
 *
 * Type definitions for system metrics and related entities
 */

export interface SystemMetric {
  timestamp: number;
  value: number;
  rawValue?: number; // Raw value in bytes for memory, KB for disk
}

export interface CpuCoreMetric {
  core: number;
  usage: number;
  model: string;
  speed: number;
}

export interface CpuHistoryPoint {
  timestamp: number;
  cores: CpuCoreMetric[];
  average: number;
}

export interface SystemMetrics {
  cpu: SystemMetric[];
  cpuCores?: CpuCoreMetric[]; // Current per-core metrics
  cpuHistory?: CpuHistoryPoint[]; // Historical per-core metrics
  cpuModel?: string; // CPU model name
  memory: SystemMetric[];
  disk: {
    used: SystemMetric[];
    free: SystemMetric[];
    total?: number; // Total disk space in GB
  };
  network?: {
    rx: SystemMetric[]; // Received data in KB/s
    tx: SystemMetric[]; // Transmitted data in KB/s
    total?: {
      rx: number; // Total received in MB
      tx: number; // Total transmitted in MB
      rxSpeed: number; // Current rx speed in KB/s
      txSpeed: number; // Current tx speed in KB/s
    };
  };
  systemInfo?: {
    totalMemory: number; // Total memory in MB
    totalDisk: number; // Total disk space in GB
    cpuCores: number; // Number of CPU cores
    cpuModel?: string; // CPU model name
    uptime?: number; // System uptime in seconds
  };
}

export type TimeFrame = '10s' | '1m' | '5m' | '15m' | '30m' | '1h' | '3h' | '6h' | '12h' | '24h';

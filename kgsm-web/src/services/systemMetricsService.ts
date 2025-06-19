/**
 * System Metrics Service
 *
 * Service for retrieving and processing system metrics
 */

import axios from 'axios';
import { ENDPOINTS } from '../api/config';
import {
  SystemMetric,
  SystemMetrics,
  TimeFrame
} from '../models/system';
import { formatUptime } from '../utils/formatting';

class SystemMetricsService {
  private apiEndpoint: string;
  private metrics: SystemMetrics;
  private maxDataPoints = 100; // Maximum number of data points to keep

  // Store system information
  private systemInfo = {
    totalMemory: 32768, // 32 GB in MB
    totalDisk: 1000,    // 1 TB in GB
    cpuCores: 8,        // 8 cores
    cpuModel: 'Unknown CPU',
    uptime: 0           // Uptime in seconds
  };

  constructor() {
    this.apiEndpoint = ENDPOINTS.SYSTEM;

    // Initialize empty metrics arrays
    this.metrics = {
      cpu: [],
      cpuCores: [],
      cpuHistory: [],
      cpuModel: 'Unknown CPU',
      memory: [],
      disk: {
        used: [],
        free: []
      },
      network: {
        rx: [],
        tx: [],
        total: {
          rx: 0,
          tx: 0,
          rxSpeed: 0,
          txSpeed: 0
        }
      }
    };
  }

  /**
   * Get current system metrics
   */
  async getCurrentMetrics(): Promise<SystemMetrics> {
    try {
      const response = await axios.get(`${this.apiEndpoint}/metrics`);

      // Add the new data point to each metric
      const now = Date.now();

      // Add CPU data point
      this.addDataPoint('cpu', { timestamp: now, value: response.data.cpu });

      // Store per-core CPU metrics if available
      if (response.data.cpuCores) {
        this.metrics.cpuCores = response.data.cpuCores;
      }

      // Store CPU history if available
      if (response.data.cpuHistory) {
        this.metrics.cpuHistory = response.data.cpuHistory;
      }

      // Store CPU model if available
      if (response.data.cpuModel) {
        this.metrics.cpuModel = response.data.cpuModel;
      }

      // Add memory data point with raw values
      this.addDataPoint('memory', {
        timestamp: now,
        value: response.data.memory.percent,
        rawValue: response.data.memory.used // Store used memory in MB
      });

      // Add disk data points with raw values
      this.addDataPoint('disk.used', {
        timestamp: now,
        value: response.data.disk.used,
        rawValue: response.data.disk.usedGB // Store used disk in GB
      });

      this.addDataPoint('disk.free', {
        timestamp: now,
        value: response.data.disk.free,
        rawValue: response.data.disk.freeGB // Store free disk in GB
      });

      // Add network data points if available
      if (response.data.network) {
        // Initialize network if it doesn't exist
        if (!this.metrics.network) {
          this.metrics.network = {
            rx: [],
            tx: [],
            total: {
              rx: 0,
              tx: 0,
              rxSpeed: 0,
              txSpeed: 0
            }
          };
        }

        // If server provides complete history, use it
        if (response.data.network.rx && response.data.network.rx.length > 0) {
          this.metrics.network.rx = response.data.network.rx;
        } else if (response.data.network.total) {
          // Otherwise add the current point
          this.addDataPoint('network.rx', {
            timestamp: now,
            value: response.data.network.total.rxSpeed
          });
        }

        if (response.data.network.tx && response.data.network.tx.length > 0) {
          this.metrics.network.tx = response.data.network.tx;
        } else if (response.data.network.total) {
          this.addDataPoint('network.tx', {
            timestamp: now,
            value: response.data.network.total.txSpeed
          });
        }

        // Store total network stats
        if (response.data.network.total && this.metrics.network) {
          this.metrics.network.total = response.data.network.total;
        }
      }

      // Store system info
      if (response.data.systemInfo) {
        const sysInfo = response.data.systemInfo;
        this.systemInfo = {
          totalMemory: sysInfo?.totalMemory || this.systemInfo.totalMemory,
          totalDisk: sysInfo?.totalDisk || this.systemInfo.totalDisk,
          cpuCores: sysInfo?.cpuCores || this.systemInfo.cpuCores,
          cpuModel: sysInfo?.cpuModel || this.systemInfo.cpuModel,
          uptime: sysInfo?.uptime || this.systemInfo.uptime
        };
      } else {
        // Update uptime if not provided by API (for simulation/demo purposes)
        this.systemInfo.uptime += 5;
      }

      const metrics = this.getFilteredMetrics('1m'); // Default to 1 minute timeframe
      metrics.systemInfo = this.systemInfo;

      return metrics;
    } catch (error) {
      console.error('Failed to get system metrics:', error);

      // In development, return mock data if API is not available
      if (process.env.NODE_ENV === 'development') {
        return this.getMockMetrics();
      }

      throw error;
    }
  }

  /**
   * Formats uptime in seconds to a human-readable string
   * @param uptimeSeconds Uptime in seconds
   * @returns Formatted uptime string (e.g., "3d 12h 45m 30s")
   */
  public formatUptime(uptimeSeconds: number): string {
    return formatUptime(uptimeSeconds);
  }

  /**
   * Get system uptime in seconds
   */
  public getUptime(): number {
    return this.systemInfo.uptime;
  }

  /**
   * Get metrics filtered by timeframe
   */
  getFilteredMetrics(timeframe: TimeFrame): SystemMetrics {
    const cutoffTime = this.getCutoffTime(timeframe);

    return {
      cpu: this.metrics.cpu.filter(m => m.timestamp >= cutoffTime),
      cpuCores: this.metrics.cpuCores,
      cpuHistory: this.metrics.cpuHistory?.filter(m => m.timestamp >= cutoffTime),
      cpuModel: this.metrics.cpuModel,
      memory: this.metrics.memory.filter(m => m.timestamp >= cutoffTime),
      disk: {
        used: this.metrics.disk.used.filter(m => m.timestamp >= cutoffTime),
        free: this.metrics.disk.free.filter(m => m.timestamp >= cutoffTime)
      },
      network: this.metrics.network ? {
        rx: this.metrics.network.rx.filter(m => m.timestamp >= cutoffTime),
        tx: this.metrics.network.tx.filter(m => m.timestamp >= cutoffTime),
        total: this.metrics.network.total
      } : undefined
    };
  }

  /**
   * Add a new data point to a specific metric array
   */
  private addDataPoint(metricPath: string, dataPoint: SystemMetric): void {
    // Parse the metric path to find the array to push to
    const pathParts = metricPath.split('.');
    let current: any = this.metrics;

    // Navigate to the target array
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (i === pathParts.length - 1) {
        // We're at the target array, add the data point
        current[part].push(dataPoint);

        // Trim array if it exceeds max data points
        if (current[part].length > this.maxDataPoints) {
          current[part] = current[part].slice(-this.maxDataPoints);
        }
      } else {
        // Continue navigating
        if (!current[part]) {
          // Initialize missing objects in the path
          current[part] = {};
        }
        current = current[part];
      }
    }
  }

  /**
   * Get cutoff timestamp for a given timeframe
   */
  private getCutoffTime(timeframe: TimeFrame): number {
    const now = Date.now();
    switch (timeframe) {
      case '10s': return now - 10 * 1000;
      case '1m': return now - 60 * 1000;
      case '5m': return now - 5 * 60 * 1000;
      case '15m': return now - 15 * 60 * 1000;
      case '30m': return now - 30 * 60 * 1000;
      case '1h': return now - 60 * 60 * 1000;
      case '3h': return now - 3 * 60 * 60 * 1000;
      case '6h': return now - 6 * 60 * 60 * 1000;
      case '12h': return now - 12 * 60 * 60 * 1000;
      case '24h': return now - 24 * 60 * 60 * 1000;
      default: return now - 60 * 1000; // Default to 1m
    }
  }

  /**
   * Get mock metrics for development/preview
   */
  private getMockMetrics(): SystemMetrics {
    // Generate mock metrics
    // (Implementation details omitted for brevity)
    return this.metrics;
  }
}

const systemMetricsService = new SystemMetricsService();
export default systemMetricsService;

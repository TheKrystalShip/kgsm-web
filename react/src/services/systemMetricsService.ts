/**
 * System Metrics Service
 * 
 * Service for retrieving and processing system metrics
 */

import axios from 'axios';

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

class SystemMetricsService {
  private apiEndpoint: string;
  private metrics: SystemMetrics;
  private maxDataPoints = 100; // Maximum number of data points to keep

  // Store system information
  private systemInfo = {
    totalMemory: 32768, // Updated: 32 GB in MB
    totalDisk: 1000,    // Default: 1 TB in GB
    cpuCores: 8,         // Default: 8 cores
    cpuModel: 'Unknown CPU', // Default: Unknown CPU model
    uptime: 0           // Default uptime in seconds
  };

  constructor() {
    this.apiEndpoint = process.env.NODE_ENV === 'production' 
      ? '/api/system' 
      : 'http://localhost:3001/api/system';

    // Initialize empty metrics arrays
    this.metrics = {
      cpu: [],
      cpuCores: [], // Per-core CPU metrics
      cpuHistory: [], // Historical CPU data with per-core metrics
      cpuModel: 'Unknown CPU', // Initialize with unknown CPU model
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
        
        // Store CPU model in systemInfo if available
        if (sysInfo?.cpuModel) {
          this.systemInfo.cpuModel = sysInfo.cpuModel;
        }
        
        // Update uptime if not provided by API (for simulation/demo purposes)
        if (!sysInfo?.uptime) {
          // Increment uptime by the polling interval (typically 5 seconds)
          this.systemInfo.uptime += 5;
        }
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
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
  }
  
  /**
   * Get the current system uptime in seconds
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
      cpu: this.metrics.cpu.filter(metric => metric.timestamp >= cutoffTime),
      cpuCores: this.metrics.cpuCores, // Current per-core metrics (not filtered)
      cpuHistory: this.metrics.cpuHistory?.filter(point => point.timestamp >= cutoffTime), // Filter historical per-core data
      cpuModel: this.metrics.cpuModel, // CPU model name
      memory: this.metrics.memory.filter(metric => metric.timestamp >= cutoffTime),
      disk: {
        used: this.metrics.disk.used.filter(metric => metric.timestamp >= cutoffTime),
        free: this.metrics.disk.free.filter(metric => metric.timestamp >= cutoffTime)
      },
      network: this.metrics.network ? {
        rx: this.metrics.network.rx.filter(metric => metric.timestamp >= cutoffTime),
        tx: this.metrics.network.tx.filter(metric => metric.timestamp >= cutoffTime),
        total: this.metrics.network.total
      } : undefined
    };
  }

  /**
   * Add a data point to a specific metric
   */
  private addDataPoint(metricPath: string, dataPoint: SystemMetric): void {
    // Handle nested paths like 'disk.used'
    if (metricPath.includes('.')) {
      const [parent, child] = metricPath.split('.');
      if (parent === 'disk' && (child === 'used' || child === 'free')) {
        this.metrics.disk[child].push(dataPoint);
        
        // Trim if exceeding max data points
        if (this.metrics.disk[child].length > this.maxDataPoints) {
          this.metrics.disk[child].shift();
        }
      } else if (parent === 'network' && (child === 'rx' || child === 'tx')) {
        // Ensure network object exists
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
        
        this.metrics.network[child].push(dataPoint);
        
        // Trim if exceeding max data points
        if (this.metrics.network[child].length > this.maxDataPoints) {
          this.metrics.network[child].shift();
        }
      }
    } else {
      // Handle top-level metrics like 'cpu' and 'memory'
      (this.metrics as any)[metricPath].push(dataPoint);
      
      // Trim if exceeding max data points
      if ((this.metrics as any)[metricPath].length > this.maxDataPoints) {
        (this.metrics as any)[metricPath].shift();
      }
    }
  }

  /**
   * Get cutoff time for a specific timeframe
   */
  private getCutoffTime(timeframe: TimeFrame): number {
    const now = Date.now();
    
    switch (timeframe) {
      case '10s':
        return now - (10 * 1000);
      case '1m':
        return now - (60 * 1000);
      case '5m':
        return now - (5 * 60 * 1000);
      case '1h':
        return now - (60 * 60 * 1000);
      case '24h':
        return now - (24 * 60 * 60 * 1000);
      default:
        return now - (60 * 1000); // Default to 1 minute
    }
  }

  /**
   * Get mock metrics data for development
   */
  private getMockMetrics(): SystemMetrics {
    const mockMetrics: SystemMetrics = {
      cpu: [],
      cpuCores: [], // Will be populated below
      cpuHistory: [], // Will be populated below
      cpuModel: 'Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz', // Mock CPU model
      memory: [],
      disk: {
        used: [],
        free: []
      },
      network: {
        rx: [],
        tx: [],
        total: {
          rx: 125.7,
          tx: 42.3,
          rxSpeed: 256,
          txSpeed: 128
        }
      },
      systemInfo: {
        ...this.systemInfo,
        cpuModel: 'Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz' // Mock CPU model
      }
    };
    
    // Generate mock data points for the last 10 minutes
    const now = Date.now();
    for (let i = 60; i >= 0; i--) {
      const timestamp = now - (i * 10 * 1000); // Data point every 10 seconds
      
      // CPU usage (percentage)
      const cpuAvg = Math.random() * 100; // Random CPU percentage
      mockMetrics.cpu.push({
        timestamp,
        value: cpuAvg
      });
      
      // Generate mock per-core data for this timestamp
      const cores = [];
      for (let j = 0; j < this.systemInfo.cpuCores; j++) {
        cores.push({
          core: j,
          usage: Math.min(cpuAvg * (0.7 + Math.random() * 0.6), 100), // Somewhat random but related to overall CPU
          model: `Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz`,
          speed: 2900
        });
      }
      
      // Add to CPU history
      mockMetrics.cpuHistory?.push({
        timestamp,
        cores,
        average: cpuAvg
      });
      
      // Memory usage (percentage and raw MB)
      const memPercent = 30 + Math.random() * 40; // Memory usage between 30% and 70%
      const memRawMB = Math.round((memPercent / 100) * this.systemInfo.totalMemory);
      mockMetrics.memory.push({
        timestamp,
        value: memPercent,
        rawValue: memRawMB
      });
      
      // Disk usage (percentage and raw GB)
      const diskUsedPercent = 50 + Math.random() * 20; // Disk usage between 50% and 70%
      const diskFreePercent = 100 - diskUsedPercent;
      
      const diskUsedGB = Math.round((diskUsedPercent / 100) * this.systemInfo.totalDisk * 100) / 100;
      const diskFreeGB = Math.round((diskFreePercent / 100) * this.systemInfo.totalDisk * 100) / 100;
      
      mockMetrics.disk.used.push({
        timestamp,
        value: diskUsedPercent,
        rawValue: diskUsedGB
      });
      
      mockMetrics.disk.free.push({
        timestamp,
        value: diskFreePercent,
        rawValue: diskFreeGB
      });
      
      // Network usage (KB/s)
      const rxSpeed = 100 + Math.random() * 400; // Random receive speed between 100-500 KB/s
      const txSpeed = 50 + Math.random() * 200;  // Random transmit speed between 50-250 KB/s
      
      if (mockMetrics.network) {
        mockMetrics.network.rx.push({
          timestamp,
          value: rxSpeed
        });
        
        mockMetrics.network.tx.push({
          timestamp,
          value: txSpeed
        });
      }
    }
    
    // Set current CPU cores data
    mockMetrics.cpuCores = mockMetrics.cpuHistory?.[mockMetrics.cpuHistory.length - 1].cores || [];
    
    return mockMetrics;
  }
}

// Create and export a singleton instance
const systemMetricsService = new SystemMetricsService();
export default systemMetricsService;

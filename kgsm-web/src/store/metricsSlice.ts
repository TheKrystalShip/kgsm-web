import { createSlice, createAsyncThunk, PayloadAction, createSelector } from '@reduxjs/toolkit';
import systemMetricsService from '../services/systemMetricsService';
import {
  SystemMetrics,
  TimeFrame,
  SystemMetric,
} from '../models/system';
import { RootState } from './index';

// Define the type for our metrics state
interface MetricsState {
  data: SystemMetrics | null;
  timeframe: TimeFrame;
  updateInterval: number; // New: update interval in milliseconds
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

// Initial state
const initialState: MetricsState = {
  data: null,
  timeframe: '1m',
  updateInterval: 30000, // Default: 30 seconds (reduced for performance)
  loading: false,
  error: null,
  lastUpdated: null,
};

// Create an async thunk for fetching metrics
export const fetchMetrics = createAsyncThunk(
  'metrics/fetchMetrics',
  async (timeframe: TimeFrame, { rejectWithValue }) => {
    try {
      // First get the current metrics which updates the service's internal state
      await systemMetricsService.getCurrentMetrics();
      // Then get filtered metrics based on the timeframe
      const metrics = systemMetricsService.getFilteredMetrics(timeframe);
      // Ensure systemInfo is included in the metrics
      if (!metrics.systemInfo) {
        // If systemInfo is missing, include the service's default values
        metrics.systemInfo = {
          totalMemory: 32768, // 32 GB in MB
          totalDisk: 1000,    // 1 TB in GB
          cpuCores: 8,
          cpuModel: 'Unknown CPU',
          uptime: 0
        };
      }
      return metrics;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch metrics');
    }
  }
);

// Create the metrics slice
const metricsSlice = createSlice({
  name: 'metrics',
  initialState,
  reducers: {
    setTimeframe: (state, action: PayloadAction<TimeFrame>) => {
      state.timeframe = action.payload;
    },
    setUpdateInterval: (state, action: PayloadAction<number>) => {
      state.updateInterval = action.payload;
    },
    clearMetrics: (state) => {
      state.data = null;
      state.lastUpdated = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMetrics.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMetrics.fulfilled, (state, action: PayloadAction<SystemMetrics>) => {
        state.loading = false;
        state.data = action.payload;
        state.lastUpdated = Date.now();
      })
      .addCase(fetchMetrics.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

// Export actions and reducer
export const { setTimeframe, setUpdateInterval, clearMetrics } = metricsSlice.actions;
export default metricsSlice.reducer;

// Basic selectors
const getMetricsState = (state: RootState) => state.metrics;
export const selectMetricsLoading = (state: RootState) => state.metrics.loading;
export const selectMetricsError = (state: RootState) => state.metrics.error;
export const selectTimeframe = (state: RootState) => state.metrics.timeframe;
export const selectUpdateInterval = (state: RootState) => state.metrics.updateInterval;
export const selectLastUpdated = (state: RootState) => state.metrics.lastUpdated;

// Create memoized selectors using createSelector
export const selectMetricsData = createSelector(
  [getMetricsState],
  (metricsState) => metricsState.data
);

// Specific data selectors with memoization
export const selectCPUMetrics = createSelector(
  [getMetricsState],
  (metricsState): SystemMetric[] => metricsState.data?.cpu || []
);

export const selectCPUCoresData = createSelector(
  [getMetricsState],
  (metricsState) => metricsState.data?.cpuCores || []
);

export const selectCPUCoresHistory = createSelector(
  [getMetricsState],
  (metricsState) => metricsState.data?.cpuHistory || []
);

export const selectMemoryMetrics = createSelector(
  [getMetricsState],
  (metricsState): SystemMetric[] => metricsState.data?.memory || []
);

export const selectMemoryData = createSelector(
  [getMetricsState],
  (metricsState) => {
    const memData = metricsState.data?.memory;
    const totalMemory = metricsState.data?.systemInfo?.totalMemory || 0;
    return {
      data: memData || [],
      total: totalMemory
    };
  }
);

export const selectDiskMetrics = createSelector(
  [getMetricsState],
  (metricsState) => {
    const diskData = metricsState.data?.disk;
    return {
      used: diskData?.used || [],
      free: diskData?.free || [],
      total: metricsState.data?.systemInfo?.totalDisk || 0
    };
  }
);

export const selectNetworkMetrics = createSelector(
  [getMetricsState],
  (metricsState) => {
    const networkData = metricsState.data?.network;
    return {
      rx: networkData?.rx || [],
      tx: networkData?.tx || [],
      total: networkData?.total || null
    };
  }
);

export const selectSystemInfo = createSelector(
  [getMetricsState],
  (metricsState) => {
    // Return systemInfo if it exists, or create a default with service default values
    if (metricsState.data?.systemInfo) {
      // Use top-level cpuModel as fallback if systemInfo.cpuModel is not available
      const cpuModel = metricsState.data.systemInfo.cpuModel || metricsState.data.cpuModel || 'Unknown CPU';
      return {
        ...metricsState.data.systemInfo,
        cpuModel
      };
    }
    // Provide sensible defaults if we don't have system info, but try to use top-level cpuModel
    return {
      totalMemory: 32768, // 32 GB in MB
      totalDisk: 1000,    // 1 TB in GB
      cpuCores: 8,
      cpuModel: metricsState.data?.cpuModel || 'Unknown CPU',
      uptime: 0
    };
  }
);

// Utility function for statistics (moved from hooks)
export const getStatistics = (data: number[]) => {
  if (!data || data.length === 0) {
    return { min: 0, max: 0, avg: 0, current: 0 };
  }

  const validData = data.filter(val => val !== null && !isNaN(val));
  if (validData.length === 0) {
    return { min: 0, max: 0, avg: 0, current: 0 };
  }

  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const avg = validData.reduce((a: number, b: number) => a + b, 0) / validData.length;
  const current = validData[validData.length - 1];

  return { min, max, avg, current };
};

// Memoized selectors for each metric's statistics
export const selectCpuStatistics = createSelector(
  [selectCPUMetrics],
  (cpuMetrics) => {
    const cpuValues = cpuMetrics.map(m => m.value);
    return getStatistics(cpuValues);
  }
);

export const selectMemoryStatistics = createSelector(
  [selectMemoryMetrics],
  (memoryMetrics) => {
    const memValues = memoryMetrics.map(m => m.rawValue || m.value);
    return getStatistics(memValues);
  }
);

export const selectDiskUsedStatistics = createSelector(
  [selectDiskMetrics],
  (diskMetrics) => {
    const diskValues = diskMetrics.used.map(d => d.rawValue || d.value);
    return getStatistics(diskValues);
  }
);

export const selectDiskFreeStatistics = createSelector(
  [selectDiskMetrics],
  (diskMetrics) => {
    const diskValues = diskMetrics.free.map(d => d.rawValue || d.value);
    return getStatistics(diskValues);
  }
);

// Chart data selectors
export const selectProcessedMemoryData = createSelector(
  [selectMemoryMetrics],
  (memoryMetrics) => memoryMetrics.map(m => ({
    ...m,
    value: m.rawValue || m.value
  }))
);

export const selectProcessedDiskData = createSelector(
  [selectDiskMetrics],
  (diskMetrics) => [
    ...diskMetrics.used.map(d => ({
      ...d,
      value: d.rawValue || d.value,
      type: 'Used'
    })),
    ...diskMetrics.free.map(d => ({
      ...d,
      value: d.rawValue || d.value,
      type: 'Free'
    }))
  ]
);

export const selectProcessedNetworkData = createSelector(
  [selectNetworkMetrics],
  (networkMetrics) => [
    ...networkMetrics.rx.map(d => ({
      ...d,
      type: 'Download'
    })),
    ...networkMetrics.tx.map(d => ({
      ...d,
      type: 'Upload'
    }))
  ]
);

export const selectMaxMemoryValue = createSelector(
  [selectMemoryMetrics],
  (memoryMetrics) => {
    if (!memoryMetrics || memoryMetrics.length === 0) return 0;
    return Math.max(...memoryMetrics.map(m => m.rawValue || m.value));
  }
);

export const selectAdjustedTotalMemory = createSelector(
  [selectSystemInfo, selectMaxMemoryValue],
  (systemInfo, maxMemoryValue) => Math.max(systemInfo.totalMemory || 0, maxMemoryValue)
);

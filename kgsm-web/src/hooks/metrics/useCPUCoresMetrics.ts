import { useState, useEffect, useCallback } from 'react';
import {
  SystemMetric,
  TimeFrame,
  CpuCoreMetric
} from '../../models/system';
import systemMetricsService from '../../services/systemMetricsService';

interface CoreMetric extends SystemMetric {
  core: number;
}

/**
 * Custom hook for fetching and managing CPU cores metrics
 * Provides per-core CPU usage data
 */
export const useCPUCoresMetrics = (timeframe: TimeFrame) => {
  const [data, setData] = useState<CoreMetric[]>([]);
  const [cpuCores, setCpuCores] = useState<CpuCoreMetric[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Calculate statistics for a specific core
  const getCoreStatistics = useCallback((coreNumber: number) => {
    const coreData = data.filter(metric => metric.core === coreNumber).map(m => m.value);

    if (coreData.length === 0) return { min: 0, max: 0, avg: 0 };

    const min = Math.min(...coreData);
    const max = Math.max(...coreData);
    const sum = coreData.reduce((acc, val) => acc + val, 0);
    const avg = sum / coreData.length;

    return { min, max, avg };
  }, [data]);

  // Fetch CPU core metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch current metrics
      await systemMetricsService.getCurrentMetrics();

      // Get the metrics from the service
      const metrics = systemMetricsService.getFilteredMetrics(timeframe);

      // Extract core metrics from cpuHistory
      if (metrics.cpuHistory && metrics.cpuHistory.length > 0) {
        // Transform the data for the chart
        const coreMetrics: CoreMetric[] = [];

        metrics.cpuHistory.forEach(point => {
          point.cores.forEach(core => {
            coreMetrics.push({
              timestamp: point.timestamp,
              value: core.usage,
              core: core.core
            });
          });
        });

        setData(coreMetrics);

        // Set current CPU cores info
        if (metrics.cpuCores && metrics.cpuCores.length > 0) {
          setCpuCores(metrics.cpuCores);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch CPU core metrics'));
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  // Set up polling interval for metrics
  useEffect(() => {
    fetchMetrics();

    // Poll every 5 seconds
    const interval = setInterval(fetchMetrics, 5000);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  return {
    data,
    loading,
    error,
    cpuCores,
    getCoreStatistics,
  };
};

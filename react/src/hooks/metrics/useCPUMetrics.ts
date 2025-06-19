import { useState, useEffect, useCallback } from 'react';
import systemMetricsService, { SystemMetric, TimeFrame } from '../../services/systemMetricsService';

/**
 * Custom hook for fetching and managing CPU metrics
 */
export const useCPUMetrics = (timeframe: TimeFrame) => {
  const [data, setData] = useState<SystemMetric[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Calculate statistics
  const getStatistics = useCallback((metricData: number[]) => {
    if (metricData.length === 0) return { min: 0, max: 0, avg: 0 };
    
    const min = Math.min(...metricData);
    const max = Math.max(...metricData);
    const sum = metricData.reduce((acc, val) => acc + val, 0);
    const avg = sum / metricData.length;
    
    return { min, max, avg };
  }, []);
  
  // Fetch CPU metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await systemMetricsService.getCurrentMetrics();
      const metrics = systemMetricsService.getFilteredMetrics(timeframe);
      setData(metrics.cpu);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch CPU metrics'));
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
    getStatistics,
  };
};

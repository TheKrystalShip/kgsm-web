import { useState, useEffect, useCallback } from 'react';
import systemMetricsService, { SystemMetrics, TimeFrame } from '../services/systemMetricsService';

/**
 * Custom hook for fetching and managing system metrics
 */
export const useSystemMetrics = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [timeframe, setTimeframe] = useState<TimeFrame>('1m');
  
  // Fetch current metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await systemMetricsService.getCurrentMetrics();
      setMetrics(systemMetricsService.getFilteredMetrics(timeframe));
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch system metrics'));
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  // Change the timeframe
  const changeTimeframe = useCallback((newTimeframe: TimeFrame) => {
    setTimeframe(newTimeframe);
    
    // If we have metrics, filter them by the new timeframe
    if (metrics) {
      setMetrics(systemMetricsService.getFilteredMetrics(newTimeframe));
    }
  }, [metrics]);

  // Set up polling interval for metrics
  useEffect(() => {
    fetchMetrics();
    
    // Poll every 5 seconds
    const interval = setInterval(fetchMetrics, 5000);
    
    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Calculate statistics
  const getStatistics = useCallback((metricData: number[]) => {
    if (metricData.length === 0) return { min: 0, max: 0, avg: 0 };
    
    const min = Math.min(...metricData);
    const max = Math.max(...metricData);
    const sum = metricData.reduce((acc, val) => acc + val, 0);
    const avg = sum / metricData.length;
    
    return { min, max, avg };
  }, []);

  return {
    metrics,
    loading,
    error,
    timeframe,
    changeTimeframe,
    getStatistics,
  };
};

import { useState, useEffect, useCallback } from 'react';
import systemMetricsService, { SystemMetric, TimeFrame } from '../../services/systemMetricsService';

/**
 * Custom hook for fetching and managing Disk metrics
 */
export const useDiskMetrics = (timeframe: TimeFrame) => {
  const [usedData, setUsedData] = useState<SystemMetric[]>([]);
  const [freeData, setFreeData] = useState<SystemMetric[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [totalDisk, setTotalDisk] = useState<number>(1000); // Default 1TB in GB
  
  // Calculate statistics
  const getStatistics = useCallback((metricData: number[]) => {
    if (metricData.length === 0) return { min: 0, max: 0, avg: 0 };
    
    const min = Math.min(...metricData);
    const max = Math.max(...metricData);
    const sum = metricData.reduce((acc, val) => acc + val, 0);
    const avg = sum / metricData.length;
    
    return { min, max, avg };
  }, []);
  
  // Format GB to a human-readable string
  const formatValue = useCallback((gb: number) => {
    return `${gb.toFixed(2)} GB`;
  }, []);
  
  // Fetch Disk metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await systemMetricsService.getCurrentMetrics();
      const metrics = systemMetricsService.getFilteredMetrics(timeframe);
      setUsedData(metrics.disk.used);
      setFreeData(metrics.disk.free);
      
      if (metrics.systemInfo?.totalDisk) {
        setTotalDisk(metrics.systemInfo.totalDisk);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch disk metrics'));
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
    usedData,
    freeData,
    loading,
    error,
    totalDisk,
    getStatistics,
    formatValue,
  };
};

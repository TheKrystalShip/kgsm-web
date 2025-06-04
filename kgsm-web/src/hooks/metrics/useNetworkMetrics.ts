import { useState, useEffect, useCallback } from 'react';
import systemMetricsService, { SystemMetric, TimeFrame } from '../../services/systemMetricsService';

interface NetworkTotal {
  rx: number;
  tx: number;
  rxSpeed: number;
  txSpeed: number;
}

/**
 * Custom hook for fetching and managing Network metrics
 */
export const useNetworkMetrics = (timeframe: TimeFrame) => {
  const [rxData, setRxData] = useState<SystemMetric[]>([]);
  const [txData, setTxData] = useState<SystemMetric[]>([]);
  const [totalData, setTotalData] = useState<NetworkTotal | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Format KB/s to a human-readable string
  const formatValue = useCallback((kbps: number) => {
    if (kbps >= 1024) {
      return `${(kbps / 1024).toFixed(2)} MB/s`;
    }
    return `${kbps.toFixed(0)} KB/s`;
  }, []);
  
  // Fetch Network metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      await systemMetricsService.getCurrentMetrics();
      const metrics = systemMetricsService.getFilteredMetrics(timeframe);
      
      if (metrics.network) {
        setRxData(metrics.network.rx);
        setTxData(metrics.network.tx);
        setTotalData(metrics.network.total || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch network metrics'));
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
    rxData,
    txData,
    totalData,
    loading,
    error,
    formatValue,
  };
};

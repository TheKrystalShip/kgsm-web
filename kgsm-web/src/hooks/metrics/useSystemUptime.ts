import { useState, useEffect } from 'react';
import systemMetricsService from '../../services/systemMetricsService';

/**
 * Custom hook for fetching and displaying system uptime
 * Provides formatted uptime string and updates it automatically
 * Optimized for reduced GPU usage with 10-second intervals
 */
export const useSystemUptime = () => {
  const [uptime, setUptime] = useState<number>(0);
  const [formattedUptime, setFormattedUptime] = useState<string>('');

  useEffect(() => {
    // Initial fetch
    const fetchUptime = () => {
      const currentUptime = systemMetricsService.getUptime();
      setUptime(currentUptime);
      setFormattedUptime(systemMetricsService.formatUptime(currentUptime));
    };

    fetchUptime();

    // Update the uptime display every 10 seconds (reduced from 1 second for performance)
    const interval = setInterval(fetchUptime, 10000);

    return () => clearInterval(interval);
  }, []);

  return { uptime, formattedUptime };
};

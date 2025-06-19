import { useState, useEffect } from 'react';
import systemMetricsService from '../../services/systemMetricsService';

/**
 * Custom hook for fetching and displaying system uptime
 * Provides formatted uptime string and updates it automatically
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
    
    // Update the uptime display every second
    const interval = setInterval(fetchUptime, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return { uptime, formattedUptime };
};

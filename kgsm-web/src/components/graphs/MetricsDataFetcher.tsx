import React, { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchMetrics, selectTimeframe, selectLastUpdated } from '../../store/metricsSlice';

/**
 * Component that fetches metrics data at regular intervals
 * This component doesn't render anything visible - it just handles data fetching
 */
const MetricsDataFetcher: React.FC = () => {
  const dispatch = useAppDispatch();
  const timeframe = useAppSelector(selectTimeframe);
  const lastUpdated = useAppSelector(selectLastUpdated);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Fetch metrics immediately on mount or timeframe change
    dispatch(fetchMetrics(timeframe));
    
    // Set up polling every 10 seconds
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    intervalRef.current = setInterval(() => {
      dispatch(fetchMetrics(timeframe));
    }, 10000);
    
    // Clean up on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [dispatch, timeframe]);

  return null; // This component doesn't render anything
};

export default MetricsDataFetcher;

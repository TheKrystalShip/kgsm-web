import { useState, useCallback } from 'react';
import { TimeFrame } from '../../models/system';

/**
 * Custom hook for managing timeframe selection across all metric charts
 */
export const useTimeframeSelection = (defaultTimeframe: TimeFrame = '1h') => {
  const [timeframe, setTimeframe] = useState<TimeFrame>(defaultTimeframe);

  // Available timeframe options
  const timeframeOptions: TimeFrame[] = ['10s', '1m', '5m', '1h', '24h'];

  // Change the timeframe
  const changeTimeframe = useCallback((newTimeframe: TimeFrame) => {
    setTimeframe(newTimeframe);
  }, []);

  return {
    timeframe,
    timeframeOptions,
    changeTimeframe,
  };
};

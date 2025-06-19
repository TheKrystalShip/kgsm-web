import React, { useMemo } from 'react';
import { TimeFrame } from '../../../models/system';
import BaseChart from './BaseChart';
import { useAppSelector } from '../../../store/hooks';
import {
  selectProcessedMemoryData,
  selectMetricsLoading,
  selectMetricsError,
  selectAdjustedTotalMemory
} from '../../../store/metricsSlice';

interface MemoryChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering memory usage charts using central Redux store
 */
const MemoryChart: React.FC<MemoryChartProps> = ({ timeframe }) => {
  const processedData = useAppSelector(selectProcessedMemoryData);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  const totalMemory = useAppSelector(selectAdjustedTotalMemory);

  // Format memory values to readable format
  const formatValue = (value: number): string => {
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(value)} MB`;
  };

  // Process data to ensure we're using rawValue
  const memoizedProcessedData = useMemo(() => {
    return processedData.map(m => ({
      ...m,
      value: m.rawValue || m.value
    }));
  }, [processedData]);

  if (loading && (!processedData || processedData.length === 0)) {
    return <div className="loading-chart">Loading memory data...</div>;
  }

  if (error) {
    return <div className="error-chart">Error loading memory data</div>;
  }

  if (!processedData || processedData.length === 0) {
    return <div className="empty-chart">No memory data available</div>;
  }

  return (
    <BaseChart
      data={memoizedProcessedData}
      dataKey="value"
      color="var(--color-orange)"
      displayInGB={true}
      domainMax={totalMemory}
      totalValue={totalMemory}
      formatValue={formatValue}
    />
  );
};

export default MemoryChart;

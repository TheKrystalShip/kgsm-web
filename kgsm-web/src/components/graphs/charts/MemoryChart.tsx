import React, { useMemo } from 'react';
import { TimeFrame } from '../../../models/system';
import BaseChart from './BaseChart';
import { useAppSelector } from '../../../store/hooks';
import {
  selectMemoryMetrics,
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
  const memoryData = useAppSelector(selectMemoryMetrics);
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

  // Process data to create used and free memory entries similar to disk chart
  const processedData = useMemo(() => {
    if (!memoryData || memoryData.length === 0) return [];

    const result: any[] = [];

    memoryData.forEach(item => {
      const usedMemory = item.rawValue || item.value;
      const freeMemory = Math.max(0, totalMemory - usedMemory);

      // Add used memory entry
      result.push({
        ...item,
        value: usedMemory,
        type: 'Used'
      });

      // Add free memory entry
      result.push({
        ...item,
        value: freeMemory,
        type: 'Free'
      });
    });

    return result;
  }, [memoryData, totalMemory]);

  // Check if we have used data entries
  const hasData = processedData.some(item => item.type === 'Used');

  if (loading && !hasData) {
    return <div className="loading-chart">Loading memory data...</div>;
  }

  if (error) {
    return <div className="error-chart">Error loading memory data</div>;
  }

  if (!hasData) {
    return <div className="empty-chart">No memory data available</div>;
  }

  return (
    <BaseChart
      data={processedData}
      dataKey="value"
      color="var(--color-orange)"
      secondaryColor="var(--color-green)"
      stacked={true}
      multipleLines={true}
      lineDataKey="type"
      displayInGB={true}
      totalValue={totalMemory}
      formatValue={formatValue}
    />
  );
};

export default MemoryChart;

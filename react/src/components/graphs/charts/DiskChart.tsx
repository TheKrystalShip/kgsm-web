import React from 'react';
import { TimeFrame } from '../../../services/systemMetricsService';
import BaseChart from './BaseChart';
import { useAppSelector } from '../../../store/hooks';
import { 
  selectProcessedDiskData, 
  selectMetricsLoading, 
  selectMetricsError, 
  selectSystemInfo 
} from '../../../store/metricsSlice';

interface DiskChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering disk usage charts using central Redux store
 */
const DiskChart: React.FC<DiskChartProps> = ({ timeframe }) => {
  const processedData = useAppSelector(selectProcessedDiskData);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  const systemInfo = useAppSelector(selectSystemInfo);
  const totalDisk = systemInfo?.totalDisk || 0;
  
  // Format disk values to readable format
  const formatValue = (value: number): string => {
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} TB`;
    }
    return `${value.toFixed(1)} GB`;
  };
  
  // Get used data entries for checking if we have data
  const hasData = processedData.some(item => item.type === 'Used');
  
  if (loading && !hasData) {
    return <div className="loading-chart">Loading disk data...</div>;
  }
  
  if (error) {
    return <div className="error-chart">Error loading disk data</div>;
  }
  
  if (!hasData) {
    return <div className="empty-chart">No disk data available</div>;
  }
  
  return (
    <BaseChart
      data={processedData}
      dataKey="value"
      color="var(--color-green)"
      secondaryColor="var(--color-orange)"
      stacked={true}
      multipleLines={true}
      lineDataKey="type"
      displayInGB={true}
      totalValue={totalDisk}
      formatValue={formatValue}
    />
  );
};

export default DiskChart;

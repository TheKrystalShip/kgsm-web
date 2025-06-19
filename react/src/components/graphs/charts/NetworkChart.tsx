import React from 'react';
import { TimeFrame } from '../../../services/systemMetricsService';
import BaseChart from './BaseChart';
import { useAppSelector } from '../../../store/hooks';
import { 
  selectProcessedNetworkData, 
  selectMetricsLoading, 
  selectMetricsError,
  selectNetworkMetrics
} from '../../../store/metricsSlice';

interface NetworkChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering network traffic charts using central Redux store
 */
const NetworkChart: React.FC<NetworkChartProps> = ({ timeframe }) => {
  const processedData = useAppSelector(selectProcessedNetworkData);
  const networkMetrics = useAppSelector(selectNetworkMetrics);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  
  // Format network speed to readable format
  const formatValue = (value: number): string => {
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} MB/s`;
    }
    return `${value.toFixed(1)} KB/s`;
  };
  
  // Check if we have download data
  const hasDownloadData = networkMetrics.rx && networkMetrics.rx.length > 0;
  
  if (loading && !hasDownloadData) {
    return <div className="loading-chart">Loading network data...</div>;
  }
  
  if (error) {
    return <div className="error-chart">Error loading network data</div>;
  }
  
  if (!hasDownloadData) {
    return <div className="empty-chart">No network data available</div>;
  }
  
  return (
    <BaseChart
      data={processedData}
      dataKey="value"
      yAxisLabel="KB/s"
      color="var(--color-blue)"
      secondaryColor="var(--color-green)"
      multipleLines={true}
      lineDataKey="type"
      formatValue={formatValue}
      domainMax="auto"
    />
  );
};

export default NetworkChart;

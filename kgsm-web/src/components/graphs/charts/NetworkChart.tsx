import React from 'react';
import { useNetworkMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import BaseChart from './BaseChart';

interface NetworkChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering network traffic charts with self-contained data fetching
 */
const NetworkChart: React.FC<NetworkChartProps> = ({ timeframe }) => {
  const { rxData, txData, loading, error, formatValue } = useNetworkMetrics(timeframe);
  
  if (loading && rxData.length === 0) {
    return <div className="loading-chart">Loading network data...</div>;
  }
  
  if (error) {
    return <div className="error-chart">Error loading network data</div>;
  }
  
  if (rxData.length === 0) {
    return <div className="empty-chart">No network data available</div>;
  }
  
  const processedData = [
    ...rxData.map(d => ({ 
      ...d, 
      type: 'Download' 
    })),
    ...txData.map(d => ({ 
      ...d, 
      type: 'Upload' 
    }))
  ];
  
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

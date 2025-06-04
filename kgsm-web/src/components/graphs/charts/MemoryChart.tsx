import React from 'react';
import { useMemoryMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import BaseChart from './BaseChart';

interface MemoryChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering memory usage charts with self-contained data fetching
 */
const MemoryChart: React.FC<MemoryChartProps> = ({ timeframe }) => {
  const { data, loading, error, totalMemory, formatValue } = useMemoryMetrics(timeframe);
  
  if (loading && data.length === 0) {
    return <div className="loading-chart">Loading memory data...</div>;
  }
  
  if (error) {
    return <div className="error-chart">Error loading memory data</div>;
  }
  
  if (data.length === 0) {
    return <div className="empty-chart">No memory data available</div>;
  }
  
  const processedData = data.map(m => ({ 
    ...m, 
    value: m.rawValue || 0 
  }));
  
  return (
    <BaseChart
      data={processedData}
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

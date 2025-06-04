import React from 'react';
import { useCPUMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import BaseChart from './BaseChart';
import './Charts.css';

interface CPUChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering CPU usage charts with self-contained data fetching
 */
const CPUChart: React.FC<CPUChartProps> = ({ timeframe }) => {
  const { data, loading, error } = useCPUMetrics(timeframe);
  
  if (loading && data.length === 0) {
    return <div className="loading-chart">Loading CPU data...</div>;
  }
  
  if (error) {
    return <div className="error-chart">Error loading CPU data</div>;
  }
  
  if (data.length === 0) {
    return <div className="empty-chart">No CPU data available</div>;
  }
  
  return (
    <BaseChart
      data={data}
      dataKey="value"
      yAxisLabel="%"
      color="var(--color-green)"
      domainMax={100}
      showWarningThreshold={true}
      warningThreshold={80}
    />
  );
};

export default CPUChart;

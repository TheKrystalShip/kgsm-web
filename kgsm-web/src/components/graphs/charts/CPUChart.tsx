import React from 'react';
import { TimeFrame } from '../../../models/system';
import BaseChart from './BaseChart';
import './Charts.css';
import { useAppSelector } from '../../../store/hooks';
import { selectCPUMetrics, selectMetricsLoading, selectMetricsError } from '../../../store/metricsSlice';

interface CPUChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering CPU usage charts using central Redux store
 */
const CPUChart: React.FC<CPUChartProps> = ({ timeframe }) => {
  const data = useAppSelector(selectCPUMetrics);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);

  if (loading && (!data || data.length === 0)) {
    return <div className="loading-chart">Loading CPU data...</div>;
  }

  if (error) {
    return <div className="error-chart">Error loading CPU data</div>;
  }

  if (!data || data.length === 0) {
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

import React from 'react';
import { useDiskMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import BaseChart from './BaseChart';

interface DiskChartProps {
  timeframe: TimeFrame;
}

/**
 * Component for rendering disk usage charts with self-contained data fetching
 */
const DiskChart: React.FC<DiskChartProps> = ({ timeframe }) => {
  const { usedData, freeData, loading, error, totalDisk, formatValue } = useDiskMetrics(timeframe);
  
  if (loading && usedData.length === 0) {
    return <div className="loading-chart">Loading disk data...</div>;
  }
  
  if (error) {
    return <div className="error-chart">Error loading disk data</div>;
  }
  
  if (usedData.length === 0) {
    return <div className="empty-chart">No disk data available</div>;
  }
  
  const processedData = [
    ...usedData.map(d => ({ 
      ...d, 
      value: d.rawValue || 0,
      type: 'Used' 
    })),
    ...freeData.map(d => ({ 
      ...d, 
      value: d.rawValue || 0,
      type: 'Free' 
    }))
  ];
  
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
      domainMax={totalDisk}
      formatValue={formatValue}
    />
  );
};

export default DiskChart;

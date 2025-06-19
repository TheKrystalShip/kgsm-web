import React from 'react';
import { TimeFrame } from '../../../models/system';
import { MemoryChart } from '../charts';
import '../SystemMetrics.css';
import { useAppSelector } from '../../../store/hooks';
import { selectMemoryMetrics, selectMetricsLoading, selectMetricsError, selectSystemInfo, selectMemoryStatistics } from '../../../store/metricsSlice';

interface MemoryMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays Memory metrics chart and statistics
 */
const MemoryMetricCard: React.FC<MemoryMetricCardProps> = ({ timeframe }) => {
  const data = useAppSelector(selectMemoryMetrics);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  const systemInfo = useAppSelector(selectSystemInfo);
  const totalMemory = systemInfo?.totalMemory || 0;
  const stats = useAppSelector(selectMemoryStatistics);

  // Format memory values to readable format
  const formatValue = (value: number): string => {
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} GB`;
    }
    return `${Math.round(value)} MB`;
  };

  // Calculate free memory and ensure it's not negative
  const freeMemMB = Math.max(0, totalMemory - stats.avg);

  // If the system info reports a total memory that's less than the used memory,
  // adjust the total to be at least the used memory
  const adjustedTotalMemory = Math.max(totalMemory, stats.avg);

  return (
    <div className="metric-card">
      <h3 className="metric-title">Memory Usage</h3>
      {data && data.length > 0 ? (
        <>
          <div className="memory-chart">
            <MemoryChart timeframe={timeframe} />
          </div>
          <div className="metric-stats memory-stats">
            <div className="stat-item memory-total">
              <span className="stat-label">Total:</span>
              <span className="stat-value">{formatValue(adjustedTotalMemory)}</span>
            </div>
            <div className="stat-item memory-used">
              <span className="stat-label">Used:</span>
              <span className="stat-value">{formatValue(stats.avg)}</span>
            </div>
            <div className="stat-item memory-free">
              <span className="stat-label">Free:</span>
              <span className="stat-value">{formatValue(freeMemMB)}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {loading ? "Loading memory data..." : error ? "Error loading memory data" : "No data available"}
        </div>
      )}
    </div>
  );
};

export default MemoryMetricCard;

import React from 'react';
import { TimeFrame } from '../../../models/system';
import { DiskChart } from '../charts';
import '../SystemMetrics.css';
import { useAppSelector } from '../../../store/hooks';
import {
  selectDiskMetrics,
  selectMetricsLoading,
  selectMetricsError,
  selectSystemInfo,
  selectDiskUsedStatistics,
  selectDiskFreeStatistics
} from '../../../store/metricsSlice';

interface DiskMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays Disk metrics chart and statistics
 */
const DiskMetricCard: React.FC<DiskMetricCardProps> = ({ timeframe }) => {
  const diskMetrics = useAppSelector(selectDiskMetrics);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  const systemInfo = useAppSelector(selectSystemInfo);
  const totalDisk = systemInfo?.totalDisk || 0;

  // Get disk statistics using memoized selectors
  const usedStats = useAppSelector(selectDiskUsedStatistics);
  const freeStats = useAppSelector(selectDiskFreeStatistics);

  // Format disk values to readable format
  const formatValue = (value: number): string => {
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} TB`;
    }
    return `${value.toFixed(1)} GB`;
  };

  // Combine disk statistics
  const stats = {
    usedAvg: usedStats.avg,
    freeAvg: freeStats.avg
  };

  return (
    <div className="metric-card">
      <h3 className="metric-title">Disk Space</h3>
      {diskMetrics.used && diskMetrics.used.length > 0 ? (
        <>
          <div className="disk-chart">
            <DiskChart timeframe={timeframe} />
          </div>
          <div className="metric-stats disk-stats">
            <div className="stat-item disk-total">
              <span className="stat-label">Total:</span>
              <span className="stat-value">{formatValue(totalDisk)}</span>
            </div>
            <div className="stat-item disk-used">
              <span className="stat-label">Used:</span>
              <span className="stat-value">{formatValue(stats.usedAvg)}</span>
            </div>
            <div className="stat-item disk-free">
              <span className="stat-label">Free:</span>
              <span className="stat-value">{formatValue(stats.freeAvg)}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {loading ? "Loading disk data..." : error ? "Error loading disk data" : "No data available"}
        </div>
      )}
    </div>
  );
};

export default DiskMetricCard;

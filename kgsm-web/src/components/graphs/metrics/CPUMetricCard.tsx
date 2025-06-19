import React from 'react';
import { TimeFrame } from '../../../models/system';
import { CPUChart } from '../charts';
import '../SystemMetrics.css';
import { useAppSelector } from '../../../store/hooks';
import { selectCPUMetrics, selectMetricsLoading, selectMetricsError, selectCpuStatistics } from '../../../store/metricsSlice';

interface CPUMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays CPU metrics chart and statistics
 */
const CPUMetricCard: React.FC<CPUMetricCardProps> = ({ timeframe }) => {
  const data = useAppSelector(selectCPUMetrics);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  const stats = useAppSelector(selectCpuStatistics);

  return (
    <div className="metric-card">
      <h3 className="metric-title">CPU Usage</h3>
      {data && data.length > 0 ? (
        <>
          <div className="cpu-chart">
            <CPUChart timeframe={timeframe} />
          </div>
          <div className="metric-stats cpu-stats">
            <div className="stat-item cpu-min">
              <span className="stat-label">Min:</span>
              <span className="stat-value">{stats.min.toFixed(1)}%</span>
            </div>
            <div className="stat-item cpu-max">
              <span className="stat-label">Max:</span>
              <span className="stat-value">{stats.max.toFixed(1)}%</span>
            </div>
            <div className="stat-item cpu-avg">
              <span className="stat-label">Avg:</span>
              <span className="stat-value">{stats.avg.toFixed(1)}%</span>
            </div>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {loading ? "Loading CPU data..." : error ? "Error loading CPU data" : "No data available"}
        </div>
      )}
    </div>
  );
};

export default CPUMetricCard;

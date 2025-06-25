import React, { useMemo } from 'react';
import { TimeFrame } from '../../../models/system';
import { NetworkChart } from '../charts';
import '../SystemMetrics.css';
import { useAppSelector } from '../../../store/hooks';
import { selectNetworkMetrics, selectMetricsLoading, selectMetricsError } from '../../../store/metricsSlice';

interface NetworkMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays Network metrics chart and statistics
 */
const NetworkMetricCard: React.FC<NetworkMetricCardProps> = ({ timeframe }) => {
  const networkMetrics = useAppSelector(selectNetworkMetrics);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);

  // Memoized network data to prevent recreating arrays on each render
  const rxData = useMemo(() => networkMetrics.rx || [], [networkMetrics.rx]);
  // We're keeping track of txData in the store but not using it directly in this component
  const totalData = useMemo(() => networkMetrics.total, [networkMetrics.total]);

  // Format network speed to readable format
  const formatValue = (value: number): string => {
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} MB/s`;
    }
    return `${value.toFixed(1)} KB/s`;
  };

  return (
    <div className="metric-card metric-card-network">
      <h3 className="metric-title">Network Traffic</h3>
      {rxData.length > 0 ? (
        <>
          <div className="network-chart">
            <NetworkChart timeframe={timeframe} />
          </div>
          <div className="metric-stats network-stats">
            {!totalData ? (
              <div className="stat-item">No network data available</div>
            ) : (
              <>
                <div className="stat-item download network-download">
                  <span className="stat-label">Download:</span>
                  <span className="stat-value">{formatValue(totalData.rxSpeed)}</span>
                </div>
                <div className="stat-item upload network-upload">
                  <span className="stat-label">Upload:</span>
                  <span className="stat-value">{formatValue(totalData.txSpeed)}</span>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {loading ? "Loading network data..." : error ? "Error loading network data" : "No data available"}
        </div>
      )}
    </div>
  );
};

export default NetworkMetricCard;

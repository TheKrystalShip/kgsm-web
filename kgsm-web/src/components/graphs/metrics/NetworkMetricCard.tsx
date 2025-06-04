import React from 'react';
import { useNetworkMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import { NetworkChart } from '../charts';
import '../SystemMetrics.css';

interface NetworkMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays Network metrics chart and statistics
 */
const NetworkMetricCard: React.FC<NetworkMetricCardProps> = ({ timeframe }) => {
  const { rxData, totalData, loading, error, formatValue } = useNetworkMetrics(timeframe);

  return (
    <div className="metric-card network-card">
      <h3 className="metric-title">Network Traffic</h3>
      {rxData.length > 0 ? (
        <>
          <div className="network-chart">
            <NetworkChart timeframe={timeframe} />
          </div>
          <div className="metric-stats network-stats">
            {(() => {
              if (!totalData) {
                return <div className="stat-item">No network data available</div>;
              }
              
              const { rxSpeed, txSpeed, rx, tx } = totalData;
              
              return (
                <>
                  <div className="stat-item download network-download">
                    <span className="stat-label">Download:</span>
                    <span className="stat-value">{formatValue(rxSpeed)}</span>
                    <span className="stat-secondary">Total: {rx.toFixed(2)} MB</span>
                  </div>
                  <div className="stat-item upload network-upload">
                    <span className="stat-label">Upload:</span>
                    <span className="stat-value">{formatValue(txSpeed)}</span>
                    <span className="stat-secondary">Total: {tx.toFixed(2)} MB</span>
                  </div>
                </>
              );
            })()}
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {loading ? "Loading network data..." : error ? "Error loading network data" : "No network data available"}
        </div>
      )}
    </div>
  );
};

export default NetworkMetricCard;

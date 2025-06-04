import React from 'react';
import { useMemoryMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import { MemoryChart } from '../charts';
import '../SystemMetrics.css';

interface MemoryMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays Memory metrics chart and statistics
 */
const MemoryMetricCard: React.FC<MemoryMetricCardProps> = ({ timeframe }) => {
  const { data, loading, error, totalMemory, formatValue, getStatistics } = useMemoryMetrics(timeframe);

  return (
    <div className="metric-card">
      <h3 className="metric-title">Memory Usage</h3>
      {data.length > 0 ? (
        <>
          <div className="memory-chart">
            <MemoryChart timeframe={timeframe} />
          </div>
          <div className="metric-stats memory-stats">
            {(() => {
              const memValues = data.map(m => m.rawValue || 0);
              const stats = getStatistics(memValues);
              const freeMemMB = totalMemory - stats.avg;
              
              return (
                <>
                  <div className="stat-item memory-total">
                    <span className="stat-label">Total:</span>
                    <span className="stat-value">{formatValue(totalMemory)}</span>
                  </div>
                  <div className="stat-item memory-used">
                    <span className="stat-label">Used:</span>
                    <span className="stat-value">{formatValue(stats.avg)}</span>
                  </div>
                  <div className="stat-item memory-free">
                    <span className="stat-label">Free:</span>
                    <span className="stat-value">{formatValue(freeMemMB)}</span>
                  </div>
                </>
              );
            })()}
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

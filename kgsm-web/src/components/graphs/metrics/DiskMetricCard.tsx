import React from 'react';
import { useDiskMetrics } from '../../../hooks/metrics';
import { TimeFrame } from '../../../services/systemMetricsService';
import { DiskChart } from '../charts';
import '../SystemMetrics.css';

interface DiskMetricCardProps {
  timeframe: TimeFrame;
}

/**
 * Component that displays Disk metrics chart and statistics
 */
const DiskMetricCard: React.FC<DiskMetricCardProps> = ({ timeframe }) => {
  const { usedData, freeData, loading, error, totalDisk, formatValue, getStatistics } = useDiskMetrics(timeframe);

  return (
    <div className="metric-card">
      <h3 className="metric-title">Disk Space</h3>
      {usedData.length > 0 ? (
        <>
          <div className="disk-chart">
            <DiskChart timeframe={timeframe} />
          </div>
          <div className="metric-stats disk-stats">
            {(() => {
              const usedValues = usedData.map(d => d.rawValue || 0);
              const freeValues = freeData.map(d => d.rawValue || 0);
              
              const usedAvg = getStatistics(usedValues).avg;
              const freeAvg = getStatistics(freeValues).avg;
              
              return (
                <>
                  <div className="stat-item disk-total">
                    <span className="stat-label">Total:</span>
                    <span className="stat-value">{formatValue(totalDisk)}</span>
                  </div>
                  <div className="stat-item disk-used">
                    <span className="stat-label">Used:</span>
                    <span className="stat-value">{formatValue(usedAvg)}</span>
                  </div>
                  <div className="stat-item disk-free">
                    <span className="stat-label">Free:</span>
                    <span className="stat-value">{formatValue(freeAvg)}</span>
                  </div>
                </>
              );
            })()}
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

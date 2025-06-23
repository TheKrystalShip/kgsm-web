import React, { useMemo } from 'react';
import { TimeFrame } from '../../../models/system';
import { CPUCoresChart } from '../charts';
import '../SystemMetrics.css';
import { useAppSelector } from '../../../store/hooks';
import {
  selectCPUCoresData,
  selectMetricsLoading,
  selectMetricsError,
  selectSystemInfo
} from '../../../store/metricsSlice';

interface CPUCoresMetricCardProps {
  timeframe: TimeFrame;
  maxCores?: number;
}

/**
 * Component that displays CPU cores metrics chart and statistics
 */
const CPUCoresMetricCard: React.FC<CPUCoresMetricCardProps> = ({ timeframe, maxCores = 16 }) => {
  const coresData = useAppSelector(selectCPUCoresData);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);
  const systemInfo = useAppSelector(selectSystemInfo);

  // Memoized statistics for performance
  const coreStats = useMemo(() => {
    if (!coresData || coresData.length === 0) {
      return {
        averageUsage: 0,
        maxUsage: 0,
        activecores: 0,
        totalCores: 0
      };
    }

    const usageValues = coresData.map(core => core.usage);
    const activeThreshold = 5; // Consider cores active if usage > 5%

    return {
      averageUsage: usageValues.reduce((sum, usage) => sum + usage, 0) / usageValues.length,
      maxUsage: Math.max(...usageValues),
      activecores: usageValues.filter(usage => usage > activeThreshold).length,
      totalCores: coresData.length
    };
  }, [coresData]);


  const cpuModel = systemInfo?.cpuModel || 'Unknown CPU';

  return (
    <div className="metric-card cpu-cores-card">
      <h3 className="metric-title">CPU Cores ({coreStats.totalCores} cores)</h3>

      {/* CPU Model Info */}
      <div className="cpu-model-info">
        <span className="cpu-model-text">{cpuModel}</span>
        <span className="cpu-cores">{coreStats.activecores}/{coreStats.totalCores} active</span>
      </div>

      {coresData && coresData.length > 0 ? (
        <>
          <div className="cpu-cores-chart">
            <CPUCoresChart timeframe={timeframe} maxCores={maxCores} />
          </div>

          {/* Overall Statistics */}
          <div className="metric-stats cpu-cores-stats">
            <div className="stat-item cores-avg">
              <span className="stat-label">Avg:</span>
              <span className="stat-value">{coreStats.averageUsage.toFixed(1)}%</span>
            </div>
            <div className="stat-item cores-max">
              <span className="stat-label">Peak:</span>
              <span className="stat-value">{coreStats.maxUsage.toFixed(1)}%</span>
            </div>
            <div className="stat-item cores-active">
              <span className="stat-label">Active:</span>
              <span className="stat-value">{coreStats.activecores}/{coreStats.totalCores}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {loading ? "Loading CPU cores data..." : error ? "Error loading CPU cores data" : "No CPU cores data available"}
        </div>
      )}
    </div>
  );
};

export default CPUCoresMetricCard;

import React from 'react';
import { useSystemMetrics } from '../../hooks/useSystemMetrics';
import { TimeFrame } from '../../services/systemMetricsService';
import MetricsChart from './MetricsChart';
import './SystemMetrics.css';

/**
 * Format bytes to a human-readable string (for future use)
 */

/**
 * Format GB to a human-readable string
 */
const formatGB = (gb: number) => {
  return `${gb.toFixed(2)} GB`;
};

/**
 * Format MB to a human-readable string
 */
const formatMB = (mb: number) => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(0)} MB`;
};

/**
 * Format KB/s to a human-readable string
 */
const formatSpeed = (kbps: number) => {
  if (kbps >= 1024) {
    return `${(kbps / 1024).toFixed(2)} MB/s`;
  }
  return `${kbps.toFixed(0)} KB/s`;
};

/**
 * Component for displaying system metrics charts
 */
const SystemMetrics: React.FC = () => {
  const { metrics, loading, error, timeframe, changeTimeframe, getStatistics } = useSystemMetrics();

  // Array of available timeframe options
  const timeframeOptions: TimeFrame[] = ['10s', '1m', '5m', '1h', '24h'];
  
  // Get CPU model information
  const cpuModel = metrics?.cpuModel || metrics?.systemInfo?.cpuModel || 'Unknown CPU';

  // If loading, show loading indicator
  if (loading && !metrics) {
    return (
      <div className="metrics-container">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading metrics...</p>
        </div>
      </div>
    );
  }

  // If error, show error message
  if (error) {
    return (
      <div className="metrics-container">
        <div className="error-container">
          <p>Failed to load metrics: {error.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Get total memory and disk size
  const totalMemoryMB = metrics?.systemInfo?.totalMemory || 16384; // Default 16GB
  const totalDiskGB = metrics?.systemInfo?.totalDisk || 1000; // Default 1TB

  return (
    <div className="metrics-container">
      <div className="metrics-header">
        <div className="cpu-model">{cpuModel}</div>
        <div className="timeframe-selector">
          {timeframeOptions.map((option) => (
            <button
              key={option}
              className={`btn btn-sm ${option === timeframe ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeTimeframe(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      
      <div className="metrics-grid">
        {/* CPU Usage Chart */}
        <div className="metric-card">
          <h3 className="metric-title">CPU Usage</h3>
          {metrics && metrics.cpu.length > 0 ? (
            <>
              {metrics.cpuModel && (
                <div className="cpu-model-info">
                  <span className="cpu-model-text">{metrics.cpuModel}</span>
                  <span className="cpu-cores">({metrics.systemInfo?.cpuCores || 0} Cores)</span>
                </div>
              )}
              <MetricsChart 
                data={metrics.cpu} 
                dataKey="value" 
                yAxisLabel="%" 
                color="var(--color-green)" 
                domainMax={100}
              />
              <div className="metric-stats cpu-stats">
                {(() => {
                  const cpuValues = metrics.cpu.map(m => m.value);
                  const stats = getStatistics(cpuValues);
                  return (
                    <>
                      <div className="stat-item">
                        <span className="stat-label">Min:</span>
                        <span className="stat-value">{stats.min.toFixed(1)}%</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Max:</span>
                        <span className="stat-value">{stats.max.toFixed(1)}%</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Avg:</span>
                        <span className="stat-value">{stats.avg.toFixed(1)}%</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="chart-placeholder">No data available</div>
          )}
        </div>
        
        {/* Memory Usage Chart */}
        <div className="metric-card">
          <h3 className="metric-title">Memory Usage</h3>
          {metrics && metrics.memory.length > 0 ? (
            <>
              <MetricsChart 
                data={metrics.memory.map(m => ({ 
                  ...m, 
                  value: m.rawValue || 0 // Use raw memory value in MB
                }))} 
                dataKey="value" 
                color="var(--color-orange)" 
                displayInGB={true}
                domainMax={totalMemoryMB}
                totalValue={totalMemoryMB}
                formatValue={(value) => formatMB(value)}
              />
              <div className="metric-stats memory-stats">
                {(() => {
                  const memValues = metrics.memory.map(m => m.rawValue || 0);
                  const stats = getStatistics(memValues);
                  const freeMemMB = totalMemoryMB - stats.avg;
                  
                  return (
                    <>
                      <div className="stat-item">
                        <span className="stat-label">Total:</span>
                        <span className="stat-value">{formatMB(totalMemoryMB)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Used:</span>
                        <span className="stat-value">{formatMB(stats.avg)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Free:</span>
                        <span className="stat-value">{formatMB(freeMemMB)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="chart-placeholder">No data available</div>
          )}
        </div>
        
        {/* Disk Usage Chart */}
        <div className="metric-card">
          <h3 className="metric-title">Disk Space</h3>
          {metrics && metrics.disk.used.length > 0 ? (
            <>
              <MetricsChart 
                data={[
                  ...metrics.disk.used.map(d => ({ 
                    ...d, 
                    value: d.rawValue || 0, // Use raw GB values
                    type: 'Used' 
                  })),
                  ...metrics.disk.free.map(d => ({ 
                    ...d, 
                    value: d.rawValue || 0, // Use raw GB values
                    type: 'Free' 
                  }))
                ]} 
                dataKey="value" 
                color="var(--color-green)"
                secondaryColor="var(--color-orange)"
                stacked
                multipleLines
                lineDataKey="type"
                displayInGB={true}
                totalValue={totalDiskGB}
                domainMax={totalDiskGB}
                formatValue={(value) => formatGB(value)}
              />
              <div className="metric-stats disk-stats">
                {(() => {
                  const usedValues = metrics.disk.used.map(d => d.rawValue || 0);
                  const freeValues = metrics.disk.free.map(d => d.rawValue || 0);
                  
                  const usedAvg = getStatistics(usedValues).avg;
                  const freeAvg = getStatistics(freeValues).avg;
                  
                  return (
                    <>
                      <div className="stat-item">
                        <span className="stat-label">Total:</span>
                        <span className="stat-value">{formatGB(totalDiskGB)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Used:</span>
                        <span className="stat-value">{formatGB(usedAvg)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Free:</span>
                        <span className="stat-value">{formatGB(freeAvg)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="chart-placeholder">No data available</div>
          )}
        </div>

        {/* Network Traffic Chart */}
        <div className="metric-card network-card">
          <h3 className="metric-title">Network Traffic</h3>
          {metrics && metrics.network && metrics.network.rx.length > 0 ? (
            <>
              <MetricsChart 
                data={[
                  ...metrics.network.rx.map(d => ({ 
                    ...d, 
                    type: 'Download' 
                  })),
                  ...metrics.network.tx.map(d => ({ 
                    ...d, 
                    type: 'Upload' 
                  }))
                ]}
                dataKey="value" 
                yAxisLabel="KB/s"
                color="var(--color-blue)" 
                secondaryColor="var(--color-green)"
                multipleLines
                lineDataKey="type"
                formatValue={(value) => formatSpeed(value)}
                domainMax="auto"
              />
              <div className="metric-stats network-stats">
                {(() => {
                  if (!metrics.network.total) {
                    return <div className="stat-item">No network data available</div>;
                  }
                  
                  const { rxSpeed, txSpeed, rx, tx } = metrics.network.total;
                  
                  return (
                    <>
                      <div className="stat-item download">
                        <span className="stat-label">Download:</span>
                        <span className="stat-value">{formatSpeed(rxSpeed)}</span>
                        <span className="stat-secondary">Total: {rx.toFixed(2)} MB</span>
                      </div>
                      <div className="stat-item upload">
                        <span className="stat-label">Upload:</span>
                        <span className="stat-value">{formatSpeed(txSpeed)}</span>
                        <span className="stat-secondary">Total: {tx.toFixed(2)} MB</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </>
          ) : (
            <div className="chart-placeholder">No network data available</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SystemMetrics;

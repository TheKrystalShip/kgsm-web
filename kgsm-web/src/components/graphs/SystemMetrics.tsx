import React from 'react';
import { useTimeframeSelection, useSystemUptime } from '../../hooks/metrics';
import { 
  CPUMetricCard, 
  MemoryMetricCard, 
  DiskMetricCard, 
  NetworkMetricCard 
} from './metrics';
import './SystemMetrics.css';

/**
 * Component for displaying system metrics charts
 * Acts as a lightweight shell to hold the individual metric cards
 */
const SystemMetrics: React.FC = () => {
  const { timeframe, timeframeOptions, changeTimeframe } = useTimeframeSelection('1m');

  return (
    <div className="metrics-container">
      <div className="metrics-header">
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
        <CPUMetricCard timeframe={timeframe} />
        
        {/* Memory Usage Chart */}
        <MemoryMetricCard timeframe={timeframe} />
        
        {/* Disk Usage Chart */}
        <DiskMetricCard timeframe={timeframe} />

        {/* Network Traffic Chart */}
        <NetworkMetricCard timeframe={timeframe} />
      </div>
    </div>
  );
};

export default SystemMetrics;

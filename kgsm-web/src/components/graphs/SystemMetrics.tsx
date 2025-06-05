import React from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { setTimeframe, selectTimeframe } from '../../store/metricsSlice';
import { 
  CPUMetricCard, 
  MemoryMetricCard, 
  DiskMetricCard, 
  NetworkMetricCard 
} from './metrics';
import MetricsDataFetcher from './MetricsDataFetcher';
import UpdateIntervalSelector from './metrics/UpdateIntervalSelector';
import { TimeFrame } from '../../services/systemMetricsService';
import './SystemMetrics.css';

/**
 * Component for displaying system metrics charts
 * Acts as a lightweight shell to hold the individual metric cards
 */
const SystemMetrics: React.FC = () => {
  const dispatch = useAppDispatch();
  const timeframe = useAppSelector(selectTimeframe);
  const timeframeOptions: TimeFrame[] = ['10s', '1m', '5m', '15m', '30m', '1h', '3h', '6h', '12h', '24h'];

  const handleTimeframeChange = (option: TimeFrame) => {
    dispatch(setTimeframe(option));
  };

  return (
    <div className="metrics-container">
      {/* This component handles data fetching at regular intervals */}
      <MetricsDataFetcher />
      
      <div className="metrics-header">
        <div className="metrics-controls">
          <div className="timeframe-selector">
            {timeframeOptions.map((option) => (
              <button
                key={option}
                className={`btn btn-sm ${option === timeframe ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleTimeframeChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <UpdateIntervalSelector className="update-interval" />
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

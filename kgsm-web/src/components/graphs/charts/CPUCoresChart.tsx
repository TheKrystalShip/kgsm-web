import React, { useMemo } from 'react';
import { TimeFrame, CpuHistoryPoint } from '../../../models/system';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import './Charts.css';
import { useAppSelector } from '../../../store/hooks';
import { selectCPUCoresHistory, selectMetricsLoading, selectMetricsError } from '../../../store/metricsSlice';

interface CPUCoresChartProps {
  timeframe: TimeFrame;
  maxCores?: number; // Limit number of cores to display for performance
}

/**
 * Component for rendering individual CPU core usage charts
 * Optimized for frequent updates with memoization and data limiting
 */
const CPUCoresChart: React.FC<CPUCoresChartProps> = ({ timeframe, maxCores = 8 }) => {
  const cpuHistory = useAppSelector(selectCPUCoresHistory);
  const loading = useAppSelector(selectMetricsLoading);
  const error = useAppSelector(selectMetricsError);

  // Memoized processed data to prevent recalculation on every render
  const processedData = useMemo(() => {
    if (!cpuHistory || cpuHistory.length === 0) return [];

    // Transform the data structure for Recharts
    // Each timestamp becomes an object with core0, core1, core2, etc. properties
    return cpuHistory.map((historyPoint: CpuHistoryPoint) => {
      const dataPoint: any = {
        timestamp: historyPoint.timestamp,
        average: historyPoint.average
      };

      // Add each core's usage as a separate property
      // Limit cores for performance if specified
      const coresToShow = Math.min(historyPoint.cores.length, maxCores);
      for (let i = 0; i < coresToShow; i++) {
        const coreData = historyPoint.cores[i];
        if (coreData) {
          dataPoint[`core${i}`] = coreData.usage;
        }
      }

      return dataPoint;
    });
  }, [cpuHistory, maxCores]);

    // Memoized core count and colors
  const { coreCount, coreColors } = useMemo(() => {
    if (!cpuHistory || cpuHistory.length === 0) return { coreCount: 0, coreColors: [] };

    const firstEntry = cpuHistory[0] as CpuHistoryPoint;
    const actualCoreCount = Math.min(firstEntry.cores.length, maxCores);

    // Generate colors for each core using HSL for good distribution
    const colors = Array.from({ length: actualCoreCount }, (_, i) => {
      // Distribute hues evenly across the color wheel, avoiding red (0°) and keeping saturation/lightness optimal
      const hue = (i * 360 / actualCoreCount + 120) % 360; // Start from green (120°)
      return `hsl(${hue}, 70%, 55%)`;
    });

    return { coreCount: actualCoreCount, coreColors: colors };
  }, [cpuHistory, maxCores]);

  // Get the top 4 most active cores for display
  const topCores = useMemo(() => {
    if (!cpuHistory || cpuHistory.length === 0) return [];

    const latestData = cpuHistory[cpuHistory.length - 1] as CpuHistoryPoint;
    if (!latestData || !latestData.cores) return [];

    return [...latestData.cores]
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5)
      .map(core => ({
        ...core,
        color: coreColors[core.core] || `hsl(${(core.core * 360 / latestData.cores.length + 120) % 360}, 70%, 55%)`
      }));
  }, [cpuHistory, coreColors]);

  // Format X-axis timestamp
  const formatXAxis = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour12: false,
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Format tooltip
  const formatTooltip = (value: number, name: string) => {
    if (name === 'average') {
      return [`${value.toFixed(1)}%`, 'Average'];
    }
    return [`${value.toFixed(1)}%`, name.toUpperCase()];
  };

  if (loading && processedData.length === 0) {
    return <div className="loading-chart">Loading CPU cores data...</div>;
  }

  if (error) {
    return <div className="error-chart">Error loading CPU cores data</div>;
  }

  if (processedData.length === 0) {
    return <div className="empty-chart">No CPU cores data available</div>;
  }

  return (
    <div className="cpu-cores-chart-container">
      <div className="cpu-cores-chart-layout">
        <div className="cpu-cores-chart-main">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={processedData}
              margin={{ top: 5, right: 20, left: 5, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="rgba(255,255,255,0.05)"
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatXAxis}
                minTickGap={30}
                tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
                tickFormatter={(value: number) => `${value}%`}
              />
              <Tooltip
                labelFormatter={(timestamp: number) =>
                  new Date(timestamp).toLocaleTimeString()
                }
                formatter={formatTooltip}
                contentStyle={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 'var(--border-radius)',
                  fontSize: '0.8rem'
                }}
              />

              {/* Render individual core lines */}
              {Array.from({ length: coreCount }, (_, i) => (
                <Line
                  key={`core${i}`}
                  type="monotone"
                  dataKey={`core${i}`}
                  stroke={coreColors[i]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 1, stroke: "#ffffff" }}
                  isAnimationActive={false}
                />
              ))}

              {/* Average line - thicker and more prominent */}
              <Line
                type="monotone"
                dataKey="average"
                stroke="var(--color-orange)"
                strokeWidth={2.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Most Active Cores - Right Side on Desktop, Bottom on Mobile */}
        <div className="cpu-cores-sidebar">
          <div className="top-cores-section">
            <h4>Most Active Cores</h4>
            <div className="top-cores-list">
              {topCores.map((core) => (
                <div key={core.core} className="top-core-item">
                  <div
                    className="core-indicator"
                    style={{ backgroundColor: core.color }}
                  ></div>
                  <span className="core-label">Core {core.core}</span>
                  <span className="core-usage-value">{core.usage.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CPUCoresChart;

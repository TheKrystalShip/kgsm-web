import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';
import './MetricsChart.css';

interface MetricsChartProps {
  data: any[];
  dataKey: string;
  yAxisLabel?: string;
  color?: string;
  secondaryColor?: string;
  stacked?: boolean;
  multipleLines?: boolean;
  lineDataKey?: string;
  displayInGB?: boolean;
  totalValue?: number; // For showing total memory/disk capacity
  formatValue?: (value: number) => string; // Custom formatter for values
  domainMax?: number | 'auto'; // Maximum value for the Y-axis domain
}

/**
 * Component for rendering charts with system metrics
 */
const MetricsChart: React.FC<MetricsChartProps> = ({
  data,
  dataKey,
  yAxisLabel,
  color = '#23d187', // Green from our new palette
  secondaryColor = '#fda442', // Orange from our new palette
  stacked = false,
  multipleLines = false,
  lineDataKey = '',
  displayInGB = false,
  totalValue,
  formatValue,
  domainMax = 100,
}) => {
  // Format timestamp for x-axis labels
  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  };

  // Format tooltip values
  const formatTooltipValue = (value: number, name: string) => {
    if (formatValue) {
      return formatValue(value);
    } else if (displayInGB) {
      // Format as GB or MB
      return value >= 1024 
        ? `${(value / 1024).toFixed(2)} GB` 
        : `${value.toFixed(2)} MB`;
    } else {
      return `${value.toFixed(1)}${yAxisLabel || ''}`;
    }
  };

  // Process data for multiple lines if needed
  const processedData = data;
  
  // Get unique line types if using multiple lines
  const lineTypes = multipleLines && lineDataKey ? 
    Array.from(new Set(data.map((item) => item[lineDataKey]))) : [];

  if (data.length === 0) {
    return <div className="empty-chart">No data available</div>;
  }

  return (
    <div className="metrics-chart">
      <ResponsiveContainer width="100%" height={240}>
        {!stacked ? (
          <LineChart data={processedData} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              minTickGap={30}
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
            />
            <YAxis
              domain={[0, domainMax]}
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              tickFormatter={(value) => {
                if (formatValue) {
                  return formatValue(value);
                } else if (displayInGB) {
                  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${value.toFixed(0)} MB`;
                } else {
                  return `${value}${yAxisLabel || ''}`;
                }
              }}
            />
            <Tooltip
              labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
              formatter={formatTooltipValue}
            />
            
            {totalValue && (
              <ReferenceLine
                y={totalValue}
                stroke="var(--text-secondary)"
                strokeDasharray="3 3"
                label={{
                  position: 'right',
                  value: `Total: ${displayInGB ? (totalValue >= 1024 ? `${(totalValue / 1024).toFixed(1)} GB` : `${totalValue.toFixed(0)} MB`) : totalValue}`,
                  fill: 'var(--text-secondary)',
                  fontSize: 12,
                }}
              />
            )}
            
            {multipleLines && lineDataKey ? (
              // Render multiple lines if specified
              lineTypes.map((type, index) => (
                <Line
                  key={type}
                  type="monotone"
                  dataKey={dataKey}
                  data={processedData.filter((item) => item[lineDataKey] === type)}
                  name={String(type)}
                  stroke={index === 0 ? color : secondaryColor}
                  strokeWidth={2.5}
                  dot={{ r: 0 }}
                  activeDot={{ r: 5, strokeWidth: 1, stroke: '#ffffff' }}
                  isAnimationActive={false}
                />
              ))
            ) : (
              // Render single line
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2.5}
                dot={{ r: 0 }}
                activeDot={{ r: 5, strokeWidth: 1, stroke: '#ffffff' }}
                isAnimationActive={false}
              />
            )}
            
            {/* Reference line at 80% for warning threshold - only for percentage metrics */}
            {!displayInGB && (
              <ReferenceLine
                y={80}
                stroke="var(--warning)"
                strokeDasharray="3 3"
                label={{
                  position: 'right',
                  value: '80%',
                  fill: 'var(--warning)',
                  fontSize: 12,
                }}
              />
            )}
          </LineChart>
        ) : (
          // Stacked area chart for disk usage
          <AreaChart data={processedData} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              minTickGap={30}
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
            />
            <YAxis
              domain={[0, domainMax]}
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              tickFormatter={(value) => {
                if (formatValue) {
                  return formatValue(value);
                } else if (displayInGB) {
                  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${value.toFixed(0)} MB`;
                } else {
                  return `${value}${yAxisLabel || ''}`;
                }
              }}
            />
            <Tooltip
              labelFormatter={(timestamp) => new Date(timestamp).toLocaleTimeString()}
              formatter={formatTooltipValue}
            />
            
            {multipleLines && lineDataKey && (
              lineTypes.map((type, index) => (
                <Area
                  key={type}
                  type="monotone"
                  dataKey={dataKey}
                  data={processedData.filter((item) => item[lineDataKey] === type)}
                  name={String(type)}
                  stackId="1"
                  stroke={index === 0 ? color : secondaryColor}
                  fill={index === 0 ? color : secondaryColor}
                  fillOpacity={0.5}
                  isAnimationActive={false}
                />
              ))
            )}
            
            {totalValue && (
              <ReferenceLine
                y={totalValue}
                stroke="var(--text-secondary)"
                strokeDasharray="3 3"
                label={{
                  position: 'right',
                  value: `Total: ${displayInGB ? (totalValue >= 1024 ? `${(totalValue / 1024).toFixed(1)} GB` : `${totalValue.toFixed(0)} MB`) : totalValue}`,
                  fill: 'var(--text-secondary)',
                  fontSize: 12,
                }}
              />
            )}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

export default MetricsChart;

import React from "react";
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
} from "recharts";
import "./Charts.css";

export interface BaseChartProps {
  data: any[];
  dataKey: string;
  yAxisLabel?: string;
  color?: string;
  secondaryColor?: string;
  stacked?: boolean;
  multipleLines?: boolean;
  lineDataKey?: string;
  displayInGB?: boolean;
  totalValue?: number;
  formatValue?: (value: number) => string;
  domainMax?: number | "auto";
  showWarningThreshold?: boolean;
  warningThreshold?: number;
}

/**
 * Base chart component for all system metrics
 */
const BaseChart: React.FC<BaseChartProps> = ({
  data,
  dataKey,
  yAxisLabel,
  color = "var(--color-green)",
  secondaryColor = "var(--color-orange)",
  stacked = false,
  multipleLines = false,
  lineDataKey = "",
  displayInGB = false,
  totalValue,
  formatValue,
  domainMax = 100,
  showWarningThreshold = false,
  warningThreshold = 80,
}) => {
  // Format timestamp for x-axis labels
  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getHours()}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
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
      return `${value.toFixed(1)}${yAxisLabel || ""}`;
    }
  };

  // Get unique line types if using multiple lines
  const lineTypes =
    multipleLines && lineDataKey
      ? Array.from(new Set(data.map((item) => item[lineDataKey])))
      : [];

  if (data.length === 0) {
    return <div className="empty-chart">No data available</div>;
  }

  // Shared Y-axis and Tooltip configuration
  const sharedAxisConfig = {
    YAxis: (
      <YAxis
        domain={[0, domainMax]}
        tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
        tickFormatter={(value: number) => {
          if (formatValue) {
            return formatValue(value);
          } else if (displayInGB) {
            return value >= 1024
              ? `${(value / 1024).toFixed(1)} GB`
              : `${value.toFixed(0)} MB`;
          } else {
            return `${value}${yAxisLabel || ""}`;
          }
        }}
      />
    ),
    Tooltip: (
      <Tooltip
        labelFormatter={(timestamp: number) =>
          new Date(timestamp).toLocaleTimeString()
        }
        formatter={formatTooltipValue}
      />
    ),
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      {!stacked ? (
        <LineChart
          data={data}
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
            tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
          />
          {sharedAxisConfig.YAxis}
          {sharedAxisConfig.Tooltip}

          {totalValue && (
            <ReferenceLine
              y={totalValue}
              stroke="var(--text-secondary)"
              strokeDasharray="3 3"
              label={{
                position: "right",
                value: `Total: ${
                  displayInGB
                    ? totalValue >= 1024
                      ? `${(totalValue / 1024).toFixed(1)} GB`
                      : `${totalValue.toFixed(0)} MB`
                    : totalValue
                }`,
                fill: "var(--text-secondary)",
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
                data={data.filter((item) => item[lineDataKey] === type)}
                name={String(type)}
                stroke={index === 0 ? color : secondaryColor}
                strokeWidth={2.5}
                dot={{ r: 0 }}
                activeDot={{ r: 5, strokeWidth: 1, stroke: "#ffffff" }}
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
              activeDot={{ r: 5, strokeWidth: 1, stroke: "#ffffff" }}
              isAnimationActive={false}
            />
          )}

          {/* Reference line at warningThreshold for warning threshold - only when specified */}
          {showWarningThreshold && (
            <ReferenceLine
              y={warningThreshold}
              stroke="var(--warning)"
              strokeDasharray="3 3"
              label={{
                position: "right",
                value: `${warningThreshold}%`,
                fill: "var(--warning)",
                fontSize: 12,
              }}
            />
          )}
        </LineChart>
      ) : (
        // Stacked area chart
        <AreaChart
          data={data}
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
            tick={{ fontSize: 12, fill: "var(--text-secondary)" }}
          />
          {sharedAxisConfig.YAxis}
          {sharedAxisConfig.Tooltip}

          {multipleLines &&
            lineDataKey &&
            lineTypes.map((type, index) => (
              <Area
                key={type}
                type="monotone"
                dataKey={dataKey}
                data={data.filter((item) => item[lineDataKey] === type)}
                name={String(type)}
                stackId="1"
                stroke={index === 0 ? color : secondaryColor}
                fill={index === 0 ? color : secondaryColor}
                fillOpacity={0.5}
                isAnimationActive={false}
              />
            ))}

          {totalValue && (
            <ReferenceLine
              y={totalValue}
              stroke="var(--text-secondary)"
              strokeDasharray="3 3"
              label={{
                position: "right",
                value: `Total: ${
                  displayInGB
                    ? totalValue >= 1024
                      ? `${(totalValue / 1024).toFixed(1)} GB`
                      : `${totalValue.toFixed(0)} MB`
                    : totalValue
                }`,
                fill: "var(--text-secondary)",
                fontSize: 12,
              }}
            />
          )}
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
};

export default BaseChart;

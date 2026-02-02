import React from "react";
import { Box, Text } from "ink";
import * as asciichart from "asciichart";
import { PortfolioState, Position } from "../../portfolio/types.js";

interface PortfolioProps {
  portfolio: PortfolioState;
  equityHistory: { date: string; equity: number }[];
}

function formatCurrency(value: number): string {
  return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + (value * 100).toFixed(2) + "%";
}

export function Portfolio({ portfolio, equityHistory }: PortfolioProps) {
  const positions = Object.values(portfolio.positions);

  // Generate equity chart
  let equityChart = "";
  if (equityHistory.length > 1) {
    const values = equityHistory.slice(-30).map((e) => e.equity);
    try {
      equityChart = asciichart.plot(values, {
        height: 8,
        format: (x: number) => x.toFixed(0).padStart(8),
      });
    } catch {
      equityChart = "Unable to generate chart";
    }
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Summary */}
      <Box marginBottom={1}>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Cash</Text>
          <Text color="cyan">{formatCurrency(portfolio.cash)}</Text>
        </Box>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Equity</Text>
          <Text color="cyan">{formatCurrency(portfolio.equity)}</Text>
        </Box>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Day P&L</Text>
          <Text color={portfolio.dailyPnL >= 0 ? "green" : "red"}>
            {formatCurrency(portfolio.dailyPnL)}
          </Text>
        </Box>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Week P&L</Text>
          <Text color={portfolio.weeklyPnL >= 0 ? "green" : "red"}>
            {formatCurrency(portfolio.weeklyPnL)}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text bold>Total P&L</Text>
          <Text color={portfolio.totalPnL >= 0 ? "green" : "red"}>
            {formatCurrency(portfolio.totalPnL)}
          </Text>
        </Box>
      </Box>

      {/* Equity Chart */}
      {equityChart && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            Equity (30 day)
          </Text>
          <Text>{equityChart}</Text>
        </Box>
      )}

      {/* Positions Table */}
      <Box flexDirection="column">
        <Text bold color="cyan">
          Positions ({positions.length})
        </Text>
        {positions.length === 0 ? (
          <Text color="gray">No open positions</Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {/* Header */}
            <Box>
              <Text bold color="gray">
                {"Symbol".padEnd(8)}
                {"Qty".padStart(8)}
                {"Avg Cost".padStart(12)}
                {"Current".padStart(12)}
                {"Value".padStart(14)}
                {"P&L".padStart(12)}
                {"%".padStart(10)}
              </Text>
            </Box>
            {/* Rows */}
            {positions.map((pos: Position) => (
              <Box key={pos.symbol}>
                <Text>
                  {pos.symbol.padEnd(8)}
                  {pos.quantity.toString().padStart(8)}
                  {formatCurrency(pos.averageCost).padStart(12)}
                  {formatCurrency(pos.currentPrice).padStart(12)}
                  {formatCurrency(pos.marketValue).padStart(14)}
                </Text>
                <Text color={pos.unrealizedPnL >= 0 ? "green" : "red"}>
                  {formatCurrency(pos.unrealizedPnL).padStart(12)}
                  {formatPercent(pos.unrealizedPnLPercent).padStart(10)}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Trade } from "../../portfolio/types.js";

interface JournalProps {
  trades: Trade[];
}

interface DailySummary {
  date: string;
  trades: number;
  volume: number;
  pnl: number;
  winRate: number;
}

function formatCurrency(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function groupByDate(trades: Trade[]): Map<string, Trade[]> {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const date = trade.executedAt.split("T")[0]!;
    const existing = groups.get(date) || [];
    existing.push(trade);
    groups.set(date, existing);
  }
  return groups;
}

function calculateDailySummaries(trades: Trade[]): DailySummary[] {
  const groups = groupByDate(trades);
  const summaries: DailySummary[] = [];

  for (const [date, dayTrades] of groups) {
    const wins = dayTrades.filter((t) => t.pnl !== undefined && t.pnl > 0).length;
    const total = dayTrades.filter((t) => t.pnl !== undefined).length;

    summaries.push({
      date,
      trades: dayTrades.length,
      volume: dayTrades.reduce((sum, t) => sum + t.value, 0),
      pnl: dayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0),
      winRate: total > 0 ? wins / total : 0,
    });
  }

  return summaries.sort((a, b) => b.date.localeCompare(a.date));
}

export function Journal({ trades }: JournalProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const summaries = calculateDailySummaries(trades);
  const selectedIndex = selectedDate ? summaries.findIndex((s) => s.date === selectedDate) : 0;

  useInput((_input, key) => {
    if (key.upArrow && selectedIndex > 0) {
      setSelectedDate(summaries[selectedIndex - 1]?.date ?? null);
    } else if (key.downArrow && selectedIndex < summaries.length - 1) {
      setSelectedDate(summaries[selectedIndex + 1]?.date ?? null);
    } else if (key.escape) {
      setSelectedDate(null);
    }
  });

  if (trades.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">
          Trade Journal
        </Text>
        <Text color="gray">No trades recorded yet</Text>
      </Box>
    );
  }

  // Calculate totals
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const totalVolume = trades.reduce((sum, t) => sum + t.value, 0);
  const wins = trades.filter((t) => t.pnl !== undefined && t.pnl > 0).length;
  const totalWithPnL = trades.filter((t) => t.pnl !== undefined).length;

  return (
    <Box flexDirection="column">
      {/* Summary Stats */}
      <Box marginBottom={1}>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Total P&L</Text>
          <Text color={totalPnL >= 0 ? "green" : "red"}>{formatCurrency(totalPnL)}</Text>
        </Box>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Total Trades</Text>
          <Text>{trades.length}</Text>
        </Box>
        <Box flexDirection="column" marginRight={4}>
          <Text bold>Volume</Text>
          <Text>${totalVolume.toLocaleString()}</Text>
        </Box>
        <Box flexDirection="column">
          <Text bold>Win Rate</Text>
          <Text>{totalWithPnL > 0 ? ((wins / totalWithPnL) * 100).toFixed(1) : 0}%</Text>
        </Box>
      </Box>

      {/* Daily Summary Table */}
      <Text bold color="cyan">
        Daily Summary
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box>
          <Text bold color="gray">
            {"".padEnd(2)}
            {"Date".padEnd(12)}
            {"Trades".padStart(8)}
            {"Volume".padStart(14)}
            {"P&L".padStart(12)}
            {"Win Rate".padStart(10)}
          </Text>
        </Box>
        {/* Rows */}
        {summaries.slice(0, 15).map((summary, i) => (
          <Box key={summary.date}>
            <Text color={i === selectedIndex ? "cyan" : undefined}>
              {i === selectedIndex ? "❯ " : "  "}
              {summary.date.padEnd(12)}
              {summary.trades.toString().padStart(8)}
              {`$${summary.volume.toLocaleString().padStart(13)}`}
            </Text>
            <Text color={summary.pnl >= 0 ? "green" : "red"}>{formatCurrency(summary.pnl).padStart(12)}</Text>
            <Text color={i === selectedIndex ? "cyan" : undefined}>
              {(summary.winRate * 100).toFixed(0).padStart(9)}%
            </Text>
          </Box>
        ))}
      </Box>

      {/* Selected Day Detail */}
      {selectedDate && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            Trades on {selectedDate}
          </Text>
          <Box flexDirection="column">
            {groupByDate(trades)
              .get(selectedDate)
              ?.slice(0, 10)
              .map((trade) => (
                <Text key={trade.id}>
                  {trade.side.toUpperCase().padEnd(5)}
                  {trade.symbol.padEnd(8)}
                  {trade.quantity.toString().padStart(6)} @ ${trade.price.toFixed(2)}
                  {trade.pnl !== undefined && (
                    <Text color={trade.pnl >= 0 ? "green" : "red"}>
                      {" → "}
                      {formatCurrency(trade.pnl)}
                    </Text>
                  )}
                </Text>
              ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

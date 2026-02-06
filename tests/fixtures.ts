/**
 * Shared test fixtures for StrategySpec and helpers
 */

import type { StrategySpec } from "../src/evolution/types.js";

export const smaCrossoverSpec: StrategySpec = {
  name: "SMA 10/50 Crossover",
  description: "Buy when SMA10 crosses above SMA50",
  entryLong: {
    kind: "comparison",
    left: { type: "SMA", period: 10 },
    op: "crosses_above",
    right: { type: "SMA", period: 50 },
  },
  exitRules: {
    stopLossPercent: 0.05,
    takeProfitPercent: 0.12,
    timeStopDays: 30,
  },
  positionSizing: { method: "fixed_percent", basePercent: 0.15, maxPercent: 0.2 },
};

export const rsiOversoldSpec: StrategySpec = {
  name: "RSI Oversold Bounce",
  description: "Buy when RSI14 drops below 30",
  entryLong: {
    kind: "comparison",
    left: { type: "RSI", period: 14 },
    op: "lt",
    right: { type: "literal", value: 30 },
  },
  exitRules: {
    stopLossPercent: 0.04,
    takeProfitPercent: 0.08,
    timeStopDays: 20,
  },
  positionSizing: { method: "fixed_percent", basePercent: 0.12, maxPercent: 0.18 },
};

export const andLogicSpec: StrategySpec = {
  name: "EMA + RSI Combo",
  description: "Buy when EMA12 > EMA26 AND RSI > 50",
  entryLong: {
    kind: "and",
    conditions: [
      {
        kind: "comparison",
        left: { type: "EMA", period: 12 },
        op: "crosses_above",
        right: { type: "EMA", period: 26 },
      },
      {
        kind: "comparison",
        left: { type: "RSI", period: 14 },
        op: "gt",
        right: { type: "literal", value: 50 },
      },
    ],
  },
  exitRules: {
    stopLossPercent: 0.06,
    takeProfitPercent: 0.15,
    trailingStopPercent: 0.04,
    timeStopDays: 45,
  },
  positionSizing: { method: "fixed_percent", basePercent: 0.15, maxPercent: 0.2 },
};

/** Generate a temp file path for test isolation */
export function tmpFile(name: string): string {
  return `/tmp/tradecraft-test-${process.pid}-${name}.json`;
}

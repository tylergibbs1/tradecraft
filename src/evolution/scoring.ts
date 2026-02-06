/**
 * Strategy Scoring
 *
 * Composite fitness function for ranking evolved strategies.
 * Weights: Sharpe 0.30, return 0.20, drawdown 0.20, win rate 0.15, profit factor 0.15
 */

import { BacktestResult } from "../backtest/types.js";
import { StrategyScore, StrategyBacktestSummary } from "./types.js";

const WEIGHTS = {
  sharpe: 0.30,
  totalReturn: 0.20,
  maxDrawdown: 0.20,
  winRate: 0.15,
  profitFactor: 0.15,
};

/**
 * Normalize a value to 0-1 range using sigmoid-like scaling
 */
function normalize(value: number, midpoint: number, steepness: number = 1): number {
  return 1 / (1 + Math.exp(-steepness * (value - midpoint)));
}

/**
 * Score a backtest result into a composite fitness value
 */
export function scoreBacktestResult(result: BacktestResult): StrategyScore {
  // Normalize each metric to 0-1 range
  // Sharpe: 0 is neutral, 2+ is excellent
  const sharpeNorm = normalize(result.sharpeRatio, 1.0, 1.5);

  // Total return: 0% is neutral, 20%+ is excellent
  const returnNorm = normalize(result.totalReturnPercent, 0.10, 5);

  // Max drawdown: lower is better (invert), 5% is great, 30% is bad
  const drawdownNorm = 1 - normalize(result.maxDrawdown, 0.15, 8);

  // Win rate: 50% is neutral, 60%+ is good
  const winRateNorm = normalize(result.winRate, 0.50, 5);

  // Profit factor: 1.0 is break-even, 2+ is excellent
  const pfRaw = result.profitFactor === Infinity ? 5 : result.profitFactor;
  const pfNorm = normalize(pfRaw, 1.5, 1.5);

  // Weighted composite
  const composite =
    WEIGHTS.sharpe * sharpeNorm +
    WEIGHTS.totalReturn * returnNorm +
    WEIGHTS.maxDrawdown * drawdownNorm +
    WEIGHTS.winRate * winRateNorm +
    WEIGHTS.profitFactor * pfNorm;

  // Penalty for too few trades (low statistical significance)
  const tradePenalty = result.totalTrades < 5 ? 0.5 : result.totalTrades < 10 ? 0.8 : 1.0;

  return {
    composite: Math.max(0, Math.min(1, composite * tradePenalty)),
    sharpe: result.sharpeRatio,
    totalReturn: result.totalReturnPercent,
    maxDrawdown: result.maxDrawdown,
    winRate: result.winRate,
    profitFactor: result.profitFactor === Infinity ? 999 : result.profitFactor,
  };
}

/**
 * Extract a summary from a full BacktestResult
 */
export function summarizeBacktest(result: BacktestResult): StrategyBacktestSummary {
  return {
    totalReturn: result.totalReturnPercent,
    annualizedReturn: result.annualizedReturn,
    sharpeRatio: result.sharpeRatio,
    maxDrawdown: result.maxDrawdown,
    winRate: result.winRate,
    profitFactor: result.profitFactor === Infinity ? 999 : result.profitFactor,
    totalTrades: result.totalTrades,
    tradingDays: result.tradingDays,
  };
}

/**
 * Compare two scores (returns positive if a > b)
 */
export function compareScores(a: StrategyScore, b: StrategyScore): number {
  return a.composite - b.composite;
}

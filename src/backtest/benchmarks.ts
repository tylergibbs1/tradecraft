/**
 * Benchmark Comparison
 *
 * Compare strategy performance against active fund benchmarks (HFRI indices)
 * and passive ETF benchmarks (SPY, AGG) with alpha / information ratio metrics.
 */

import type { DataManager, OHLCV } from "../data/index.js";
import type { AlphaMetrics, BacktestSnapshot, BenchmarkComparison, BenchmarkResult } from "./types.js";

// Static benchmark constants (annualized, long-run averages)
export const STATIC_BENCHMARKS = {
  HFRI_COMPOSITE: {
    name: "HFRI Fund Weighted Composite",
    annualizedReturn: 0.072,
    sharpeRatio: 0.58,
    maxDrawdown: 0.21,
  },
  HFRI_EQUITY_HEDGE: {
    name: "HFRI Equity Hedge",
    annualizedReturn: 0.084,
    sharpeRatio: 0.62,
    maxDrawdown: 0.26,
  },
  MUTUAL_FUND_AVG: {
    name: "Average Active Equity Mutual Fund",
    annualizedReturn: 0.089,
    sharpeRatio: 0.48,
    maxDrawdown: 0.35,
  },
} as const;

// ETF benchmarks to fetch from data provider
export const ETF_BENCHMARKS = [
  { symbol: "SPY", name: "S&P 500 (SPY)" },
  { symbol: "AGG", name: "US Aggregate Bond (AGG)" },
  { symbol: "QQQ", name: "Nasdaq-100 (QQQ)" },
  { symbol: "ARKK", name: "ARK Innovation (ARKK)" },
] as const;

/**
 * Convert a static benchmark to a BenchmarkResult for a given backtest period.
 * Compounds the annualized return over the given number of trading days.
 */
export function staticBenchmarkToResult(
  key: keyof typeof STATIC_BENCHMARKS,
  _initialCapital: number,
  tradingDays: number,
): BenchmarkResult {
  const bm = STATIC_BENCHMARKS[key];
  const years = tradingDays / 252;
  const totalReturn = (1 + bm.annualizedReturn) ** years - 1;

  return {
    name: bm.name,
    annualizedReturn: bm.annualizedReturn,
    totalReturnPercent: totalReturn,
    sharpeRatio: bm.sharpeRatio,
    maxDrawdown: bm.maxDrawdown,
  };
}

/**
 * Simulate buy-and-hold for an ETF benchmark.
 * Computes return, Sharpe, max drawdown, and equity curve from OHLCV history.
 */
export function computeETFBenchmark(
  _symbol: string,
  name: string,
  history: OHLCV[],
  initialCapital: number,
): BenchmarkResult {
  if (history.length < 2) {
    return {
      name,
      annualizedReturn: 0,
      totalReturnPercent: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      equityCurve: [],
    };
  }

  const firstPrice = history[0]!.close;
  const shares = initialCapital / firstPrice;

  // Build equity curve
  const equityCurve: { timestamp: number; equity: number }[] = [];
  const dailyReturns: number[] = [];
  let peak = initialCapital;
  let maxDrawdown = 0;

  for (let i = 0; i < history.length; i++) {
    const equity = shares * history[i]!.close;
    equityCurve.push({ timestamp: history[i]!.timestamp, equity });

    if (i > 0) {
      const prevEquity = shares * history[i - 1]!.close;
      dailyReturns.push((equity - prevEquity) / prevEquity);
    }

    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const endEquity = equityCurve[equityCurve.length - 1]!.equity;
  const totalReturnPercent = (endEquity - initialCapital) / initialCapital;
  const tradingDays = history.length;
  const years = tradingDays / 252;
  const annualizedReturn = years > 0 ? (endEquity / initialCapital) ** (1 / years) - 1 : 0;

  // Sharpe ratio
  const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance =
    dailyReturns.length > 0 ? dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / dailyReturns.length : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  return {
    name,
    annualizedReturn,
    totalReturnPercent,
    sharpeRatio,
    maxDrawdown,
    equityCurve,
  };
}

/**
 * Compute alpha metrics between a strategy's daily returns and a benchmark's daily returns.
 * Returns annualized alpha, tracking error, and information ratio.
 */
export function computeAlphaMetrics(strategyReturns: number[], benchmarkReturns: number[]): AlphaMetrics {
  const len = Math.min(strategyReturns.length, benchmarkReturns.length);
  if (len === 0) {
    return { alpha: 0, trackingError: 0, informationRatio: 0 };
  }

  // Excess returns
  const excessReturns: number[] = [];
  for (let i = 0; i < len; i++) {
    excessReturns.push(strategyReturns[i]! - benchmarkReturns[i]!);
  }

  const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / len;
  const variance = excessReturns.reduce((sum, r) => sum + (r - avgExcess) ** 2, 0) / len;
  const trackingError = Math.sqrt(variance) * Math.sqrt(252); // annualized

  // Annualized alpha
  const alpha = avgExcess * 252;

  // Information ratio
  const informationRatio = trackingError > 0 ? alpha / trackingError : 0;

  return { alpha, trackingError, informationRatio };
}

/**
 * Extract daily returns from an equity curve.
 */
function equityCurveToReturns(curve: { equity: number }[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!.equity;
    const curr = curve[i]!.equity;
    returns.push(prev > 0 ? (curr - prev) / prev : 0);
  }
  return returns;
}

/**
 * Build a full benchmark comparison for a backtest result.
 * Fetches ETF data from the data provider, computes static benchmarks,
 * and calculates alpha metrics against each.
 */
export async function buildBenchmarkComparison(
  dataManager: DataManager,
  equityCurve: BacktestSnapshot[],
  initialCapital: number,
  startDate: Date,
  endDate: Date,
): Promise<BenchmarkComparison> {
  const tradingDays = equityCurve.length;
  const strategyReturns = equityCurveToReturns(equityCurve);

  const benchmarks: BenchmarkResult[] = [];
  const alphaVsBenchmarks: Record<string, AlphaMetrics> = {};

  // Static benchmarks
  for (const key of Object.keys(STATIC_BENCHMARKS) as (keyof typeof STATIC_BENCHMARKS)[]) {
    const bm = staticBenchmarkToResult(key, initialCapital, tradingDays);
    benchmarks.push(bm);

    // For static benchmarks, simulate constant daily return for alpha calc
    const dailyReturn = (1 + bm.annualizedReturn) ** (1 / 252) - 1;
    const simulatedReturns = Array.from({ length: strategyReturns.length }, () => dailyReturn);
    alphaVsBenchmarks[bm.name] = computeAlphaMetrics(strategyReturns, simulatedReturns);
  }

  // ETF benchmarks
  for (const etf of ETF_BENCHMARKS) {
    try {
      const history = await dataManager.getHistory(etf.symbol, "1d", startDate, endDate);
      if (history.length >= 2) {
        const bm = computeETFBenchmark(etf.symbol, etf.name, history, initialCapital);
        benchmarks.push(bm);

        if (bm.equityCurve && bm.equityCurve.length > 1) {
          const bmReturns = equityCurveToReturns(bm.equityCurve);
          alphaVsBenchmarks[bm.name] = computeAlphaMetrics(strategyReturns, bmReturns);
        }
      }
    } catch {
      // Skip ETF benchmarks if data is unavailable
    }
  }

  return { benchmarks, alphaVsBenchmarks };
}

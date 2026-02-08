import { describe, expect, test } from "bun:test";
import { computeAlphaMetrics, computeETFBenchmark, staticBenchmarkToResult } from "../../src/backtest/benchmarks.js";
import type { BacktestResult } from "../../src/backtest/types.js";
import type { OHLCV } from "../../src/data/types.js";
import { scoreBacktestResult, scoreWithAlpha } from "../../src/evolution/scoring.js";

describe("Benchmark Comparison", () => {
  test("staticBenchmarkToResult compounds correctly", () => {
    const result = staticBenchmarkToResult("HFRI_COMPOSITE", 100000, 252);
    // 1 year at 7.2% annualized
    expect(result.totalReturnPercent).toBeCloseTo(0.072, 3);
    expect(result.annualizedReturn).toBe(0.072);
    expect(result.sharpeRatio).toBe(0.58);
    expect(result.maxDrawdown).toBe(0.21);
    expect(result.name).toBe("HFRI Fund Weighted Composite");

    // Multi-year compounding
    const twoYear = staticBenchmarkToResult("HFRI_COMPOSITE", 100000, 504);
    const expectedTwoYear = 1.072 ** 2 - 1;
    expect(twoYear.totalReturnPercent).toBeCloseTo(expectedTwoYear, 3);

    // Half year
    const halfYear = staticBenchmarkToResult("HFRI_EQUITY_HEDGE", 100000, 126);
    const expectedHalf = 1.084 ** 0.5 - 1;
    expect(halfYear.totalReturnPercent).toBeCloseTo(expectedHalf, 3);
  });

  test("computeETFBenchmark handles empty history", () => {
    const result = computeETFBenchmark("SPY", "S&P 500", [], 100000);
    expect(result.totalReturnPercent).toBe(0);
    expect(result.sharpeRatio).toBe(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.equityCurve).toHaveLength(0);
  });

  test("computeETFBenchmark handles single-bar history", () => {
    const singleBar: OHLCV[] = [{ timestamp: Date.now(), open: 100, high: 105, low: 95, close: 100, volume: 1000 }];
    const result = computeETFBenchmark("SPY", "S&P 500", singleBar, 100000);
    expect(result.totalReturnPercent).toBe(0);
    expect(result.equityCurve).toHaveLength(0); // <2 bars returns early
  });

  test("computeETFBenchmark handles normal history", () => {
    // Simulate 5 days of price data going from 100 to 110 (10% return)
    const base = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const history: OHLCV[] = [];
    const prices = [100, 102, 105, 108, 110];
    for (let i = 0; i < prices.length; i++) {
      history.push({
        timestamp: base + i * 24 * 60 * 60 * 1000,
        open: prices[i]!,
        high: prices[i]! + 1,
        low: prices[i]! - 1,
        close: prices[i]!,
        volume: 100000,
      });
    }

    const result = computeETFBenchmark("SPY", "S&P 500", history, 100000);
    expect(result.totalReturnPercent).toBeCloseTo(0.1, 2);
    expect(result.equityCurve).toHaveLength(5);
    expect(result.maxDrawdown).toBe(0); // Price only went up
    expect(result.sharpeRatio).toBeGreaterThan(0);
  });

  test("computeAlphaMetrics returns zero for identical series", () => {
    const returns = [0.01, -0.005, 0.008, 0.003, -0.002];
    const alpha = computeAlphaMetrics(returns, returns);
    expect(alpha.alpha).toBeCloseTo(0, 8);
    expect(alpha.trackingError).toBeCloseTo(0, 8);
    expect(alpha.informationRatio).toBe(0); // 0/0 case returns 0
  });

  test("computeAlphaMetrics returns positive for outperformance", () => {
    const strategyReturns = [0.02, 0.01, 0.015, 0.01, 0.005];
    const benchmarkReturns = [0.01, 0.005, 0.008, 0.003, 0.001];
    const alpha = computeAlphaMetrics(strategyReturns, benchmarkReturns);
    expect(alpha.alpha).toBeGreaterThan(0);
    expect(alpha.informationRatio).toBeGreaterThan(0);
    expect(alpha.trackingError).toBeGreaterThan(0);
  });

  test("computeAlphaMetrics handles empty arrays", () => {
    const alpha = computeAlphaMetrics([], []);
    expect(alpha.alpha).toBe(0);
    expect(alpha.trackingError).toBe(0);
    expect(alpha.informationRatio).toBe(0);
  });

  test("scoreWithAlpha matches base score when alpha is undefined", () => {
    const mockResult: BacktestResult = {
      config: {
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
        initialCapital: 100000,
        symbols: ["AAPL"],
        commission: 1,
        slippage: 0.05,
      },
      startEquity: 100000,
      endEquity: 112000,
      totalReturn: 12000,
      totalReturnPercent: 0.12,
      annualizedReturn: 0.12,
      sharpeRatio: 1.5,
      maxDrawdown: 0.05,
      maxDrawdownDate: "2024-06-15",
      winRate: 0.65,
      profitFactor: 2.0,
      totalTrades: 20,
      winningTrades: 13,
      losingTrades: 7,
      averageWin: 800,
      averageLoss: 400,
      largestWin: 2000,
      largestLoss: 1000,
      tradingDays: 252,
      trades: [],
      equityCurve: [],
    };

    const baseScore = scoreBacktestResult(mockResult);
    const alphaScore = scoreWithAlpha(mockResult);
    expect(alphaScore.composite).toBe(baseScore.composite);

    // With positive alpha, should be different
    const boosted = scoreWithAlpha(mockResult, 0.05);
    expect(boosted.composite).not.toBe(baseScore.composite);
  });
});

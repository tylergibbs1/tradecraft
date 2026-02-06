import { describe, expect, it } from "bun:test";
import type { BacktestResult } from "../../src/backtest/types.js";
import { compareScores, scoreBacktestResult } from "../../src/evolution/scoring.js";

function makeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    config: {} as BacktestResult["config"],
    startEquity: 100000,
    endEquity: 110000,
    totalReturn: 10000,
    totalReturnPercent: 0.1,
    annualizedReturn: 0.1,
    sharpeRatio: 1.5,
    maxDrawdown: 0.08,
    maxDrawdownDate: "2024-06-01",
    winRate: 0.55,
    profitFactor: 1.8,
    totalTrades: 20,
    winningTrades: 11,
    losingTrades: 9,
    averageWin: 1500,
    averageLoss: 800,
    largestWin: 3000,
    largestLoss: 2000,
    tradingDays: 252,
    trades: [],
    equityCurve: [],
    ...overrides,
  };
}

describe("scoreBacktestResult", () => {
  it("returns a composite score between 0 and 1", () => {
    const score = scoreBacktestResult(makeResult());
    expect(score.composite).toBeGreaterThanOrEqual(0);
    expect(score.composite).toBeLessThanOrEqual(1);
  });

  it("gives higher score to better Sharpe ratio", () => {
    const good = scoreBacktestResult(makeResult({ sharpeRatio: 2.5 }));
    const bad = scoreBacktestResult(makeResult({ sharpeRatio: 0.5 }));
    expect(good.composite).toBeGreaterThan(bad.composite);
  });

  it("gives higher score to better return", () => {
    const good = scoreBacktestResult(makeResult({ totalReturnPercent: 0.3 }));
    const bad = scoreBacktestResult(makeResult({ totalReturnPercent: -0.1 }));
    expect(good.composite).toBeGreaterThan(bad.composite);
  });

  it("penalizes high drawdown", () => {
    const good = scoreBacktestResult(makeResult({ maxDrawdown: 0.05 }));
    const bad = scoreBacktestResult(makeResult({ maxDrawdown: 0.4 }));
    expect(good.composite).toBeGreaterThan(bad.composite);
  });

  it("penalizes fewer than 5 trades", () => {
    const fewTrades = scoreBacktestResult(makeResult({ totalTrades: 3 }));
    const manyTrades = scoreBacktestResult(makeResult({ totalTrades: 20 }));
    // Few trades gets 0.5x penalty
    expect(fewTrades.composite).toBeLessThan(manyTrades.composite);
  });

  it("handles Infinity profit factor", () => {
    const score = scoreBacktestResult(makeResult({ profitFactor: Infinity }));
    expect(score.profitFactor).toBe(999);
    expect(score.composite).toBeGreaterThan(0);
  });

  it("preserves raw metrics in the score object", () => {
    const result = makeResult({ sharpeRatio: 1.2, winRate: 0.6 });
    const score = scoreBacktestResult(result);
    expect(score.sharpe).toBe(1.2);
    expect(score.winRate).toBe(0.6);
  });
});

describe("compareScores", () => {
  it("returns positive when a > b", () => {
    const a = scoreBacktestResult(makeResult({ sharpeRatio: 3.0, totalReturnPercent: 0.5 }));
    const b = scoreBacktestResult(makeResult({ sharpeRatio: 0.5, totalReturnPercent: -0.1 }));
    expect(compareScores(a, b)).toBeGreaterThan(0);
  });

  it("returns negative when a < b", () => {
    const a = scoreBacktestResult(makeResult({ sharpeRatio: 0.1 }));
    const b = scoreBacktestResult(makeResult({ sharpeRatio: 3.0 }));
    expect(compareScores(a, b)).toBeLessThan(0);
  });
});

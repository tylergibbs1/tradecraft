import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import type { OHLCV } from "../../src/data/types.js";
import { RegimeDetector } from "../../src/regime/detector.js";
import { tmpFile } from "../fixtures.js";

const testFile = tmpFile("regime-detector");

function cleanup() {
  try {
    fs.unlinkSync(testFile);
  } catch {
    // ignore
  }
}

afterEach(cleanup);

/**
 * Generate synthetic OHLCV data with a given trend and volatility.
 */
function generateBars(opts: { startPrice: number; days: number; dailyReturn: number; volatility: number }): OHLCV[] {
  const bars: OHLCV[] = [];
  let price = opts.startPrice;
  const base = Date.now() - opts.days * 24 * 60 * 60 * 1000;

  for (let i = 0; i < opts.days; i++) {
    const change = price * opts.dailyReturn;
    const noise = price * opts.volatility * (Math.sin(i * 0.7) * 0.5);
    price += change + noise;
    price = Math.max(1, price);

    const high = price * (1 + opts.volatility * 0.5);
    const low = price * (1 - opts.volatility * 0.5);

    bars.push({
      timestamp: base + i * 24 * 60 * 60 * 1000,
      open: price - noise * 0.3,
      high,
      low,
      close: price,
      volume: 100000 + Math.floor(Math.random() * 50000),
    });
  }
  return bars;
}

describe("RegimeDetector", () => {
  test("classifyRegime detects bull trend with rising prices", () => {
    const detector = new RegimeDetector(testFile);
    const bars = generateBars({ startPrice: 100, days: 100, dailyReturn: 0.003, volatility: 0.01 });
    const result = detector.classifyRegime("AAPL", bars);

    // With steady uptrend and low vol, should be bull_trend or trending
    expect(["bull_trend", "trending", "low_volatility"]).toContain(result.regime);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.symbol).toBe("AAPL");
    expect(result.indicators.sma20).toBeGreaterThan(0);
    expect(result.indicators.sma50).toBeGreaterThan(0);
  });

  test("classifyRegime detects bear trend with falling prices", () => {
    const detector = new RegimeDetector(testFile);
    const bars = generateBars({ startPrice: 200, days: 100, dailyReturn: -0.003, volatility: 0.01 });
    const result = detector.classifyRegime("GOOGL", bars);

    expect(["bear_trend", "trending", "low_volatility"]).toContain(result.regime);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("classifyRegime detects high volatility", () => {
    const detector = new RegimeDetector(testFile);
    const bars = generateBars({ startPrice: 150, days: 100, dailyReturn: 0, volatility: 0.04 });
    const result = detector.classifyRegime("TSLA", bars);

    expect(result.regime).toBe("high_volatility");
    expect(result.indicators.atrPercent).toBeGreaterThan(0.02);
  });

  test("regime change detection across updates", () => {
    const detector = new RegimeDetector(testFile);

    // First: bull trend
    const bullBars = generateBars({ startPrice: 100, days: 100, dailyReturn: 0.003, volatility: 0.01 });
    detector.update("AAPL", bullBars);
    const firstRegime = detector.getCurrent("AAPL");
    expect(firstRegime).not.toBeNull();

    // Second: high volatility (different regime)
    const volBars = generateBars({ startPrice: 150, days: 100, dailyReturn: 0, volatility: 0.04 });
    detector.update("AAPL", volBars);

    const history = detector.getHistory();
    const appleChanges = history.changes.filter((c) => c.symbol === "AAPL");

    // If regime actually changed, we should have a change record
    if (firstRegime!.regime !== "high_volatility") {
      expect(appleChanges.length).toBeGreaterThan(0);
      expect(appleChanges[0]!.fromRegime).toBe(firstRegime!.regime);
      expect(appleChanges[0]!.adaptationCycles).toBeNull();
    }
  });

  test("persistence round-trip (save/reload)", () => {
    // Create detector and update
    const detector1 = new RegimeDetector(testFile);
    const bars = generateBars({ startPrice: 100, days: 100, dailyReturn: 0.002, volatility: 0.015 });
    detector1.update("MSFT", bars);

    const snap1 = detector1.getCurrent("MSFT");
    expect(snap1).not.toBeNull();

    // Reload from disk
    const detector2 = new RegimeDetector(testFile);
    const snap2 = detector2.getCurrent("MSFT");
    expect(snap2).not.toBeNull();
    expect(snap2!.regime).toBe(snap1!.regime);
    expect(snap2!.confidence).toBe(snap1!.confidence);
    expect(snap2!.symbol).toBe("MSFT");
  });

  test("adaptation tracking records correctly", () => {
    const detector = new RegimeDetector(testFile);

    // Create two different regime updates to trigger a change
    const bullBars = generateBars({ startPrice: 100, days: 100, dailyReturn: 0.003, volatility: 0.01 });
    detector.update("AAPL", bullBars);

    const volBars = generateBars({ startPrice: 150, days: 100, dailyReturn: 0, volatility: 0.04 });
    detector.update("AAPL", volBars);

    const history = detector.getHistory();
    const changes = history.changes.filter((c) => c.symbol === "AAPL");

    if (changes.length > 0) {
      const changeId = changes[0]!.id;
      const result = detector.recordAdaptation(changeId, 3);
      expect(result).toBe(true);

      const metrics = detector.getAdaptationMetrics();
      expect(metrics.adaptedChanges).toBeGreaterThan(0);
      expect(metrics.averageAdaptationCycles).toBe(3);
    }

    // Non-existent change ID
    expect(detector.recordAdaptation("nonexistent", 5)).toBe(false);
  });

  test("buildRegimeContext output format and length cap", () => {
    const detector = new RegimeDetector(testFile);

    // Update multiple symbols
    const symbols = ["AAPL", "GOOGL", "MSFT"];
    for (const sym of symbols) {
      const bars = generateBars({
        startPrice: 100 + Math.random() * 100,
        days: 100,
        dailyReturn: 0.002,
        volatility: 0.015,
      });
      detector.update(sym, bars);
    }

    const ctx = detector.buildRegimeContext(symbols);
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx.length).toBeLessThanOrEqual(500);
    expect(ctx).toContain("Market regimes:");
    expect(ctx).toContain("AAPL:");
    expect(ctx).toContain("GOOGL:");
    expect(ctx).toContain("MSFT:");
  });

  test("buildRegimeContext returns empty string for unknown symbols", () => {
    const detector = new RegimeDetector(testFile);
    const ctx = detector.buildRegimeContext(["UNKNOWN"]);
    expect(ctx).toBe("");
  });
});

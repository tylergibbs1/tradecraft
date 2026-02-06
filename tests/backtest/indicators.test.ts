import { describe, expect, it } from "bun:test";
import { computeEMA, computeRSI, computeSMA } from "../../src/backtest/indicators.js";

describe("computeSMA", () => {
  it("returns NaN for periods before enough data", () => {
    const result = computeSMA([1, 2, 3, 4, 5], 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
  });

  it("computes correct SMA values", () => {
    const closes = [1, 2, 3, 4, 5];
    const result = computeSMA(closes, 3);
    // SMA(3) at index 2 = (1+2+3)/3 = 2
    expect(result[2]).toBeCloseTo(2, 10);
    // SMA(3) at index 3 = (2+3+4)/3 = 3
    expect(result[3]).toBeCloseTo(3, 10);
    // SMA(3) at index 4 = (3+4+5)/3 = 4
    expect(result[4]).toBeCloseTo(4, 10);
  });

  it("handles period of 1", () => {
    const closes = [10, 20, 30];
    const result = computeSMA(closes, 1);
    expect(result[0]).toBeCloseTo(10, 10);
    expect(result[1]).toBeCloseTo(20, 10);
    expect(result[2]).toBeCloseTo(30, 10);
  });

  it("handles constant values", () => {
    const closes = [5, 5, 5, 5, 5];
    const result = computeSMA(closes, 3);
    expect(result[2]).toBeCloseTo(5, 10);
    expect(result[4]).toBeCloseTo(5, 10);
  });
});

describe("computeEMA", () => {
  it("returns NaN before enough data", () => {
    const result = computeEMA([1, 2], 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
  });

  it("seeds EMA with SMA at the period boundary", () => {
    const closes = [1, 2, 3, 4, 5];
    const result = computeEMA(closes, 3);
    // At index 2 (period-1), EMA = SMA = (1+2+3)/3 = 2
    expect(result[2]).toBeCloseTo(2, 10);
  });

  it("applies exponential weighting after seed", () => {
    const closes = [1, 2, 3, 4, 5];
    const result = computeEMA(closes, 3);
    // multiplier = 2 / (3 + 1) = 0.5
    // index 3: EMA = (4 - 2) * 0.5 + 2 = 3
    expect(result[3]).toBeCloseTo(3, 10);
    // index 4: EMA = (5 - 3) * 0.5 + 3 = 4
    expect(result[4]).toBeCloseTo(4, 10);
  });

  it("converges to constant for constant input", () => {
    const closes = Array.from({ length: 20 }, () => 100);
    const result = computeEMA(closes, 5);
    // After warmup, EMA should be 100
    expect(result[19]).toBeCloseTo(100, 5);
  });
});

describe("computeRSI", () => {
  it("returns NaN for insufficient data", () => {
    const result = computeRSI([1, 2, 3], 14);
    expect(result.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("returns near 100 when all changes are positive", () => {
    // Monotonically increasing prices — RSI approaches 100 but smoothing prevents exact 100
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = computeRSI(closes, 14);
    expect(result[14]).toBeGreaterThan(95);
  });

  it("returns values between 0 and 100", () => {
    // Mix of ups and downs
    const closes = [100, 102, 101, 103, 99, 104, 98, 105, 97, 106, 95, 107, 96, 108, 94, 109, 93, 110, 92, 111];
    const result = computeRSI(closes, 14);
    for (const v of result) {
      if (!Number.isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("computes correct RSI for known values", () => {
    // 14 periods: 7 gains of +1 and 7 losses of -1 (alternating)
    // avg gain = 1, avg loss = 1, RS = 1, RSI = 50
    const closes: number[] = [100];
    for (let i = 0; i < 14; i++) {
      const last = closes[closes.length - 1]!;
      closes.push(i % 2 === 0 ? last + 1 : last - 1);
    }
    const result = computeRSI(closes, 14);
    // RSI at index 14 with equal gains/losses should be ~50
    expect(result[14]).toBeCloseTo(50, 0);
  });
});

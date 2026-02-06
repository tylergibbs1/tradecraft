import { describe, expect, it } from "bun:test";
import { compileStrategy, validateSpec } from "../../src/evolution/compiler.js";
import type { StrategySpec } from "../../src/evolution/types.js";
import { andLogicSpec, rsiOversoldSpec, smaCrossoverSpec } from "../fixtures.js";

describe("validateSpec", () => {
  it("accepts a valid SMA crossover spec", () => {
    const result = validateSpec(smaCrossoverSpec);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a valid RSI spec", () => {
    const result = validateSpec(rsiOversoldSpec);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid AND logic spec", () => {
    const result = validateSpec(andLogicSpec);
    expect(result.valid).toBe(true);
  });

  it("rejects a spec with missing name", () => {
    const bad = { ...smaCrossoverSpec, name: "" };
    const result = validateSpec(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects a spec with invalid basePercent", () => {
    const bad: StrategySpec = {
      ...smaCrossoverSpec,
      positionSizing: { method: "fixed_percent", basePercent: 2, maxPercent: 0.2 },
    };
    const result = validateSpec(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("basePercent"))).toBe(true);
  });

  it("rejects a spec with negative stopLoss", () => {
    const bad: StrategySpec = {
      ...smaCrossoverSpec,
      exitRules: { stopLossPercent: -0.05 },
    };
    const result = validateSpec(bad);
    expect(result.valid).toBe(false);
  });
});

describe("compileStrategy", () => {
  it("compiles a valid spec into a strategy with name and generateSignals", () => {
    const strategy = compileStrategy(smaCrossoverSpec);
    expect(strategy.name).toBe("SMA 10/50 Crossover");
    expect(typeof strategy.generateSignals).toBe("function");
  });

  it("returns hold signal when history is too short", () => {
    const strategy = compileStrategy(smaCrossoverSpec);
    const signal = strategy.generateSignals("AAPL", [], null);
    expect(signal.type).toBe("hold");
    expect(signal.strength).toBe(0);
  });
});

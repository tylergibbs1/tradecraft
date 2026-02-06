import { describe, expect, it } from "bun:test";
import { validateSpec } from "../../src/evolution/compiler.js";
import { combineStrategies, createRng, mutateStrategy } from "../../src/evolution/engine.js";
import { rsiOversoldSpec, smaCrossoverSpec } from "../fixtures.js";

describe("createRng", () => {
  it("returns Math.random when no seed given", () => {
    const rng = createRng();
    expect(rng).toBe(Math.random);
  });

  it("returns deterministic values for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const valsA = Array.from({ length: 10 }, () => a());
    const valsB = Array.from({ length: 10 }, () => b());
    expect(valsA).toEqual(valsB);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    const valsA = Array.from({ length: 5 }, () => a());
    const valsB = Array.from({ length: 5 }, () => b());
    expect(valsA).not.toEqual(valsB);
  });
});

describe("mutateStrategy", () => {
  it("returns a child spec and mutation type", () => {
    const result = mutateStrategy(smaCrossoverSpec, "adjust_period", 42);
    expect(result.spec).toBeDefined();
    expect(result.mutation).toBe("adjust_period");
    expect(result.spec.name).toContain("(mutated)");
  });

  it("produces deterministic mutations with same seed", () => {
    const a = mutateStrategy(smaCrossoverSpec, "adjust_period", 99);
    const b = mutateStrategy(smaCrossoverSpec, "adjust_period", 99);
    expect(a.spec).toEqual(b.spec);
  });

  it("produces different mutations with different seeds", () => {
    const a = mutateStrategy(smaCrossoverSpec, "adjust_exit", 1);
    const b = mutateStrategy(smaCrossoverSpec, "adjust_exit", 2);
    // Exit rules should differ
    expect(a.spec.exitRules).not.toEqual(b.spec.exitRules);
  });

  it("produces a valid child for adjust_period", () => {
    const { spec } = mutateStrategy(smaCrossoverSpec, "adjust_period", 42);
    const v = validateSpec(spec);
    expect(v.valid).toBe(true);
  });

  it("produces a valid child for adjust_threshold", () => {
    const { spec } = mutateStrategy(rsiOversoldSpec, "adjust_threshold", 42);
    const v = validateSpec(spec);
    expect(v.valid).toBe(true);
  });

  it("produces a valid child for adjust_exit", () => {
    const { spec } = mutateStrategy(smaCrossoverSpec, "adjust_exit", 42);
    const v = validateSpec(spec);
    expect(v.valid).toBe(true);
    expect(spec.exitRules.stopLossPercent).toBeGreaterThan(0);
  });

  it("produces a valid child for adjust_sizing", () => {
    const { spec } = mutateStrategy(smaCrossoverSpec, "adjust_sizing", 42);
    const v = validateSpec(spec);
    expect(v.valid).toBe(true);
    expect(spec.positionSizing.basePercent).toBeGreaterThan(0);
    expect(spec.positionSizing.basePercent).toBeLessThanOrEqual(spec.positionSizing.maxPercent);
  });

  it("swap_indicator toggles SMA<->EMA", () => {
    const { spec } = mutateStrategy(smaCrossoverSpec, "swap_indicator", 42);
    // SMA crossover should become EMA
    if (spec.entryLong.kind === "comparison") {
      const left = spec.entryLong.left;
      if ("type" in left && left.type !== "price" && !("value" in left)) {
        expect(left.type).toBe("EMA");
      }
    }
  });

  it("does not mutate the original spec", () => {
    const original = JSON.parse(JSON.stringify(smaCrossoverSpec));
    mutateStrategy(smaCrossoverSpec, "adjust_period", 42);
    expect(smaCrossoverSpec).toEqual(original);
  });
});

describe("combineStrategies", () => {
  it("creates an AND-combined strategy from two parents", () => {
    const combined = combineStrategies(smaCrossoverSpec, rsiOversoldSpec);
    expect(combined.entryLong.kind).toBe("and");
    expect(combined.name).toContain("+");
  });

  it("produces a valid combined spec", () => {
    const combined = combineStrategies(smaCrossoverSpec, rsiOversoldSpec);
    const v = validateSpec(combined);
    expect(v.valid).toBe(true);
  });
});

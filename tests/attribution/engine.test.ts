import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { AttributionEngine } from "../../src/attribution/engine.js";
import { tmpFile } from "../fixtures.js";

const TEST_FILE = tmpFile("attribution");

function freshEngine(): AttributionEngine {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
  return new AttributionEngine(TEST_FILE);
}

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe("AttributionEngine", () => {
  let engine: AttributionEngine;

  beforeEach(() => {
    engine = freshEngine();
  });

  it("starts with no attributions or performances", () => {
    expect(engine.getRecentAttributions()).toHaveLength(0);
    expect(engine.getPerformance()).toHaveLength(0);
  });

  it("records a trade attribution and distributes P&L", () => {
    const attr = engine.recordAttribution("trade-1", "AAPL", "buy", 100, [
      { signalId: "sig-1", agentRole: "analyst", signal: "BUY", confidence: 0.8, weight: 0.5 },
      { signalId: "sig-2", agentRole: "momentum", signal: "BUY", confidence: 0.6, weight: 0.5 },
    ]);

    expect(attr.tradeId).toBe("trade-1");
    expect(attr.pnl).toBe(100);
    expect(attr.signals).toHaveLength(2);

    // P&L should sum to total
    const totalAttributed = attr.signals.reduce((sum, s) => sum + s.attributedPnl, 0);
    expect(totalAttributed).toBeCloseTo(100, 5);

    // Higher confidence signal should get more P&L
    const analystPnl = attr.signals.find((s) => s.agentRole === "analyst")!.attributedPnl;
    const momentumPnl = attr.signals.find((s) => s.agentRole === "momentum")!.attributedPnl;
    expect(analystPnl).toBeGreaterThan(momentumPnl);
  });

  it("updates agent performance after recording", () => {
    engine.recordAttribution("t1", "AAPL", "buy", 100, [
      { signalId: "s1", agentRole: "analyst", signal: "BUY", confidence: 0.8, weight: 0.5 },
    ]);

    const perfs = engine.getPerformance();
    expect(perfs).toHaveLength(1);
    expect(perfs[0]!.agentRole).toBe("analyst");
    expect(perfs[0]!.totalSignals).toBe(1);
    expect(perfs[0]!.accurateSignals).toBe(1); // pnl > 0 counts as accurate
    expect(perfs[0]!.accuracy).toBe(1);
  });

  it("tracks losing trades as inaccurate", () => {
    engine.recordAttribution("t1", "AAPL", "sell", -50, [
      { signalId: "s1", agentRole: "analyst", signal: "SELL", confidence: 0.7, weight: 0.5 },
    ]);

    const perf = engine.getPerformance()[0]!;
    expect(perf.accurateSignals).toBe(0);
    expect(perf.accuracy).toBe(0);
    expect(perf.totalAttributedPnl).toBeLessThan(0);
  });

  it("persists to disk and reloads", () => {
    engine.recordAttribution("t1", "AAPL", "buy", 200, [
      { signalId: "s1", agentRole: "analyst", signal: "BUY", confidence: 0.8, weight: 1.0 },
    ]);

    const reloaded = new AttributionEngine(TEST_FILE);
    expect(reloaded.getRecentAttributions()).toHaveLength(1);
    expect(reloaded.getPerformance()).toHaveLength(1);
  });

  it("calculates weight adjustments after enough signals", () => {
    // Record 6 profitable trades for one agent, 6 losing for another
    for (let i = 0; i < 6; i++) {
      engine.recordAttribution(`win-${i}`, "AAPL", "buy", 100, [
        { signalId: `sw-${i}`, agentRole: "good-agent", signal: "BUY", confidence: 0.9, weight: 0.5 },
      ]);
      engine.recordAttribution(`lose-${i}`, "AAPL", "sell", -100, [
        { signalId: `sl-${i}`, agentRole: "bad-agent", signal: "SELL", confidence: 0.3, weight: 0.5 },
      ]);
    }

    const adjustments = engine.calculateWeightAdjustments({
      "good-agent": 0.5,
      "bad-agent": 0.5,
    });

    // Should produce adjustments
    expect(adjustments.length).toBeGreaterThan(0);

    const goodAdj = adjustments.find((a) => a.agentRole === "good-agent");
    const badAdj = adjustments.find((a) => a.agentRole === "bad-agent");

    // Good agent should get higher or equal weight (both may clamp to max)
    if (goodAdj && badAdj) {
      expect(goodAdj.newWeight).toBeGreaterThanOrEqual(badAdj.newWeight);
    }
  });

  it("does not adjust weights with fewer than 5 signals", () => {
    engine.recordAttribution("t1", "AAPL", "buy", 100, [
      { signalId: "s1", agentRole: "new-agent", signal: "BUY", confidence: 0.8, weight: 0.5 },
    ]);

    const adjustments = engine.calculateWeightAdjustments({ "new-agent": 0.5 });
    expect(adjustments).toHaveLength(0);
  });

  it("clamps weights to [0.05, 0.40]", () => {
    for (let i = 0; i < 10; i++) {
      engine.recordAttribution(`t-${i}`, "AAPL", "buy", 1000, [
        { signalId: `s-${i}`, agentRole: "super-agent", signal: "BUY", confidence: 1.0, weight: 0.9 },
      ]);
    }

    const adjustments = engine.calculateWeightAdjustments({ "super-agent": 0.9 });
    for (const adj of adjustments) {
      expect(adj.newWeight).toBeGreaterThanOrEqual(0.05);
      expect(adj.newWeight).toBeLessThanOrEqual(0.4);
    }
  });
});

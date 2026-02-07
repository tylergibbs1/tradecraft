import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { annotateDecisionOutcome, findDecision, readJournal, recordEnhancedAnalysis } from "../../src/journal/index.js";
import type { DecisionOutcome, EnhancedAnalysisEntry } from "../../src/journal/types.js";
import { tmpFile } from "../fixtures.js";

const testFile = tmpFile("journal-enhanced");

function cleanup() {
  try {
    fs.unlinkSync(testFile);
  } catch {
    // ignore
  }
}

afterEach(cleanup);

function makeEntry(overrides?: Partial<EnhancedAnalysisEntry>): EnhancedAnalysisEntry {
  return {
    symbol: "AAPL",
    action: "buy",
    reasoning: "Strong technicals with SMA crossover and RSI oversold bounce",
    confidence: 0.85,
    priceAtAnalysis: 175.5,
    biasAvoided: ["recency_bias", "overconfidence"],
    biasExplanation: "Checked that thesis is based on multi-week trend, not just today's move",
    marketConditions: {
      regime: "bull_trend",
      keyDrivers: ["AI spending", "iPhone cycle"],
    },
    counterfactual: "If AAPL drops 10%, I would cut at 5% stop loss and reassess thesis",
    decisionId: crypto.randomUUID(),
    ...overrides,
  };
}

describe("Enhanced Decision Journal", () => {
  test("recordEnhancedAnalysis round-trips through JSONL", () => {
    const entry = makeEntry();
    recordEnhancedAnalysis(entry, testFile);

    const entries = readJournal(testFile);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("enhanced_analysis");

    const data = entries[0]!.data as EnhancedAnalysisEntry;
    expect(data.symbol).toBe("AAPL");
    expect(data.action).toBe("buy");
    expect(data.biasAvoided).toEqual(["recency_bias", "overconfidence"]);
    expect(data.decisionId).toBe(entry.decisionId);
    expect(data.marketConditions.regime).toBe("bull_trend");
    expect(data.counterfactual).toContain("drops 10%");
  });

  test("findDecision locates by UUID", () => {
    const entry1 = makeEntry({ symbol: "AAPL" });
    const entry2 = makeEntry({ symbol: "GOOGL", decisionId: crypto.randomUUID() });

    recordEnhancedAnalysis(entry1, testFile);
    recordEnhancedAnalysis(entry2, testFile);

    const found = findDecision(entry2.decisionId, testFile);
    expect(found).not.toBeNull();
    expect((found!.data as EnhancedAnalysisEntry).symbol).toBe("GOOGL");

    const notFound = findDecision("nonexistent-id", testFile);
    expect(notFound).toBeNull();
  });

  test("annotateDecisionOutcome appends outcome, returns false for missing ID", () => {
    const entry = makeEntry();
    recordEnhancedAnalysis(entry, testFile);

    const outcome: DecisionOutcome = {
      closedAt: new Date().toISOString(),
      closePrice: 185.0,
      pnl: 950,
      pnlPercent: 0.054,
      holdingPeriodDays: 12,
      annotatedAt: new Date().toISOString(),
    };

    // Annotate existing decision
    const result = annotateDecisionOutcome(entry.decisionId, outcome, testFile);
    expect(result).toBe(true);

    // Should have 2 entries: original + annotated
    const entries = readJournal(testFile);
    expect(entries).toHaveLength(2);

    // Original is unchanged (no outcome)
    const original = entries[0]!.data as EnhancedAnalysisEntry;
    expect(original.outcome).toBeUndefined();

    // Annotated entry has outcome
    const annotated = entries[1]!.data as EnhancedAnalysisEntry;
    expect(annotated.outcome).toBeDefined();
    expect(annotated.outcome!.pnl).toBe(950);
    expect(annotated.outcome!.closePrice).toBe(185.0);
    expect(annotated.outcome!.holdingPeriodDays).toBe(12);

    // Missing ID returns false
    const missing = annotateDecisionOutcome("nonexistent", outcome, testFile);
    expect(missing).toBe(false);
  });

  test("backward compat: readJournal works with mixed entry types", () => {
    // Write a plain analysis entry (old format)
    const oldEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "analysis",
      data: {
        symbol: "MSFT",
        action: "hold",
        reasoning: "No clear signal",
        confidence: 0.5,
        priceAtAnalysis: 400,
      },
    });
    fs.writeFileSync(testFile, `${oldEntry}\n`);

    // Write a new enhanced entry
    const enhanced = makeEntry({ symbol: "NVDA" });
    recordEnhancedAnalysis(enhanced, testFile);

    // Write a trade entry
    const tradeEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "trade",
      data: {
        id: "test",
        orderId: "test",
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        price: 175,
        value: 1750,
        commission: 1,
        executedAt: new Date().toISOString(),
      },
    });
    fs.appendFileSync(testFile, `${tradeEntry}\n`);

    const entries = readJournal(testFile);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.type).toBe("analysis");
    expect(entries[1]!.type).toBe("enhanced_analysis");
    expect(entries[2]!.type).toBe("trade");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { recordEnhancedAnalysis } from "../../src/journal/index.js";
import {
  BIAS_BASE_RATES,
  createJournalTools,
  generateBiasReport,
  queryDecisionPatterns,
} from "../../src/journal/tools.js";
import type { EnhancedAnalysisEntry } from "../../src/journal/types.js";
import { tmpFile } from "../fixtures.js";

const testFile = tmpFile("journal-reporting");

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
    reasoning: "Strong technicals",
    confidence: 0.85,
    priceAtAnalysis: 175.5,
    biasAvoided: ["recency_bias", "overconfidence"],
    biasExplanation: "Checked multi-week trend",
    marketConditions: {
      regime: "bull_trend",
      keyDrivers: ["AI spending"],
    },
    counterfactual: "Cut at 5% stop loss",
    decisionId: crypto.randomUUID(),
    ...overrides,
  };
}

function makeEntryWithOutcome(overrides?: Partial<EnhancedAnalysisEntry>, pnl = 500): EnhancedAnalysisEntry {
  return makeEntry({
    outcome: {
      closedAt: new Date().toISOString(),
      closePrice: 180,
      pnl,
      pnlPercent: pnl / 17550,
      holdingPeriodDays: 10,
      annotatedAt: new Date().toISOString(),
    },
    ...overrides,
  });
}

describe("BIAS_BASE_RATES", () => {
  test("contains all 12 biases with citations", () => {
    expect(BIAS_BASE_RATES).toHaveLength(12);
    for (const rate of BIAS_BASE_RATES) {
      expect(rate.humanFallRate).toBeGreaterThan(0);
      expect(rate.humanFallRate).toBeLessThan(1);
      expect(rate.source).toBeTruthy();
    }
  });
});

describe("generateBiasReport", () => {
  test("empty journal returns zero stats", () => {
    const report = generateBiasReport(testFile);
    expect(report.totalDecisions).toBe(0);
    expect(report.decisionsWithOutcome).toBe(0);
    expect(report.biasStatistics).toHaveLength(12);
    expect(report.overallAvoidanceRate).toBe(0);
  });

  test("computes avoidance rates from decisions", () => {
    // 3 decisions: 2 avoid loss_aversion, 1 does not
    recordEnhancedAnalysis(makeEntry({ biasAvoided: ["loss_aversion", "anchoring"] }), testFile);
    recordEnhancedAnalysis(makeEntry({ biasAvoided: ["loss_aversion"], decisionId: crypto.randomUUID() }), testFile);
    recordEnhancedAnalysis(makeEntry({ biasAvoided: ["overconfidence"], decisionId: crypto.randomUUID() }), testFile);

    const report = generateBiasReport(testFile);
    expect(report.totalDecisions).toBe(3);

    const laStat = report.biasStatistics.find((s) => s.bias === "loss_aversion")!;
    expect(laStat.timesAvoided).toBe(2);
    expect(laStat.avoidanceRate).toBeCloseTo(2 / 3, 5);
  });

  test("computes P&L when avoided vs not with outcomes", () => {
    recordEnhancedAnalysis(
      makeEntryWithOutcome({ biasAvoided: ["loss_aversion"], decisionId: crypto.randomUUID() }, 500),
      testFile,
    );
    recordEnhancedAnalysis(
      makeEntryWithOutcome({ biasAvoided: ["loss_aversion"], decisionId: crypto.randomUUID() }, 300),
      testFile,
    );
    recordEnhancedAnalysis(makeEntryWithOutcome({ biasAvoided: [], decisionId: crypto.randomUUID() }, -200), testFile);

    const report = generateBiasReport(testFile);
    expect(report.decisionsWithOutcome).toBe(3);

    const laStat = report.biasStatistics.find((s) => s.bias === "loss_aversion")!;
    expect(laStat.avgPnlWhenAvoided).toBeCloseTo(400, 1);
    expect(laStat.avgPnlWhenNotAvoided).toBeCloseTo(-200, 1);
  });

  test("filters by symbol", () => {
    recordEnhancedAnalysis(makeEntry({ symbol: "AAPL" }), testFile);
    recordEnhancedAnalysis(makeEntry({ symbol: "GOOGL", decisionId: crypto.randomUUID() }), testFile);

    const report = generateBiasReport(testFile, "AAPL");
    expect(report.totalDecisions).toBe(1);
  });

  test("deduplicates by decisionId (latest wins)", () => {
    const id = crypto.randomUUID();
    // Original without outcome
    recordEnhancedAnalysis(makeEntry({ decisionId: id }), testFile);
    // Annotated with outcome (same decisionId)
    recordEnhancedAnalysis(makeEntryWithOutcome({ decisionId: id }, 1000), testFile);

    const report = generateBiasReport(testFile);
    expect(report.totalDecisions).toBe(1);
    expect(report.decisionsWithOutcome).toBe(1);
  });

  test("summary includes top avoided biases", () => {
    recordEnhancedAnalysis(makeEntry({ biasAvoided: ["loss_aversion", "anchoring"] }), testFile);
    recordEnhancedAnalysis(makeEntry({ biasAvoided: ["loss_aversion"], decisionId: crypto.randomUUID() }), testFile);

    const report = generateBiasReport(testFile);
    expect(report.summary).toContain("2 decisions analyzed");
    expect(report.summary).toContain("loss_aversion");
  });
});

describe("queryDecisionPatterns", () => {
  test("sold_into_rally matches sell during bull_trend", () => {
    recordEnhancedAnalysis(
      makeEntry({
        action: "sell",
        marketConditions: { regime: "bull_trend", keyDrivers: ["momentum"] },
      }),
      testFile,
    );
    recordEnhancedAnalysis(
      makeEntry({
        action: "sell",
        marketConditions: { regime: "bear_trend", keyDrivers: ["weakness"] },
        decisionId: crypto.randomUUID(),
      }),
      testFile,
    );

    const matches = queryDecisionPatterns("sold_into_rally", testFile);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.explanation).toContain("bull_trend");
  });

  test("bought_the_dip matches buy during bear_trend", () => {
    recordEnhancedAnalysis(
      makeEntry({
        action: "buy",
        marketConditions: { regime: "bear_trend", keyDrivers: ["oversold"] },
      }),
      testFile,
    );

    const matches = queryDecisionPatterns("bought_the_dip", testFile);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.explanation).toContain("bear_trend");
  });

  test("high_confidence_correct matches confidence > 0.8 + positive pnl", () => {
    recordEnhancedAnalysis(makeEntryWithOutcome({ confidence: 0.9 }, 1000), testFile);
    recordEnhancedAnalysis(makeEntryWithOutcome({ confidence: 0.5, decisionId: crypto.randomUUID() }, 500), testFile);

    const matches = queryDecisionPatterns("high_confidence_correct", testFile);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe(0.9);
  });

  test("high_confidence_wrong matches confidence > 0.8 + negative pnl", () => {
    recordEnhancedAnalysis(makeEntryWithOutcome({ confidence: 0.95 }, -500), testFile);

    const matches = queryDecisionPatterns("high_confidence_wrong", testFile);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.pnl).toBe(-500);
  });

  test("bias_saved_money matches biasAvoided + positive pnl", () => {
    recordEnhancedAnalysis(makeEntryWithOutcome({ biasAvoided: ["loss_aversion"] }, 800), testFile);
    recordEnhancedAnalysis(makeEntryWithOutcome({ biasAvoided: [], decisionId: crypto.randomUUID() }, 200), testFile);

    const matches = queryDecisionPatterns("bias_saved_money", testFile);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.explanation).toContain("loss_aversion");
  });

  test("held_during_drawdown matches hold during bear", () => {
    recordEnhancedAnalysis(
      makeEntry({
        action: "hold",
        marketConditions: { regime: "high_volatility", keyDrivers: ["crash"] },
      }),
      testFile,
    );

    const matches = queryDecisionPatterns("held_during_drawdown", testFile);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.explanation).toContain("high_volatility");
  });

  test("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      recordEnhancedAnalysis(
        makeEntry({
          action: "sell",
          marketConditions: { regime: "bull_trend", keyDrivers: [] },
          decisionId: crypto.randomUUID(),
        }),
        testFile,
      );
    }

    const matches = queryDecisionPatterns("sold_into_rally", testFile, undefined, 2);
    expect(matches).toHaveLength(2);
  });
});

describe("createJournalTools with filePath", () => {
  test("tools accept filePath dep for isolation", () => {
    const tools = createJournalTools({ filePath: testFile });
    expect(tools.record_enhanced_decision).toBeDefined();
    expect(tools.query_decisions).toBeDefined();
    expect(tools.generate_bias_report).toBeDefined();
    expect(tools.query_decision_patterns).toBeDefined();
  });

  test("generate_bias_report tool returns report", async () => {
    recordEnhancedAnalysis(makeEntry(), testFile);
    const tools = createJournalTools({ filePath: testFile });
    const result = await tools.generate_bias_report.handler({});
    expect(result.success).toBe(true);
    expect(result.report.totalDecisions).toBe(1);
    expect(result.baseRates).toHaveLength(12);
  });

  test("query_decision_patterns tool returns matches", async () => {
    recordEnhancedAnalysis(
      makeEntry({
        action: "sell",
        marketConditions: { regime: "bull_trend", keyDrivers: [] },
      }),
      testFile,
    );
    const tools = createJournalTools({ filePath: testFile });
    const result = await tools.query_decision_patterns.handler({
      pattern: "sold_into_rally",
    });
    expect(result.success).toBe(true);
    expect(result.matchCount).toBe(1);
  });
});

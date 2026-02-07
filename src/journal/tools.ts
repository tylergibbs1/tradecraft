/**
 * Decision Journal Agent Tools
 *
 * Tools for recording enhanced decisions with bias analysis and querying past decisions.
 * Includes bias avoidance reporting and decision pattern matching.
 */

import { z } from "zod";
import { readJournal, recordEnhancedAnalysis } from "./index.js";
import type {
  BiasBaseRate,
  BiasReport,
  BiasStatistic,
  CognitiveBias,
  DecisionPatternMatch,
  DecisionPatternType,
  EnhancedAnalysisEntry,
} from "./types.js";

const CognitiveBiasSchema = z.enum([
  "loss_aversion",
  "anchoring",
  "recency_bias",
  "herding",
  "overconfidence",
  "disposition_effect",
  "confirmation_bias",
  "sunk_cost_fallacy",
  "gambler_fallacy",
  "availability_bias",
  "status_quo_bias",
  "framing_effect",
]);

const MarketConditionsSchema = z.object({
  regime: z.string().describe("Current market regime (e.g., bull_trend, high_volatility)"),
  vixLevel: z.number().optional().describe("Current VIX level if known"),
  sectorMomentum: z.string().optional().describe("Sector momentum direction"),
  keyDrivers: z.array(z.string()).describe("Key market drivers influencing this decision"),
});

const RecordEnhancedDecisionSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
  action: z.enum(["buy", "sell", "hold"]).describe("Trading action taken or considered"),
  reasoning: z.string().min(1).max(2000).describe("Detailed reasoning for the decision"),
  confidence: z.number().min(0).max(1).describe("Confidence level (0-1)"),
  priceAtAnalysis: z.number().positive().describe("Current price at time of analysis"),
  biasAvoided: z.array(CognitiveBiasSchema).describe("Cognitive biases actively avoided in this decision"),
  biasExplanation: z.string().min(1).max(1000).describe("Explanation of how you identified and avoided these biases"),
  marketConditions: MarketConditionsSchema.describe("Current market conditions at decision time"),
  counterfactual: z
    .string()
    .min(1)
    .max(500)
    .describe("What would you do if the opposite happened? (e.g., if the stock drops 10% instead of rising)"),
});

const QueryDecisionsSchema = z.object({
  symbol: z.string().optional().describe("Filter by stock symbol"),
  biasType: z.string().optional().describe("Filter by cognitive bias type avoided"),
  withOutcome: z.boolean().optional().describe("Only return decisions that have outcome annotations"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default: 10)"),
});

const GenerateBiasReportSchema = z.object({
  symbol: z.string().optional().describe("Filter by stock symbol (optional, omit for all symbols)"),
});

const QueryDecisionPatternsSchema = z.object({
  pattern: z
    .enum([
      "sold_into_rally",
      "bought_the_dip",
      "high_confidence_correct",
      "high_confidence_wrong",
      "bias_saved_money",
      "held_during_drawdown",
    ])
    .describe("Pattern type to search for"),
  symbol: z.string().optional().describe("Filter by stock symbol"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default: 20)"),
});

/**
 * Human fall rates from behavioral finance literature.
 * These represent how often human traders fall for each bias.
 */
export const BIAS_BASE_RATES: BiasBaseRate[] = [
  { bias: "loss_aversion", humanFallRate: 0.7, source: "Kahneman & Tversky 1979" },
  { bias: "anchoring", humanFallRate: 0.75, source: "Tversky & Kahneman 1974" },
  { bias: "overconfidence", humanFallRate: 0.8, source: "Barber & Odean 2001" },
  { bias: "disposition_effect", humanFallRate: 0.65, source: "Odean 1998" },
  { bias: "recency_bias", humanFallRate: 0.72, source: "De Bondt & Thaler 1985" },
  { bias: "herding", humanFallRate: 0.6, source: "Bikhchandani, Hirshleifer & Welch 1992" },
  { bias: "confirmation_bias", humanFallRate: 0.78, source: "Nickerson 1998" },
  { bias: "sunk_cost_fallacy", humanFallRate: 0.68, source: "Arkes & Blumer 1985" },
  { bias: "gambler_fallacy", humanFallRate: 0.55, source: "Tversky & Kahneman 1971" },
  { bias: "availability_bias", humanFallRate: 0.62, source: "Tversky & Kahneman 1973" },
  { bias: "status_quo_bias", humanFallRate: 0.58, source: "Samuelson & Zeckhauser 1988" },
  { bias: "framing_effect", humanFallRate: 0.73, source: "Tversky & Kahneman 1981" },
];

function getBaseRate(bias: CognitiveBias): BiasBaseRate {
  return BIAS_BASE_RATES.find((b) => b.bias === bias) ?? { bias, humanFallRate: 0.5, source: "estimated" };
}

/**
 * Deduplicate enhanced_analysis entries by decisionId (latest entry wins).
 */
function deduplicateDecisions(
  entries: { timestamp: string; data: EnhancedAnalysisEntry }[],
): { timestamp: string; data: EnhancedAnalysisEntry }[] {
  const byId = new Map<string, { timestamp: string; data: EnhancedAnalysisEntry }>();
  for (const e of entries) {
    byId.set(e.data.decisionId, e);
  }
  return Array.from(byId.values());
}

/**
 * Generate bias avoidance report from journal entries.
 */
export function generateBiasReport(filePath?: string, symbolFilter?: string): BiasReport {
  const entries = readJournal(filePath);
  let enhanced = entries
    .filter((e) => e.type === "enhanced_analysis")
    .map((e) => ({ timestamp: e.timestamp, data: e.data as EnhancedAnalysisEntry }));

  enhanced = deduplicateDecisions(enhanced);

  if (symbolFilter) {
    const sym = symbolFilter.toUpperCase();
    enhanced = enhanced.filter((e) => e.data.symbol === sym);
  }

  const totalDecisions = enhanced.length;
  const withOutcome = enhanced.filter((e) => e.data.outcome !== undefined);
  const decisionsWithOutcome = withOutcome.length;

  // All known biases
  const allBiases: CognitiveBias[] = [
    "loss_aversion",
    "anchoring",
    "recency_bias",
    "herding",
    "overconfidence",
    "disposition_effect",
    "confirmation_bias",
    "sunk_cost_fallacy",
    "gambler_fallacy",
    "availability_bias",
    "status_quo_bias",
    "framing_effect",
  ];

  const biasStatistics: BiasStatistic[] = [];

  for (const bias of allBiases) {
    const avoided = enhanced.filter((e) => e.data.biasAvoided.includes(bias));
    const notAvoided = enhanced.filter((e) => !e.data.biasAvoided.includes(bias));

    // P&L when avoided vs not (only for decisions with outcomes)
    const avoidedWithOutcome = avoided.filter((e) => e.data.outcome !== undefined);
    const notAvoidedWithOutcome = notAvoided.filter((e) => e.data.outcome !== undefined);

    const avgPnlWhenAvoided =
      avoidedWithOutcome.length > 0
        ? avoidedWithOutcome.reduce((sum, e) => sum + (e.data.outcome?.pnl ?? 0), 0) / avoidedWithOutcome.length
        : 0;

    const avgPnlWhenNotAvoided =
      notAvoidedWithOutcome.length > 0
        ? notAvoidedWithOutcome.reduce((sum, e) => sum + (e.data.outcome?.pnl ?? 0), 0) / notAvoidedWithOutcome.length
        : 0;

    const baseRate = getBaseRate(bias);

    biasStatistics.push({
      bias,
      timesAvoided: avoided.length,
      totalDecisions,
      avoidanceRate: totalDecisions > 0 ? avoided.length / totalDecisions : 0,
      humanBaseRate: 1 - baseRate.humanFallRate,
      avgPnlWhenAvoided,
      avgPnlWhenNotAvoided,
    });
  }

  const totalAvoidances = biasStatistics.reduce((sum, s) => sum + s.timesAvoided, 0);
  const maxPossible = totalDecisions * allBiases.length;
  const overallAvoidanceRate = maxPossible > 0 ? totalAvoidances / maxPossible : 0;

  // Build summary
  const topAvoided = biasStatistics
    .filter((s) => s.timesAvoided > 0)
    .sort((a, b) => b.avoidanceRate - a.avoidanceRate)
    .slice(0, 3);

  const summaryParts = [`${totalDecisions} decisions analyzed (${decisionsWithOutcome} with outcomes).`];
  for (const stat of topAvoided) {
    const humanAvoidRate = ((1 - getBaseRate(stat.bias).humanFallRate) * 100).toFixed(0);
    summaryParts.push(
      `Agent avoided ${stat.bias} in ${(stat.avoidanceRate * 100).toFixed(0)}% of decisions (humans: ${humanAvoidRate}%).`,
    );
  }

  return {
    totalDecisions,
    decisionsWithOutcome,
    biasStatistics,
    overallAvoidanceRate,
    summary: summaryParts.join(" "),
  };
}

/**
 * Match decisions against known behavioral patterns.
 */
export function queryDecisionPatterns(
  patternType: DecisionPatternType,
  filePath?: string,
  symbolFilter?: string,
  limit = 20,
): DecisionPatternMatch[] {
  const entries = readJournal(filePath);
  let enhanced = entries
    .filter((e) => e.type === "enhanced_analysis")
    .map((e) => ({ timestamp: e.timestamp, data: e.data as EnhancedAnalysisEntry }));

  enhanced = deduplicateDecisions(enhanced);

  if (symbolFilter) {
    const sym = symbolFilter.toUpperCase();
    enhanced = enhanced.filter((e) => e.data.symbol === sym);
  }

  const matches: DecisionPatternMatch[] = [];

  for (const entry of enhanced) {
    const { data, timestamp } = entry;
    const regime = data.marketConditions.regime;
    const hasPnl = data.outcome !== undefined;
    const pnl = data.outcome?.pnl;

    let matched = false;
    let explanation = "";

    switch (patternType) {
      case "sold_into_rally":
        if (data.action === "sell" && (regime === "bull_trend" || regime === "trending")) {
          matched = true;
          explanation = `Sold ${data.symbol} during ${regime} regime (conf: ${data.confidence.toFixed(2)})`;
        }
        break;

      case "bought_the_dip":
        if (data.action === "buy" && (regime === "bear_trend" || regime === "high_volatility")) {
          matched = true;
          explanation = `Bought ${data.symbol} during ${regime} regime (conf: ${data.confidence.toFixed(2)})`;
        }
        break;

      case "high_confidence_correct":
        if (data.confidence > 0.8 && hasPnl && pnl! > 0) {
          matched = true;
          explanation = `High confidence (${data.confidence.toFixed(2)}) ${data.action} on ${data.symbol} → +$${pnl!.toFixed(2)}`;
        }
        break;

      case "high_confidence_wrong":
        if (data.confidence > 0.8 && hasPnl && pnl! < 0) {
          matched = true;
          explanation = `High confidence (${data.confidence.toFixed(2)}) ${data.action} on ${data.symbol} → -$${Math.abs(pnl!).toFixed(2)}`;
        }
        break;

      case "bias_saved_money":
        if (data.biasAvoided.length > 0 && hasPnl && pnl! > 0) {
          matched = true;
          explanation = `Avoided ${data.biasAvoided.join(", ")} on ${data.symbol} → +$${pnl!.toFixed(2)}`;
        }
        break;

      case "held_during_drawdown":
        if (data.action === "hold" && (regime === "bear_trend" || regime === "high_volatility")) {
          matched = true;
          explanation = `Held ${data.symbol} during ${regime} regime (conf: ${data.confidence.toFixed(2)})`;
        }
        break;
    }

    if (matched) {
      matches.push({
        decisionId: data.decisionId,
        timestamp,
        symbol: data.symbol,
        action: data.action,
        patternType,
        confidence: data.confidence,
        pnl,
        explanation,
      });
    }
  }

  return matches.slice(0, limit);
}

export function createJournalTools(deps?: { filePath?: string }) {
  const filePath = deps?.filePath;

  return {
    record_enhanced_decision: {
      description:
        "Record a trading decision with cognitive bias analysis, market conditions, and counterfactual reasoning. This builds a decision journal that tracks how well you avoid behavioral biases.",
      inputSchema: RecordEnhancedDecisionSchema,
      handler: async (input: z.infer<typeof RecordEnhancedDecisionSchema>) => {
        const decisionId = crypto.randomUUID();
        const entry: EnhancedAnalysisEntry = {
          symbol: input.symbol,
          action: input.action,
          reasoning: input.reasoning,
          confidence: input.confidence,
          priceAtAnalysis: input.priceAtAnalysis,
          biasAvoided: input.biasAvoided,
          biasExplanation: input.biasExplanation,
          marketConditions: input.marketConditions,
          counterfactual: input.counterfactual,
          decisionId,
        };

        recordEnhancedAnalysis(entry, filePath);

        return {
          success: true,
          decisionId,
          message: `Decision recorded for ${input.symbol} (${input.action}). Biases avoided: ${input.biasAvoided.join(", ") || "none noted"}. Will be auto-annotated with outcome when position closes.`,
        };
      },
    },

    query_decisions: {
      description:
        "Search past decisions by symbol, bias type, or outcome status. Use this to review decision quality and bias avoidance patterns.",
      inputSchema: QueryDecisionsSchema,
      handler: async (input: z.infer<typeof QueryDecisionsSchema>) => {
        const entries = readJournal(filePath);
        const limit = input.limit ?? 10;

        let enhanced = entries
          .filter((e) => e.type === "enhanced_analysis")
          .map((e) => ({ timestamp: e.timestamp, data: e.data as EnhancedAnalysisEntry }));

        if (input.symbol) {
          const sym = input.symbol.toUpperCase();
          enhanced = enhanced.filter((e) => e.data.symbol === sym);
        }

        if (input.biasType) {
          enhanced = enhanced.filter((e) => e.data.biasAvoided.some((b) => b === input.biasType));
        }

        if (input.withOutcome !== undefined) {
          enhanced = enhanced.filter((e) =>
            input.withOutcome ? e.data.outcome !== undefined : e.data.outcome === undefined,
          );
        }

        const results = enhanced.slice(-limit).reverse();

        return {
          success: true,
          count: results.length,
          decisions: results.map((r) => ({
            decisionId: r.data.decisionId,
            timestamp: r.timestamp,
            symbol: r.data.symbol,
            action: r.data.action,
            confidence: r.data.confidence,
            priceAtAnalysis: r.data.priceAtAnalysis,
            biasAvoided: r.data.biasAvoided,
            biasExplanation: r.data.biasExplanation,
            marketConditions: r.data.marketConditions,
            counterfactual: r.data.counterfactual,
            outcome: r.data.outcome ?? null,
          })),
        };
      },
    },

    generate_bias_report: {
      description:
        "Generate an aggregated bias avoidance report comparing agent performance against human behavioral finance base rates. Shows per-bias avoidance rates, P&L impact, and comparison to published human fall rates.",
      inputSchema: GenerateBiasReportSchema,
      handler: async (input: z.infer<typeof GenerateBiasReportSchema>) => {
        const report = generateBiasReport(filePath, input.symbol);
        return {
          success: true,
          report,
          baseRates: BIAS_BASE_RATES,
          timestamp: new Date().toISOString(),
        };
      },
    },

    query_decision_patterns: {
      description:
        "Search for behavioral patterns in past decisions. Patterns: sold_into_rally (sell during bull), bought_the_dip (buy during bear), high_confidence_correct/wrong, bias_saved_money, held_during_drawdown.",
      inputSchema: QueryDecisionPatternsSchema,
      handler: async (input: z.infer<typeof QueryDecisionPatternsSchema>) => {
        const matches = queryDecisionPatterns(input.pattern, filePath, input.symbol, input.limit ?? 20);
        return {
          success: true,
          pattern: input.pattern,
          matchCount: matches.length,
          matches,
          timestamp: new Date().toISOString(),
        };
      },
    },
  };
}

export { RecordEnhancedDecisionSchema, QueryDecisionsSchema, GenerateBiasReportSchema, QueryDecisionPatternsSchema };

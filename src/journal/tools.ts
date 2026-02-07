/**
 * Decision Journal Agent Tools
 *
 * Tools for recording enhanced decisions with bias analysis and querying past decisions.
 */

import { z } from "zod";
import { readJournal, recordEnhancedAnalysis } from "./index.js";
import type { EnhancedAnalysisEntry } from "./types.js";

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

export function createJournalTools() {
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

        recordEnhancedAnalysis(entry);

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
        const entries = readJournal();
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
  };
}

export { RecordEnhancedDecisionSchema, QueryDecisionsSchema };

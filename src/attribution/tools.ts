/**
 * Attribution Agent Tools
 *
 * Tools for querying attribution data and agent performance.
 */

import { z } from "zod";
import type { AttributionEngine } from "./engine.js";

const GetAttributionSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe("Number of recent attributions (default: 10)"),
});

const GetAgentPerformanceSchema = z.object({});

export function createAttributionTools(deps: { attributionEngine: AttributionEngine }) {
  const { attributionEngine } = deps;

  return {
    get_attribution: {
      description: "Get recent trade-to-signal attribution data showing which agents/signals drove P&L.",
      inputSchema: GetAttributionSchema,
      handler: async (input: z.infer<typeof GetAttributionSchema>) => {
        const attributions = attributionEngine.getRecentAttributions(input.limit ?? 10);
        return {
          success: true,
          count: attributions.length,
          attributions: attributions.map((a) => ({
            tradeId: a.tradeId,
            symbol: a.symbol,
            side: a.side,
            pnl: a.pnl,
            signals: a.signals.map((s) => ({
              agentRole: s.agentRole,
              signal: s.signal,
              confidence: s.confidence,
              attributedPnl: s.attributedPnl,
            })),
          })),
        };
      },
    },

    get_agent_performance: {
      description: "Get performance metrics for each agent role: accuracy, P&L contribution, and weight suggestions.",
      inputSchema: GetAgentPerformanceSchema,
      handler: async () => {
        const performances = attributionEngine.getPerformance();
        const history = attributionEngine.getAdjustmentHistory(5);

        return {
          success: true,
          agents: performances.map((p) => ({
            role: p.agentRole,
            totalSignals: p.totalSignals,
            accuracy: `${(p.accuracy * 100).toFixed(1)}%`,
            totalPnl: p.totalAttributedPnl,
            averageConfidence: p.averageConfidence,
            currentWeight: p.currentWeight,
            suggestedWeight: p.suggestedWeight,
          })),
          recentAdjustments: history.map((a) => ({
            role: a.agentRole,
            from: a.previousWeight,
            to: a.newWeight,
            reason: a.reason,
          })),
        };
      },
    },
  };
}

export { GetAttributionSchema, GetAgentPerformanceSchema };

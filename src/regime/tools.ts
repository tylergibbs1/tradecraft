/**
 * Regime Detection Agent Tools
 *
 * Tools for classifying market regimes and tracking adaptation.
 */

import { z } from "zod";
import type { DataManager } from "../data/index.js";
import type { RegimeDetector } from "./detector.js";

const GetRegimeSchema = z.object({
  symbols: z.array(z.string()).min(1).max(20).describe("Symbols to classify regime for"),
});

const GetAdaptationMetricsSchema = z.object({});

export function createRegimeTools(deps: { detector: RegimeDetector; dataManager: DataManager }) {
  const { detector, dataManager } = deps;

  return {
    get_regime: {
      description:
        "Classify the current market regime for given symbols. Returns regime type (bull_trend, bear_trend, high_volatility, low_volatility, mean_reverting, trending), confidence, and key indicators. Use this to adapt your trading strategy to current market conditions.",
      inputSchema: GetRegimeSchema,
      handler: async (input: z.infer<typeof GetRegimeSchema>) => {
        const results: Record<string, unknown> = {};

        for (const symbol of input.symbols) {
          try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 120); // ~4 months of history for SMA50

            const bars = await dataManager.getHistory(symbol, "1d", startDate, endDate);
            if (bars.length < 50) {
              results[symbol] = { error: `Insufficient history (${bars.length} bars, need 50+)` };
              continue;
            }

            const snapshot = detector.update(symbol, bars);
            results[symbol] = {
              regime: snapshot.regime,
              confidence: snapshot.confidence,
              indicators: snapshot.indicators,
              classifiedAt: snapshot.classifiedAt,
            };
          } catch (error) {
            results[symbol] = { error: String(error) };
          }
        }

        return {
          success: true,
          regimes: results,
          context: detector.buildRegimeContext(input.symbols),
          timestamp: new Date().toISOString(),
        };
      },
    },

    get_adaptation_metrics: {
      description:
        "View adaptation tracking summary: how many regime changes detected, how quickly the agent adapted to each change.",
      inputSchema: GetAdaptationMetricsSchema,
      handler: async () => {
        const metrics = detector.getAdaptationMetrics();
        return {
          success: true,
          ...metrics,
          timestamp: new Date().toISOString(),
        };
      },
    },
  };
}

export { GetRegimeSchema, GetAdaptationMetricsSchema };

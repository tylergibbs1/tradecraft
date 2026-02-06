/**
 * Evolution Agent Tools
 *
 * 5 tools for strategy evolution: propose, backtest, get_results, evolve, deploy
 */

import { z } from "zod";
import type { EvolutionEngine } from "./engine.js";
import type { StrategyStore } from "./store.js";
import type { StrategySpec } from "./types.js";

// -- Schemas --

const IndicatorRefSchema: z.ZodType<unknown> = z.object({
  type: z.enum(["SMA", "EMA", "RSI", "MACD", "ATR", "BOLLINGER"]),
  period: z.number().int().min(2).max(500).optional(),
  component: z.string().optional(),
});

const LiteralRefSchema = z.object({ type: z.literal("literal"), value: z.number() });
const PriceRefSchema = z.object({ type: z.literal("price") });

const ValueRefSchema = z.union([IndicatorRefSchema, LiteralRefSchema, PriceRefSchema]);

const ComparisonOpSchema = z.enum(["gt", "lt", "gte", "lte", "crosses_above", "crosses_below"]);

const ConditionNodeSchema: z.ZodType<unknown> = z.object({
  kind: z.literal("comparison"),
  left: ValueRefSchema,
  op: ComparisonOpSchema,
  right: ValueRefSchema,
});

const LogicNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    kind: z.enum(["and", "or"]),
    conditions: z.array(z.union([ConditionNodeSchema, LogicNodeSchema])),
  }),
);

const EntryRuleSchema = z.union([ConditionNodeSchema, LogicNodeSchema]);

const ExitRulesSchema = z.object({
  stopLossPercent: z.number().min(0).max(1).optional(),
  takeProfitPercent: z.number().min(0).max(1).optional(),
  trailingStopPercent: z.number().min(0).max(1).optional(),
  timeStopDays: z.number().int().min(1).max(365).optional(),
});

const PositionSizingSchema = z.object({
  method: z.enum(["fixed_percent", "conviction_scaled"]),
  basePercent: z.number().min(0.01).max(1),
  maxPercent: z.number().min(0.01).max(1),
});

const ProposeStrategySchema = z.object({
  name: z.string().min(1).max(100).describe("Strategy name"),
  description: z.string().min(1).max(500).describe("Strategy description"),
  entryLong: EntryRuleSchema.describe("Entry conditions for long positions (JSON DSL)"),
  exitRules: ExitRulesSchema.describe("Exit conditions (stop loss, take profit, etc.)"),
  positionSizing: PositionSizingSchema.describe("Position sizing parameters"),
});

const BacktestStrategySchema = z.object({
  strategyId: z.string().describe("ID of the strategy to backtest"),
  symbols: z.array(z.string()).min(1).max(20).describe("Symbols to backtest against"),
});

const GetStrategyResultsSchema = z.object({
  strategyId: z.string().optional().describe("Specific strategy ID, or omit for top strategies"),
  limit: z.number().int().min(1).max(50).optional().describe("Number of results (default: 10)"),
});

const EvolveStrategySchema = z.object({
  strategyId: z.string().describe("Parent strategy ID to evolve from"),
  symbols: z.array(z.string()).min(1).max(20).describe("Symbols to backtest children against"),
  generations: z.number().int().min(1).max(5).optional().describe("Number of evolution generations (default: 1)"),
});

const DeployStrategySchema = z.object({
  strategyId: z.string().describe("ID of the backtested strategy to deploy"),
});

// -- Tool Creator --

export function createEvolutionTools(deps: { engine: EvolutionEngine; store: StrategyStore }) {
  const { engine, store } = deps;

  return {
    propose_strategy: {
      description:
        "Propose a new trading strategy using the JSON DSL. Define entry conditions using indicators (SMA, EMA, RSI, MACD, ATR, BOLLINGER) with comparison operators (gt, lt, crosses_above, crosses_below) and AND/OR logic. Include exit rules and position sizing.",
      inputSchema: ProposeStrategySchema,
      handler: async (input: z.infer<typeof ProposeStrategySchema>) => {
        try {
          const spec: StrategySpec = {
            name: input.name,
            description: input.description,
            entryLong: input.entryLong as StrategySpec["entryLong"],
            exitRules: input.exitRules,
            positionSizing: input.positionSizing,
          };
          const record = engine.proposeStrategy(spec);
          return {
            success: true,
            strategyId: record.id,
            name: record.spec.name,
            status: record.status,
            message: `Strategy "${record.spec.name}" proposed. Use backtest_strategy to test it.`,
          };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
    },

    backtest_strategy: {
      description:
        "Run a backtest on a proposed strategy against specified symbols. Returns performance metrics and a composite fitness score.",
      inputSchema: BacktestStrategySchema,
      handler: async (input: z.infer<typeof BacktestStrategySchema>) => {
        try {
          const result = await engine.backtestStrategy(input.strategyId, input.symbols);
          if (!result) {
            return { success: false, error: `Strategy ${input.strategyId} not found` };
          }
          return {
            success: true,
            strategyId: result.id,
            name: result.spec.name,
            status: result.status,
            score: result.score,
            backtestResult: result.backtestResult,
          };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
    },

    get_strategy_results: {
      description: "Get strategy results. Provide a specific ID or get top-ranked strategies.",
      inputSchema: GetStrategyResultsSchema,
      handler: async (input: z.infer<typeof GetStrategyResultsSchema>) => {
        if (input.strategyId) {
          const record = store.get(input.strategyId);
          if (!record) {
            return { success: false, error: `Strategy ${input.strategyId} not found` };
          }
          return { success: true, strategy: record };
        }

        const results = engine.getResults();
        return {
          success: true,
          topStrategies: results.topStrategies.slice(0, input.limit ?? 10).map((r) => ({
            id: r.id,
            name: r.spec.name,
            generation: r.generation,
            score: r.score,
            status: r.status,
          })),
          deployed: results.deployed.map((r) => ({
            id: r.id,
            name: r.spec.name,
            score: r.score,
            deployedAt: r.deployedAt,
          })),
          stats: results.stats,
        };
      },
    },

    evolve_strategy: {
      description:
        "Evolve a strategy by creating mutated children, backtesting them, and selecting survivors. Returns the evolved population ranked by fitness.",
      inputSchema: EvolveStrategySchema,
      handler: async (input: z.infer<typeof EvolveStrategySchema>) => {
        try {
          const children = await engine.evolveStrategy(input.strategyId, input.symbols, input.generations ?? 1);
          const ranked = children
            .filter((c) => c.score !== undefined)
            .sort((a, b) => (b.score?.composite ?? 0) - (a.score?.composite ?? 0));

          return {
            success: true,
            parentId: input.strategyId,
            generations: input.generations ?? 1,
            childrenCreated: children.length,
            results: ranked.slice(0, 10).map((r) => ({
              id: r.id,
              name: r.spec.name,
              generation: r.generation,
              mutations: r.mutations,
              score: r.score,
              backtestResult: r.backtestResult,
            })),
          };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      },
    },

    deploy_strategy: {
      description: "Deploy a backtested strategy for live/paper trading. Only backtested strategies can be deployed.",
      inputSchema: DeployStrategySchema,
      handler: async (input: z.infer<typeof DeployStrategySchema>) => {
        const result = engine.deployStrategy(input.strategyId);
        if (!result) {
          return {
            success: false,
            error: `Strategy ${input.strategyId} not found or not yet backtested`,
          };
        }
        return {
          success: true,
          strategyId: result.id,
          name: result.spec.name,
          score: result.score,
          deployedAt: result.deployedAt,
          message: `Strategy "${result.spec.name}" deployed for trading.`,
        };
      },
    },
  };
}

// Export schemas
export {
  ProposeStrategySchema,
  BacktestStrategySchema,
  GetStrategyResultsSchema,
  EvolveStrategySchema,
  DeployStrategySchema,
};

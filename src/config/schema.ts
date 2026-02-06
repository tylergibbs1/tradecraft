import { z } from "zod";

// Data provider configuration
export const DataProviderSchema = z.enum(["polygon", "yahoo"]);
export type DataProvider = z.infer<typeof DataProviderSchema>;

// Risk limits configuration
export const RiskLimitsSchema = z.object({
  maxPositionSize: z.number().min(0).max(1).default(0.1), // % of portfolio
  maxPositionCount: z.number().int().min(1).max(100).default(10),
  dailyLossLimit: z.number().min(0).max(1).default(0.02), // % of portfolio
  weeklyLossLimit: z.number().min(0).max(1).default(0.05),
  maxDrawdown: z.number().min(0).max(1).default(0.1),
  maxOrderValue: z.number().min(0).default(10000), // absolute $
});
export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

// Trading universe configuration
export const TradingUniverseSchema = z.object({
  symbols: z.array(z.string()).default([]),
  sectors: z.array(z.string()).default([]),
  excludeSymbols: z.array(z.string()).default([]),
  allowShorts: z.boolean().default(false),
  allowOptions: z.boolean().default(false),
});
export type TradingUniverse = z.infer<typeof TradingUniverseSchema>;

// Agent parameters
export const AgentParamsSchema = z.object({
  model: z.enum(["claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]).default("claude-sonnet-4-5-20250929"),
  maxTurns: z.number().int().min(1).max(50).default(10),
  maxBudgetUsd: z.number().min(0).max(10).default(0.5),
  cycleIntervalMs: z.number().int().min(1000).default(60000), // 1 minute default
  systemPromptPath: z.string().optional(),
});
export type AgentParams = z.infer<typeof AgentParamsSchema>;

// Agent mode
export const AgentModeSchema = z.enum(["single", "swarm"]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

// Swarm parameters
export const SwarmParamsSchema = z.object({
  specialistModel: z.string().default("claude-sonnet-4-5-20250929"),
  weights: z.object({
    "fundamental-analyst": z.number().min(0).max(1).default(0.25),
    "earnings-analyst": z.number().min(0).max(1).default(0.20),
    "technical-analyst": z.number().min(0).max(1).default(0.15),
    "sentiment-analyst": z.number().min(0).max(1).default(0.10),
    "macro-analyst": z.number().min(0).max(1).default(0.15),
    "catalyst-analyst": z.number().min(0).max(1).default(0.10),
    "hypothesis-generator": z.number().min(0).max(1).default(0.05),
  }).default({
    "fundamental-analyst": 0.25,
    "earnings-analyst": 0.20,
    "technical-analyst": 0.15,
    "sentiment-analyst": 0.10,
    "macro-analyst": 0.15,
    "catalyst-analyst": 0.10,
    "hypothesis-generator": 0.05,
  }),
  parallelSpecialists: z.boolean().default(true),
  minConsensusConfidence: z.number().min(0).max(1).default(0.5),
});
export type SwarmParams = z.infer<typeof SwarmParamsSchema>;

// Capital configuration
export const CapitalSchema = z.object({
  initialCapital: z.number().min(0).default(100000),
  currency: z.string().default("USD"),
  paperTrading: z.boolean().default(true),
});
export type Capital = z.infer<typeof CapitalSchema>;

// Default values for nested objects
const defaultRiskLimits: RiskLimits = {
  maxPositionSize: 0.1,
  maxPositionCount: 10,
  dailyLossLimit: 0.02,
  weeklyLossLimit: 0.05,
  maxDrawdown: 0.1,
  maxOrderValue: 10000,
};

const defaultTradingUniverse: TradingUniverse = {
  symbols: ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"],
  sectors: [],
  excludeSymbols: [],
  allowShorts: false,
  allowOptions: false,
};

const defaultAgentParams: AgentParams = {
  model: "claude-sonnet-4-5-20250929",
  maxTurns: 10,
  maxBudgetUsd: 0.5,
  cycleIntervalMs: 60000,
};

const defaultCapital: Capital = {
  initialCapital: 100000,
  currency: "USD",
  paperTrading: true,
};

const defaultSwarmParams: SwarmParams = {
  specialistModel: "claude-sonnet-4-5-20250929",
  weights: {
    "fundamental-analyst": 0.25,
    "earnings-analyst": 0.20,
    "technical-analyst": 0.15,
    "sentiment-analyst": 0.10,
    "macro-analyst": 0.15,
    "catalyst-analyst": 0.10,
    "hypothesis-generator": 0.05,
  },
  parallelSpecialists: true,
  minConsensusConfidence: 0.5,
};

// Full configuration schema
export const ConfigSchema = z.object({
  dataProvider: DataProviderSchema.default("yahoo"),
  dataProviderApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  riskLimits: RiskLimitsSchema.default(defaultRiskLimits),
  tradingUniverse: TradingUniverseSchema.default(defaultTradingUniverse),
  agentParams: AgentParamsSchema.default(defaultAgentParams),
  agentMode: AgentModeSchema.default("single"),
  swarmParams: SwarmParamsSchema.default(defaultSwarmParams),
  capital: CapitalSchema.default(defaultCapital),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

// Default configuration
export const defaultConfig: Config = {
  dataProvider: "yahoo",
  riskLimits: defaultRiskLimits,
  tradingUniverse: defaultTradingUniverse,
  agentParams: defaultAgentParams,
  agentMode: "single",
  swarmParams: defaultSwarmParams,
  capital: defaultCapital,
};

/**
 * Multi-Model Tournament Types
 *
 * Types for running the same backtest across multiple Claude models
 * to answer "do LLMs as a class outperform active allocators?"
 */

export interface TournamentModel {
  id: string;
  name: string;
  costPerInputToken: number;
  costPerOutputToken: number;
}

export const TOURNAMENT_MODELS: TournamentModel[] = [
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6",
    costPerInputToken: 15 / 1_000_000,
    costPerOutputToken: 75 / 1_000_000,
  },
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Sonnet 4.5",
    costPerInputToken: 3 / 1_000_000,
    costPerOutputToken: 15 / 1_000_000,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Haiku 4.5",
    costPerInputToken: 0.8 / 1_000_000,
    costPerOutputToken: 4 / 1_000_000,
  },
];

export interface ModelResult {
  modelId: string;
  modelName: string;
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  equityCurve: { timestamp: number; equity: number }[];
}

export interface TournamentResult {
  models: ModelResult[];
  bestModel: string;
  classPerformance: {
    avgReturn: number;
    avgSharpe: number;
    avgMaxDrawdown: number;
    avgWinRate: number;
  };
  vsActiveBenchmarks: {
    benchmarkName: string;
    benchmarkReturn: number;
    classReturn: number;
    classBeatsBenchmark: boolean;
  }[];
  rankedModels: string[];
  config: {
    symbols: string[];
    startDate: string;
    endDate: string;
    initialCapital: number;
  };
  completedAt: string;
}

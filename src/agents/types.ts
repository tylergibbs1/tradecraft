/**
 * Agent Swarm Types
 *
 * Core types for multi-agent communication and coordination in the
 * AI-native hedge fund architecture.
 */

export type SignalStrength = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export type SignalTimeframe = 'intraday' | 'day' | 'week' | 'month' | 'quarter';

export type AgentRole =
  | 'portfolio-manager'
  | 'fundamental-analyst'
  | 'earnings-analyst'
  | 'technical-analyst'
  | 'sentiment-analyst'
  | 'macro-analyst'
  | 'catalyst-analyst'
  | 'hypothesis-generator';

export interface AgentSignal {
  id: string;
  agentId: string;
  agentRole: AgentRole;
  symbol: string;
  signal: SignalStrength;
  confidence: number;       // 0-1
  timeframe: SignalTimeframe;
  reasoning: string;
  thesis?: string;          // Investment thesis summary
  priceTarget?: number;
  stopLoss?: number;
  catalysts?: string[];     // Expected catalysts
  risks?: string[];         // Key risks
  data?: Record<string, unknown>;  // Supporting metrics/data
  expiresAt?: string;       // ISO timestamp when signal becomes stale
  timestamp: string;        // ISO timestamp
}

export interface ConsensusResult {
  symbol: string;
  weightedScore: number;      // -2 (STRONG_SELL) to +2 (STRONG_BUY)
  signalCount: number;
  averageConfidence: number;
  recommendation: SignalStrength;
  positionSizeMultiplier: number;  // 0-1 based on consensus strength
  signals: AgentSignal[];
  dissent?: string[];         // Agents with opposing views
  timestamp: string;
}

export interface AgentWeights {
  'fundamental-analyst': number;
  'earnings-analyst': number;
  'technical-analyst': number;
  'sentiment-analyst': number;
  'macro-analyst': number;
  'catalyst-analyst': number;
  'hypothesis-generator': number;
}

export const DEFAULT_AGENT_WEIGHTS: AgentWeights = {
  'fundamental-analyst': 0.25,    // 10-K/10-Q analysis
  'earnings-analyst': 0.20,       // Earnings call analysis
  'technical-analyst': 0.15,      // Price/volume patterns
  'sentiment-analyst': 0.10,      // News/social sentiment
  'macro-analyst': 0.15,          // Sector/macro signals
  'catalyst-analyst': 0.10,       // Event-driven
  'hypothesis-generator': 0.05,   // Novel alpha ideas
};

export interface ResearchContext {
  symbol: string;
  currentPrice?: number;
  marketCap?: number;
  sector?: string;
  industry?: string;
  recentNews?: NewsItem[];
  recentFilings?: FilingMetadata[];
  priceHistory?: PriceBar[];
  existingSignals?: AgentSignal[];  // Signals from other agents
}

export interface NewsItem {
  title: string;
  source: string;
  url?: string;
  publishedAt: string;
  sentiment?: number;  // -1 to 1
  summary?: string;
}

export interface FilingMetadata {
  form: string;        // 10-K, 10-Q, 8-K, etc.
  filedAt: string;
  periodEnd?: string;
  url: string;
  description?: string;
}

export interface PriceBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FinancialMetrics {
  symbol: string;
  periodEnd: string;
  revenue?: number;
  netIncome?: number;
  eps?: number;
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  debtToEquity?: number;
  currentRatio?: number;
  freeCashFlow?: number;
  revenueGrowthYoY?: number;
  epsGrowthYoY?: number;
  roic?: number;
  roe?: number;
}

export interface EarningsCallData {
  symbol: string;
  quarter: string;      // e.g., "Q4 2024"
  date: string;
  transcript?: string;
  participants?: string[];
  keyTopics?: string[];
  guidanceChanges?: string[];
  managementTone?: 'positive' | 'neutral' | 'cautious' | 'negative';
}

export interface Hypothesis {
  id: string;
  title: string;
  description: string;
  thesis: string;
  symbols: string[];
  expectedReturn: number;
  timeHorizon: SignalTimeframe;
  confidence: number;
  supportingEvidence: string[];
  risks: string[];
  backtestMetrics?: {
    sharpeRatio?: number;
    maxDrawdown?: number;
    winRate?: number;
    profitFactor?: number;
  };
  status: 'proposed' | 'validating' | 'active' | 'expired' | 'rejected';
  createdAt: string;
  validatedAt?: string;
  expiresAt?: string;
}

export interface AgentCycleContext {
  cycleId: string;
  timestamp: string;
  tradingUniverse: string[];
  portfolioSnapshot: {
    cash: number;
    equity: number;
    positions: Map<string, { quantity: number; averageCost: number; currentPrice: number }>;
  };
  riskStatus: {
    canTrade: boolean;
    circuitBreaker: string;
    currentDrawdown: number;
  };
  marketRegime?: 'risk-on' | 'risk-off' | 'neutral';
}

export interface ResearchAgentConfig {
  agentId: string;
  role: AgentRole;
  model: string;
  maxTokens: number;
  systemPrompt?: string;
  focusSymbols?: string[];      // Subset of universe to focus on
  signalThreshold?: number;     // Min confidence to emit signal
  maxSignalsPerCycle?: number;
}

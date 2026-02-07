/**
 * Enhanced Decision Journal Types
 *
 * Cognitive bias tracking, market conditions, and decision outcome annotation.
 */

export type CognitiveBias =
  | "loss_aversion"
  | "anchoring"
  | "recency_bias"
  | "herding"
  | "overconfidence"
  | "disposition_effect"
  | "confirmation_bias"
  | "sunk_cost_fallacy"
  | "gambler_fallacy"
  | "availability_bias"
  | "status_quo_bias"
  | "framing_effect";

export interface MarketConditions {
  regime: string;
  vixLevel?: number;
  sectorMomentum?: string;
  keyDrivers: string[];
}

export interface EnhancedAnalysisEntry {
  symbol: string;
  action: "buy" | "sell" | "hold";
  reasoning: string;
  confidence: number;
  priceAtAnalysis: number;
  indicators?: Record<string, number>;
  biasAvoided: CognitiveBias[];
  biasExplanation: string;
  marketConditions: MarketConditions;
  counterfactual: string;
  decisionId: string;
  outcome?: DecisionOutcome;
}

export interface DecisionOutcome {
  closedAt: string;
  closePrice: number;
  pnl: number;
  pnlPercent: number;
  holdingPeriodDays: number;
  biasAvoidanceValue?: string;
  annotatedAt: string;
}

// Bias reporting types

export interface BiasBaseRate {
  bias: CognitiveBias;
  humanFallRate: number;
  source: string;
}

export interface BiasStatistic {
  bias: CognitiveBias;
  timesAvoided: number;
  totalDecisions: number;
  avoidanceRate: number;
  humanBaseRate: number;
  avgPnlWhenAvoided: number;
  avgPnlWhenNotAvoided: number;
}

export interface BiasReport {
  totalDecisions: number;
  decisionsWithOutcome: number;
  biasStatistics: BiasStatistic[];
  overallAvoidanceRate: number;
  summary: string;
}

export type DecisionPatternType =
  | "sold_into_rally"
  | "bought_the_dip"
  | "high_confidence_correct"
  | "high_confidence_wrong"
  | "bias_saved_money"
  | "held_during_drawdown";

export interface DecisionPatternMatch {
  decisionId: string;
  timestamp: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  patternType: DecisionPatternType;
  confidence: number;
  pnl?: number;
  explanation: string;
}

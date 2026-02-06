/**
 * Strategy Evolution DSL Types
 *
 * Defines the JSON-based strategy specification that agents can propose,
 * the system can compile, backtest, score, mutate, and deploy.
 */

export type IndicatorType = "SMA" | "EMA" | "RSI" | "MACD" | "ATR" | "BOLLINGER";

export type ComparisonOp = "gt" | "lt" | "gte" | "lte" | "crosses_above" | "crosses_below";

export interface IndicatorRef {
  type: IndicatorType;
  period?: number;
  /** For MACD: "line" | "signal" | "histogram". For Bollinger: "upper" | "middle" | "lower" */
  component?: string;
}

export interface ConditionNode {
  kind: "comparison";
  left: IndicatorRef | { type: "price" } | { type: "literal"; value: number };
  op: ComparisonOp;
  right: IndicatorRef | { type: "price" } | { type: "literal"; value: number };
}

export interface LogicNode {
  kind: "and" | "or";
  conditions: (ConditionNode | LogicNode)[];
}

export type EntryRule = ConditionNode | LogicNode;

export interface ExitRules {
  stopLossPercent?: number; // e.g. 0.05 = 5% stop
  takeProfitPercent?: number; // e.g. 0.10 = 10% take profit
  trailingStopPercent?: number; // e.g. 0.03 = 3% trailing stop
  timeStopDays?: number; // Max days to hold
}

export interface PositionSizing {
  method: "fixed_percent" | "conviction_scaled";
  basePercent: number; // e.g. 0.05 = 5% of equity
  maxPercent: number; // e.g. 0.10 = 10% cap
}

export interface StrategySpec {
  name: string;
  description: string;
  entryLong: EntryRule;
  entryShort?: EntryRule; // Optional, only if shorts allowed
  exitRules: ExitRules;
  positionSizing: PositionSizing;
}

export type MutationType =
  | "adjust_period"
  | "adjust_threshold"
  | "swap_indicator"
  | "adjust_exit"
  | "adjust_sizing"
  | "combine_strategies";

export interface StrategyRecord {
  id: string;
  spec: StrategySpec;
  parentIds: string[];
  generation: number;
  mutations: MutationType[];
  score?: StrategyScore;
  backtestResult?: StrategyBacktestSummary;
  status: "proposed" | "backtested" | "deployed" | "retired";
  createdAt: string;
  deployedAt?: string;
  retiredAt?: string;
}

export interface StrategyScore {
  composite: number; // 0-1 weighted fitness
  sharpe: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
}

export interface StrategyBacktestSummary {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  tradingDays: number;
}

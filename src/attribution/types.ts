/**
 * Attribution Types
 *
 * Track which agents/signals drive returns and auto-tune weights.
 */

export interface TradeAttribution {
  tradeId: string;
  symbol: string;
  side: "buy" | "sell";
  pnl: number;
  signals: SignalContribution[];
  timestamp: string;
}

export interface SignalContribution {
  signalId: string;
  agentRole: string;
  signal: string;          // "BUY" | "SELL" etc.
  confidence: number;
  weight: number;          // Weight at time of trade
  attributedPnl: number;   // Share of P&L attributed to this signal
}

export interface AgentPerformance {
  agentRole: string;
  totalSignals: number;
  accurateSignals: number;
  accuracy: number;        // 0-1
  totalAttributedPnl: number;
  averageConfidence: number;
  currentWeight: number;
  suggestedWeight: number;
  lastUpdated: string;
}

export interface WeightAdjustment {
  agentRole: string;
  previousWeight: number;
  newWeight: number;
  reason: string;
  timestamp: string;
}

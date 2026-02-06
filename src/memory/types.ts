/**
 * Cross-Cycle Memory Types
 *
 * Persistent memory entries that accumulate market insights across cycles.
 */

export interface MemoryEntry {
  id: string;
  type: "insight" | "strategy_learning" | "trade_lesson" | "market_observation" | "regime_change";
  content: string;
  symbols: string[];
  tags: string[];
  confidence: number;      // 0-1
  source: string;           // "agent" | agent role | "system"
  createdAt: string;        // ISO timestamp
  expiresAt?: string;       // ISO timestamp, optional TTL
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  symbols?: string[];
  tags?: string[];
  types?: MemoryEntry["type"][];
  topic?: string;           // Free-text search in content
  minConfidence?: number;
  maxAge?: number;           // Days
  limit?: number;
}

export interface MemoryQueryResult {
  entry: MemoryEntry;
  relevanceScore: number;
}

export interface StrategyPerformanceRecord {
  strategyId: string;
  strategyName: string;
  symbol: string;
  entryDate: string;
  exitDate?: string;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  signals: string[];        // Signal IDs that contributed
}

export interface SignalAccuracyRecord {
  signalId: string;
  agentRole: string;
  symbol: string;
  signal: string;           // "BUY" | "SELL" | etc.
  confidence: number;
  timestamp: string;
  outcomePrice?: number;
  outcomePnl?: number;
  accurate?: boolean;       // Was the signal correct?
  resolvedAt?: string;
}

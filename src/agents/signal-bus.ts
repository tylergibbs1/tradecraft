/**
 * Signal Bus - Inter-Agent Communication
 *
 * Provides a pub/sub mechanism for agents to share trading signals
 * and a consensus aggregation system for the Portfolio Manager.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type AgentRole,
  type AgentSignal,
  type AgentWeights,
  type ConsensusResult,
  DEFAULT_AGENT_WEIGHTS,
  type SignalStrength,
} from "./types.js";

export interface SignalFilter {
  symbols?: string[];
  roles?: AgentRole[];
  minConfidence?: number;
  maxAge?: number; // Max age in milliseconds
}

export interface SignalSubscription {
  id: string;
  agentId: string;
  filter?: SignalFilter;
  callback: (signal: AgentSignal) => void;
}

/**
 * Convert signal strength to numeric value for aggregation
 */
function signalToNumber(signal: SignalStrength): number {
  const values: Record<SignalStrength, number> = {
    STRONG_BUY: 2,
    BUY: 1,
    HOLD: 0,
    SELL: -1,
    STRONG_SELL: -2,
  };
  return values[signal];
}

/**
 * Convert numeric value back to signal strength
 */
function numberToSignal(value: number): SignalStrength {
  if (value >= 1.5) return "STRONG_BUY";
  if (value >= 0.5) return "BUY";
  if (value <= -1.5) return "STRONG_SELL";
  if (value <= -0.5) return "SELL";
  return "HOLD";
}

export class SignalBus {
  private signals: Map<string, AgentSignal[]> = new Map(); // symbol -> signals
  private allSignals: AgentSignal[] = [];
  private subscriptions: Map<string, SignalSubscription> = new Map();
  private weights: AgentWeights;
  private maxSignalAge: number; // Max age before signal considered stale (ms)

  constructor(
    weights: AgentWeights = DEFAULT_AGENT_WEIGHTS,
    maxSignalAge: number = 24 * 60 * 60 * 1000, // 24 hours default
  ) {
    this.weights = weights;
    this.maxSignalAge = maxSignalAge;
  }

  /**
   * Publish a signal to the bus
   */
  publish(signal: Omit<AgentSignal, "id" | "timestamp">): AgentSignal {
    const fullSignal: AgentSignal = {
      ...signal,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    // Store by symbol
    const symbolSignals = this.signals.get(signal.symbol) || [];
    symbolSignals.push(fullSignal);
    this.signals.set(signal.symbol, symbolSignals);

    // Store in all signals
    this.allSignals.push(fullSignal);

    // Notify subscribers
    this.notifySubscribers(fullSignal);

    return fullSignal;
  }

  /**
   * Subscribe to signals
   */
  subscribe(agentId: string, callback: (signal: AgentSignal) => void, filter?: SignalFilter): string {
    const subscription: SignalSubscription = {
      id: uuidv4(),
      agentId,
      filter,
      callback,
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription.id;
  }

  /**
   * Unsubscribe from signals
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get signals for a symbol
   */
  getSignals(symbol: string, filter?: SignalFilter): AgentSignal[] {
    const signals = this.signals.get(symbol) || [];
    return this.filterSignals(signals, filter);
  }

  /**
   * Get all recent signals
   */
  getAllSignals(filter?: SignalFilter): AgentSignal[] {
    return this.filterSignals(this.allSignals, filter);
  }

  /**
   * Get consensus for a symbol by aggregating all signals
   */
  getConsensus(symbol: string, customWeights?: Partial<AgentWeights>): ConsensusResult {
    const weights = { ...this.weights, ...customWeights };
    const _now = Date.now();

    // Get fresh signals for this symbol
    const signals = this.getSignals(symbol, {
      maxAge: this.maxSignalAge,
    });

    if (signals.length === 0) {
      return {
        symbol,
        weightedScore: 0,
        signalCount: 0,
        averageConfidence: 0,
        recommendation: "HOLD",
        positionSizeMultiplier: 0,
        signals: [],
        timestamp: new Date().toISOString(),
      };
    }

    // Calculate weighted score
    let totalWeight = 0;
    let weightedSum = 0;
    let confidenceSum = 0;
    const dissent: string[] = [];

    for (const signal of signals) {
      const role = signal.agentRole;
      if (role === "portfolio-manager") continue; // PM doesn't vote

      const weight = weights[role as keyof AgentWeights] || 0.1;
      const numericSignal = signalToNumber(signal.signal);
      const adjustedWeight = weight * signal.confidence;

      weightedSum += numericSignal * adjustedWeight;
      totalWeight += adjustedWeight;
      confidenceSum += signal.confidence;
    }

    const weightedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const averageConfidence = signals.length > 0 ? confidenceSum / signals.length : 0;
    const recommendation = numberToSignal(weightedScore);

    // Find dissenting signals (opposite of consensus)
    const consensusDirection = weightedScore > 0 ? 1 : weightedScore < 0 ? -1 : 0;
    for (const signal of signals) {
      const signalDirection = signalToNumber(signal.signal) > 0 ? 1 : signalToNumber(signal.signal) < 0 ? -1 : 0;
      if (signalDirection !== 0 && signalDirection !== consensusDirection) {
        dissent.push(`${signal.agentRole}: ${signal.signal} (${signal.reasoning.slice(0, 100)})`);
      }
    }

    // Position size multiplier based on consensus strength and confidence
    // Strong consensus with high confidence = larger position
    const consensusStrength = Math.abs(weightedScore) / 2; // 0-1 scale
    const positionSizeMultiplier = Math.min(1, consensusStrength * averageConfidence);

    return {
      symbol,
      weightedScore,
      signalCount: signals.length,
      averageConfidence,
      recommendation,
      positionSizeMultiplier,
      signals,
      dissent: dissent.length > 0 ? dissent : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get consensus for all symbols with recent signals
   */
  getAllConsensus(customWeights?: Partial<AgentWeights>): Map<string, ConsensusResult> {
    const results = new Map<string, ConsensusResult>();

    for (const symbol of this.signals.keys()) {
      results.set(symbol, this.getConsensus(symbol, customWeights));
    }

    return results;
  }

  /**
   * Get top recommendations (sorted by weighted score)
   */
  getTopRecommendations(limit: number = 10, direction: "buy" | "sell" | "both" = "both"): ConsensusResult[] {
    const allConsensus = Array.from(this.getAllConsensus().values());

    let filtered = allConsensus;
    if (direction === "buy") {
      filtered = allConsensus.filter((c) => c.weightedScore > 0);
    } else if (direction === "sell") {
      filtered = allConsensus.filter((c) => c.weightedScore < 0);
    }

    return filtered
      .sort((a, b) => {
        if (direction === "sell") {
          return a.weightedScore - b.weightedScore; // Most negative first
        }
        return b.weightedScore - a.weightedScore; // Most positive first
      })
      .slice(0, limit);
  }

  /**
   * Prune stale signals
   */
  pruneStale(maxAge?: number): number {
    const _cutoff = Date.now() - (maxAge || this.maxSignalAge);
    let pruned = 0;

    // Prune from symbol map
    for (const [symbol, signals] of this.signals.entries()) {
      const fresh = signals.filter((s) => {
        const age = Date.now() - new Date(s.timestamp).getTime();
        if (age > (maxAge || this.maxSignalAge)) {
          pruned++;
          return false;
        }
        return true;
      });
      this.signals.set(symbol, fresh);
    }

    // Prune from allSignals
    this.allSignals = this.allSignals.filter((s) => {
      const age = Date.now() - new Date(s.timestamp).getTime();
      return age <= (maxAge || this.maxSignalAge);
    });

    return pruned;
  }

  /**
   * Clear all signals (for testing or reset)
   */
  clear(): void {
    this.signals.clear();
    this.allSignals = [];
  }

  /**
   * Update weights
   */
  setWeights(weights: Partial<AgentWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /**
   * Get current weights
   */
  getWeights(): AgentWeights {
    return { ...this.weights };
  }

  /**
   * Get signal count by agent role
   */
  getSignalCountByRole(): Map<AgentRole, number> {
    const counts = new Map<AgentRole, number>();

    for (const signal of this.allSignals) {
      const current = counts.get(signal.agentRole) || 0;
      counts.set(signal.agentRole, current + 1);
    }

    return counts;
  }

  private filterSignals(signals: AgentSignal[], filter?: SignalFilter): AgentSignal[] {
    if (!filter) return signals;

    const now = Date.now();

    return signals.filter((signal) => {
      if (filter.symbols && !filter.symbols.includes(signal.symbol)) {
        return false;
      }

      if (filter.roles && !filter.roles.includes(signal.agentRole)) {
        return false;
      }

      if (filter.minConfidence && signal.confidence < filter.minConfidence) {
        return false;
      }

      if (filter.maxAge) {
        const signalTime = new Date(signal.timestamp).getTime();
        if (now - signalTime > filter.maxAge) {
          return false;
        }
      }

      return true;
    });
  }

  private notifySubscribers(signal: AgentSignal): void {
    for (const subscription of this.subscriptions.values()) {
      // Don't notify the agent that published the signal
      if (subscription.agentId === signal.agentId) continue;

      // Check filter
      if (subscription.filter) {
        const matches = this.filterSignals([signal], subscription.filter);
        if (matches.length === 0) continue;
      }

      try {
        subscription.callback(signal);
      } catch (error) {
        console.error(`Error notifying subscriber ${subscription.id}:`, error);
      }
    }
  }
}

// Singleton instance for shared state across agents
let sharedBus: SignalBus | null = null;

export function getSharedSignalBus(): SignalBus {
  if (!sharedBus) {
    sharedBus = new SignalBus();
  }
  return sharedBus;
}

export function resetSharedSignalBus(): void {
  sharedBus = null;
}

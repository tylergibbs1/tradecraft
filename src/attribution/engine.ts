/**
 * Attribution Engine
 *
 * Distributes P&L across contributing signals, tracks rolling accuracy,
 * and smoothly adjusts agent weights (70/30 blend, clamped to [0.05, 0.40]).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentPerformance, SignalContribution, TradeAttribution, WeightAdjustment } from "./types.js";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_ATTRIBUTION_FILE = path.join(DEFAULT_DATA_DIR, "attribution.json");

const SMOOTHING_FACTOR = 0.3; // 30% new, 70% old weight
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.4;

interface PersistentState {
  attributions: TradeAttribution[];
  performances: Record<string, AgentPerformance>;
  adjustmentHistory: WeightAdjustment[];
}

export class AttributionEngine {
  private state: PersistentState;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_ATTRIBUTION_FILE;
    this.ensureDir();
    this.state = this.load();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): PersistentState {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      /* ignore */
    }
    return { attributions: [], performances: {}, adjustmentHistory: [] };
  }

  private save(): void {
    this.ensureDir();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Record a trade attribution: distribute P&L across contributing signals
   */
  recordAttribution(
    tradeId: string,
    symbol: string,
    side: "buy" | "sell",
    pnl: number,
    contributingSignals: Array<{
      signalId: string;
      agentRole: string;
      signal: string;
      confidence: number;
      weight: number;
    }>,
  ): TradeAttribution {
    // Distribute P&L proportional to confidence * weight
    const totalContribution = contributingSignals.reduce((sum, s) => sum + s.confidence * s.weight, 0);

    const signals: SignalContribution[] = contributingSignals.map((s) => ({
      signalId: s.signalId,
      agentRole: s.agentRole,
      signal: s.signal,
      confidence: s.confidence,
      weight: s.weight,
      attributedPnl: totalContribution > 0 ? (pnl * (s.confidence * s.weight)) / totalContribution : 0,
    }));

    const attribution: TradeAttribution = {
      tradeId,
      symbol,
      side,
      pnl,
      signals,
      timestamp: new Date().toISOString(),
    };

    this.state.attributions.push(attribution);

    // Update agent performance
    for (const sig of signals) {
      this.updatePerformance(sig, pnl > 0);
    }

    // Keep last 500 attributions
    if (this.state.attributions.length > 500) {
      this.state.attributions = this.state.attributions.slice(-500);
    }

    this.save();
    return attribution;
  }

  private updatePerformance(signal: SignalContribution, profitable: boolean): void {
    const role = signal.agentRole;
    let perf = this.state.performances[role];

    if (!perf) {
      perf = {
        agentRole: role,
        totalSignals: 0,
        accurateSignals: 0,
        accuracy: 0,
        totalAttributedPnl: 0,
        averageConfidence: 0,
        currentWeight: signal.weight,
        suggestedWeight: signal.weight,
        lastUpdated: new Date().toISOString(),
      };
      this.state.performances[role] = perf;
    }

    perf.totalSignals++;
    if (profitable) perf.accurateSignals++;
    perf.accuracy = perf.totalSignals > 0 ? perf.accurateSignals / perf.totalSignals : 0;
    perf.totalAttributedPnl += signal.attributedPnl;
    perf.averageConfidence = (perf.averageConfidence * (perf.totalSignals - 1) + signal.confidence) / perf.totalSignals;
    perf.lastUpdated = new Date().toISOString();
  }

  /**
   * Calculate suggested weight adjustments based on performance
   */
  calculateWeightAdjustments(currentWeights: Record<string, number>): WeightAdjustment[] {
    const adjustments: WeightAdjustment[] = [];

    for (const [role, perf] of Object.entries(this.state.performances)) {
      if (perf.totalSignals < 5) continue; // Need enough data

      const currentWeight = currentWeights[role] ?? 0.1;

      // Performance-based target: accuracy * normalized PnL contribution
      const pnlSignal = perf.totalAttributedPnl > 0 ? 1.2 : 0.8;
      const accuracySignal = perf.accuracy > 0.5 ? 1 + (perf.accuracy - 0.5) : 1 - (0.5 - perf.accuracy);
      const targetWeight = currentWeight * pnlSignal * accuracySignal;

      // Smooth blend: 70% old + 30% new
      const newWeight = currentWeight * (1 - SMOOTHING_FACTOR) + targetWeight * SMOOTHING_FACTOR;
      const clampedWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, newWeight));

      if (Math.abs(clampedWeight - currentWeight) > 0.005) {
        adjustments.push({
          agentRole: role,
          previousWeight: currentWeight,
          newWeight: clampedWeight,
          reason: `accuracy: ${(perf.accuracy * 100).toFixed(0)}%, P&L contribution: $${perf.totalAttributedPnl.toFixed(2)}`,
          timestamp: new Date().toISOString(),
        });

        perf.suggestedWeight = clampedWeight;
      }
    }

    // Normalize weights to sum to ~1.0
    if (adjustments.length > 0) {
      const totalNewWeight = Object.entries(currentWeights).reduce((sum, [role]) => {
        const adj = adjustments.find((a) => a.agentRole === role);
        return sum + (adj ? adj.newWeight : (currentWeights[role] ?? 0));
      }, 0);

      if (totalNewWeight > 0) {
        for (const adj of adjustments) {
          adj.newWeight = adj.newWeight / totalNewWeight;
          adj.newWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, adj.newWeight));
        }
      }

      this.state.adjustmentHistory.push(...adjustments);
      if (this.state.adjustmentHistory.length > 200) {
        this.state.adjustmentHistory = this.state.adjustmentHistory.slice(-200);
      }
      this.save();
    }

    return adjustments;
  }

  /**
   * Get performance summary for all agents
   */
  getPerformance(): AgentPerformance[] {
    return Object.values(this.state.performances);
  }

  /**
   * Get recent attributions
   */
  getRecentAttributions(limit: number = 20): TradeAttribution[] {
    return this.state.attributions.slice(-limit);
  }

  /**
   * Get weight adjustment history
   */
  getAdjustmentHistory(limit: number = 20): WeightAdjustment[] {
    return this.state.adjustmentHistory.slice(-limit);
  }
}

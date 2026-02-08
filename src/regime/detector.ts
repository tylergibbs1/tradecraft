/**
 * Regime Detector
 *
 * Deterministic market regime classification using existing indicators.
 * Follows MemoryStore pattern: JSON persistence to data/regime_history.json,
 * optional filePath for test isolation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { computeATR, computeRSI, computeSMA } from "../backtest/indicators.js";
import type { OHLCV } from "../data/types.js";
import type {
  AdaptationComparison,
  MarketRegime,
  PublishedAdaptationSpeed,
  RegimeChange,
  RegimeHistory,
  RegimeSnapshot,
} from "./types.js";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_REGIME_FILE = path.join(DEFAULT_DATA_DIR, "regime_history.json");
const MAX_CONTEXT_LENGTH = 500;

/**
 * Published adaptation speeds from academic literature.
 * Measured in trading cycles (days) to reposition after regime changes.
 */
export const PUBLISHED_ADAPTATION_SPEEDS: PublishedAdaptationSpeed[] = [
  {
    managerType: "Active Mutual Funds",
    minCycles: 60,
    maxCycles: 90,
    source: "Busse, Goyal & Wahal 2010",
  },
  {
    managerType: "Hedge Funds",
    minCycles: 20,
    maxCycles: 40,
    source: "Ben-David, Franzoni & Moussawi 2012",
  },
  {
    managerType: "CTAs / Trend Followers",
    minCycles: 5,
    maxCycles: 15,
    source: "Hurst, Ooi & Pedersen 2017",
  },
];

export class RegimeDetector {
  private history: RegimeHistory;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_REGIME_FILE;
    this.history = this.load();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): RegimeHistory {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      // Invalid file
    }
    return { current: {}, changes: [], lastUpdated: new Date().toISOString() };
  }

  private save(): void {
    this.ensureDir();
    this.history.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.filePath, JSON.stringify(this.history, null, 2));
  }

  /**
   * Classify the current market regime for a symbol based on OHLCV bars.
   *
   * Rules (priority order):
   * 1. High volatility: ATR14/price > 2.5%
   * 2. Low volatility: ATR14/price < 1%
   * 3. Mean reverting: RSI std dev < 8 AND RSI mean in 40-60
   * 4. Trending: |SMA20 - SMA50| / SMA50 > 1%
   * 5. Bull/bear trend: SMA20 vs SMA50 direction
   */
  classifyRegime(symbol: string, bars: OHLCV[]): RegimeSnapshot {
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);

    // Compute indicators
    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, 50);
    const atr14 = computeATR(highs, lows, closes, 14);
    const rsi14 = computeRSI(closes, 14);

    const lastIdx = closes.length - 1;
    const currentPrice = closes[lastIdx]!;
    const currentSma20 = sma20[lastIdx] ?? currentPrice;
    const currentSma50 = sma50[lastIdx] ?? currentPrice;
    const currentAtr = atr14[lastIdx] ?? 0;

    // ATR as percentage of price
    const atrPercent = currentPrice > 0 ? currentAtr / currentPrice : 0;

    // Trend strength: how far SMA20 is from SMA50
    const trendStrength = currentSma50 > 0 ? (currentSma20 - currentSma50) / currentSma50 : 0;

    // RSI statistics (last 20 bars)
    const recentRsi = rsi14.slice(-20).filter((v) => !Number.isNaN(v));
    const rsiMean = recentRsi.length > 0 ? recentRsi.reduce((a, b) => a + b, 0) / recentRsi.length : 50;
    const rsiVariance =
      recentRsi.length > 0 ? recentRsi.reduce((sum, v) => sum + (v - rsiMean) ** 2, 0) / recentRsi.length : 100;
    const rsiStdDev = Math.sqrt(rsiVariance);

    // Classify regime (priority order)
    let regime: MarketRegime;
    let confidence: number;

    if (atrPercent > 0.025) {
      regime = "high_volatility";
      confidence = Math.min(1, atrPercent / 0.04);
    } else if (atrPercent < 0.01) {
      regime = "low_volatility";
      confidence = Math.min(1, (0.01 - atrPercent) / 0.01);
    } else if (rsiStdDev < 8 && rsiMean >= 40 && rsiMean <= 60) {
      regime = "mean_reverting";
      confidence = Math.min(1, (8 - rsiStdDev) / 8);
    } else if (Math.abs(trendStrength) > 0.01) {
      if (trendStrength > 0.03) {
        regime = "bull_trend";
        confidence = Math.min(1, trendStrength / 0.06);
      } else if (trendStrength < -0.03) {
        regime = "bear_trend";
        confidence = Math.min(1, Math.abs(trendStrength) / 0.06);
      } else {
        regime = "trending";
        confidence = Math.min(1, Math.abs(trendStrength) / 0.03);
      }
    } else if (trendStrength > 0) {
      regime = "bull_trend";
      confidence = 0.4;
    } else {
      regime = "bear_trend";
      confidence = 0.4;
    }

    return {
      symbol,
      regime,
      confidence,
      indicators: {
        sma20: currentSma20,
        sma50: currentSma50,
        trendStrength,
        atrPercent,
        rsiStdDev,
        rsiMean,
      },
      classifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Update the regime for a symbol: classify, detect transitions, persist.
   */
  update(symbol: string, bars: OHLCV[]): RegimeSnapshot {
    const snapshot = this.classifyRegime(symbol, bars);
    const previous = this.history.current[symbol];

    // Detect regime change
    if (previous && previous.regime !== snapshot.regime) {
      const change: RegimeChange = {
        id: crypto.randomUUID(),
        symbol,
        fromRegime: previous.regime,
        toRegime: snapshot.regime,
        changedAt: new Date().toISOString(),
        adaptationCycles: null,
      };
      this.history.changes.push(change);
    }

    this.history.current[symbol] = snapshot;
    this.save();
    return snapshot;
  }

  /**
   * Build a formatted regime context string for prompt injection.
   * Kept under MAX_CONTEXT_LENGTH chars.
   */
  buildRegimeContext(symbols: string[]): string {
    const lines: string[] = [];
    for (const sym of symbols) {
      const snap = this.history.current[sym];
      if (snap) {
        lines.push(
          `${sym}: ${snap.regime} (conf: ${snap.confidence.toFixed(2)}, trend: ${(snap.indicators.trendStrength * 100).toFixed(1)}%, vol: ${(snap.indicators.atrPercent * 100).toFixed(1)}%)`,
        );
      }
    }

    if (lines.length === 0) return "";

    let ctx = `Market regimes:\n${lines.join("\n")}`;
    if (ctx.length > MAX_CONTEXT_LENGTH) {
      ctx = `${ctx.slice(0, MAX_CONTEXT_LENGTH - 3)}...`;
    }
    return ctx;
  }

  /**
   * Record that the agent adapted to a regime change.
   */
  recordAdaptation(regimeChangeId: string, cycleNumber: number): boolean {
    const change = this.history.changes.find((c) => c.id === regimeChangeId);
    if (!change) return false;
    change.adaptationCycles = cycleNumber;
    this.save();
    return true;
  }

  /**
   * Get adaptation metrics: how quickly the agent adapts to regime changes.
   * Includes comparison to published academic data on manager adaptation speeds.
   */
  getAdaptationMetrics(): {
    totalChanges: number;
    adaptedChanges: number;
    averageAdaptationCycles: number;
    recentChanges: RegimeChange[];
    comparisonToResearch: AdaptationComparison | null;
  } {
    const adapted = this.history.changes.filter((c) => c.adaptationCycles !== null);
    const avgCycles =
      adapted.length > 0 ? adapted.reduce((sum, c) => sum + (c.adaptationCycles ?? 0), 0) / adapted.length : 0;

    let comparisonToResearch: AdaptationComparison | null = null;

    if (adapted.length > 0) {
      const comparisons = PUBLISHED_ADAPTATION_SPEEDS.map((pub) => ({
        managerType: pub.managerType,
        publishedMinCycles: pub.minCycles,
        publishedMaxCycles: pub.maxCycles,
        speedupVsMin: avgCycles > 0 ? pub.minCycles / avgCycles : 0,
        speedupVsMax: avgCycles > 0 ? pub.maxCycles / avgCycles : 0,
        source: pub.source,
      }));

      const summaryParts = [`Agent adapts in avg ${avgCycles.toFixed(1)} cycles.`];
      for (const c of comparisons) {
        summaryParts.push(
          `${c.speedupVsMin.toFixed(1)}-${c.speedupVsMax.toFixed(1)}x faster than ${c.managerType} (${c.publishedMinCycles}-${c.publishedMaxCycles} cycles, ${c.source}).`,
        );
      }

      comparisonToResearch = {
        agentAvgCycles: avgCycles,
        comparisons,
        summary: summaryParts.join(" "),
      };
    }

    return {
      totalChanges: this.history.changes.length,
      adaptedChanges: adapted.length,
      averageAdaptationCycles: avgCycles,
      recentChanges: this.history.changes.slice(-10),
      comparisonToResearch,
    };
  }

  /**
   * Get current regime for a symbol (from cache, no recomputation).
   */
  getCurrent(symbol: string): RegimeSnapshot | null {
    return this.history.current[symbol] ?? null;
  }

  /**
   * Get all data (for testing).
   */
  getHistory(): RegimeHistory {
    return { ...this.history };
  }
}

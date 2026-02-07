/**
 * Market Regime Detection Types
 */

export type MarketRegime =
  | "bull_trend"
  | "bear_trend"
  | "high_volatility"
  | "low_volatility"
  | "mean_reverting"
  | "trending";

export interface RegimeSnapshot {
  symbol: string;
  regime: MarketRegime;
  confidence: number;
  indicators: {
    sma20: number;
    sma50: number;
    trendStrength: number;
    atrPercent: number;
    rsiStdDev: number;
    rsiMean: number;
  };
  classifiedAt: string;
}

export interface RegimeChange {
  id: string;
  symbol: string;
  fromRegime: MarketRegime;
  toRegime: MarketRegime;
  changedAt: string;
  adaptationCycles: number | null;
}

export interface RegimeHistory {
  current: Record<string, RegimeSnapshot>;
  changes: RegimeChange[];
  lastUpdated: string;
}

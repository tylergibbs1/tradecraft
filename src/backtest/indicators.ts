import type { OHLCV } from "../data/types.js";

export interface IndicatorResult {
  sma20?: number[];
  sma50?: number[];
  ema12?: number[];
  ema26?: number[];
  rsi14?: number[];
  macd?: {
    macdLine: number[];
    signalLine: number[];
    histogram: number[];
  };
  dates: string[];
  closes: number[];
}

export function computeSMA(closes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += closes[j]!;
      }
      result.push(sum / period);
    }
  }
  return result;
}

export function computeEMA(closes: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      // Seed with SMA
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += closes[j]!;
      }
      result.push(sum / period);
    } else {
      const prev = result[i - 1]!;
      result.push((closes[i]! - prev) * multiplier + prev);
    }
  }
  return result;
}

export function computeRSI(closes: number[], period: number = 14): number[] {
  const result: number[] = [];

  if (closes.length < period + 1) {
    return closes.map(() => NaN);
  }

  // Calculate initial average gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill NaN for insufficient data
  for (let i = 0; i < period; i++) {
    result.push(NaN);
  }

  // First RSI value
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  // Subsequent values using smoothed averages
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rsVal = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rsVal));
  }

  return result;
}

export function computeMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const ema12 = computeEMA(closes, fastPeriod);
  const ema26 = computeEMA(closes, slowPeriod);

  // MACD line = EMA12 - EMA26
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(ema12[i]!) || Number.isNaN(ema26[i]!)) {
      macdLine.push(NaN);
    } else {
      macdLine.push(ema12[i]! - ema26[i]!);
    }
  }

  // Signal line = 9-period EMA of MACD line
  // Find first valid MACD value
  const validMacd = macdLine.filter((v) => !Number.isNaN(v));
  const signalEma = computeEMA(validMacd, signalPeriod);

  const signalLine: number[] = [];
  let validIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (Number.isNaN(macdLine[i]!)) {
      signalLine.push(NaN);
    } else {
      signalLine.push(signalEma[validIdx]!);
      validIdx++;
    }
  }

  // Histogram = MACD - Signal
  const histogram: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (Number.isNaN(macdLine[i]!) || Number.isNaN(signalLine[i]!)) {
      histogram.push(NaN);
    } else {
      histogram.push(macdLine[i]! - signalLine[i]!);
    }
  }

  return { macdLine, signalLine, histogram };
}

export function computeATR(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (highs.length < 2) return highs.map(() => NaN);

  // True Range calculation
  const trueRanges: number[] = [highs[0]! - lows[0]!]; // First TR is just high - low
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    );
    trueRanges.push(tr);
  }

  // ATR using smoothed average
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += trueRanges[j]!;
      result.push(sum / period);
    } else {
      const prev = result[i - 1]!;
      result.push((prev * (period - 1) + trueRanges[i]!) / period);
    }
  }
  return result;
}

export function computeBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = computeSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      // Calculate standard deviation for the window
      const window = closes.slice(i - period + 1, i + 1);
      const mean = middle[i]!;
      const variance = window.reduce((sum, val) => sum + (val - mean) ** 2, 0) / period;
      const stdDev = Math.sqrt(variance);
      upper.push(mean + stdDevMultiplier * stdDev);
      lower.push(mean - stdDevMultiplier * stdDev);
    }
  }

  return { upper, middle, lower };
}

export function computeAllIndicators(bars: OHLCV[]): IndicatorResult {
  const closes = bars.map((b) => b.close);
  const dates = bars.map((b) => new Date(b.timestamp).toISOString().split("T")[0]!);

  return {
    sma20: computeSMA(closes, 20),
    sma50: computeSMA(closes, 50),
    ema12: computeEMA(closes, 12),
    ema26: computeEMA(closes, 26),
    rsi14: computeRSI(closes, 14),
    macd: computeMACD(closes),
    dates,
    closes,
  };
}

/**
 * Returns a summary object with the latest indicator values,
 * suitable for inclusion in an LLM tool response.
 */
export function getIndicatorSummary(bars: OHLCV[]): Record<string, unknown> {
  if (bars.length < 2) {
    return { error: "Insufficient data for indicators" };
  }

  const indicators = computeAllIndicators(bars);
  const len = bars.length;
  const lastIdx = len - 1;

  const latest = (arr: number[] | undefined) =>
    arr && lastIdx < arr.length && !Number.isNaN(arr[lastIdx]!) ? Math.round(arr[lastIdx]! * 100) / 100 : null;

  const prevIdx = lastIdx - 1;
  const prev = (arr: number[] | undefined) =>
    arr && prevIdx >= 0 && prevIdx < arr.length && !Number.isNaN(arr[prevIdx]!)
      ? Math.round(arr[prevIdx]! * 100) / 100
      : null;

  const currentPrice = bars[lastIdx]!.close;
  const sma20 = latest(indicators.sma20);
  const sma50 = latest(indicators.sma50);
  const rsi = latest(indicators.rsi14);
  const macdLine = indicators.macd ? latest(indicators.macd.macdLine) : null;
  const macdSignal = indicators.macd ? latest(indicators.macd.signalLine) : null;
  const macdHist = indicators.macd ? latest(indicators.macd.histogram) : null;
  const prevMacdHist = indicators.macd ? prev(indicators.macd.histogram) : null;

  // Generate signals
  const signals: string[] = [];

  if (rsi !== null) {
    if (rsi < 30) signals.push("RSI oversold (<30) — potential buy");
    else if (rsi > 70) signals.push("RSI overbought (>70) — potential sell");
    else signals.push("RSI neutral");
  }

  if (sma20 !== null && sma50 !== null) {
    if (sma20 > sma50) signals.push("SMA20 > SMA50 — bullish trend");
    else signals.push("SMA20 < SMA50 — bearish trend");
  }

  if (currentPrice && sma50 !== null) {
    if (currentPrice > sma50) signals.push("Price above SMA50 — bullish");
    else signals.push("Price below SMA50 — bearish");
  }

  if (macdHist !== null && prevMacdHist !== null) {
    if (macdHist > 0 && prevMacdHist <= 0) signals.push("MACD histogram crossed positive — bullish");
    else if (macdHist < 0 && prevMacdHist >= 0) signals.push("MACD histogram crossed negative — bearish");
    else if (macdHist > 0) signals.push("MACD histogram positive — bullish momentum");
    else signals.push("MACD histogram negative — bearish momentum");
  }

  return {
    price: currentPrice,
    sma20,
    sma50,
    rsi14: rsi,
    macd: {
      line: macdLine,
      signal: macdSignal,
      histogram: macdHist,
    },
    signals,
  };
}

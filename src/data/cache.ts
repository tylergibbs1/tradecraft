import { Quote, OHLCV, TimeFrame } from "./types.js";

interface CachedQuote {
  quote: Quote;
  expiresAt: number;
}

interface CachedHistory {
  data: OHLCV[];
  expiresAt: number;
}

const QUOTE_TTL_MS = 60_000; // 1 minute
const HISTORY_TTL_MS = 300_000; // 5 minutes

export class DataCache {
  private quotes = new Map<string, CachedQuote>();
  private history = new Map<string, CachedHistory>();

  private historyKey(
    symbol: string,
    timeframe: TimeFrame,
    startDate: Date,
    endDate: Date
  ): string {
    return `${symbol}:${timeframe}:${startDate.toISOString()}:${endDate.toISOString()}`;
  }

  getQuote(symbol: string): Quote | undefined {
    const cached = this.quotes.get(symbol);
    if (!cached) return undefined;
    if (Date.now() > cached.expiresAt) {
      this.quotes.delete(symbol);
      return undefined;
    }
    return cached.quote;
  }

  setQuote(symbol: string, quote: Quote): void {
    this.quotes.set(symbol, {
      quote,
      expiresAt: Date.now() + QUOTE_TTL_MS,
    });
  }

  getHistory(
    symbol: string,
    timeframe: TimeFrame,
    startDate: Date,
    endDate: Date
  ): OHLCV[] | undefined {
    const key = this.historyKey(symbol, timeframe, startDate, endDate);
    const cached = this.history.get(key);
    if (!cached) return undefined;
    if (Date.now() > cached.expiresAt) {
      this.history.delete(key);
      return undefined;
    }
    return cached.data;
  }

  setHistory(
    symbol: string,
    timeframe: TimeFrame,
    startDate: Date,
    endDate: Date,
    data: OHLCV[]
  ): void {
    const key = this.historyKey(symbol, timeframe, startDate, endDate);
    this.history.set(key, {
      data,
      expiresAt: Date.now() + HISTORY_TTL_MS,
    });
  }

  clear(): void {
    this.quotes.clear();
    this.history.clear();
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, cached] of this.quotes) {
      if (now > cached.expiresAt) this.quotes.delete(key);
    }
    for (const [key, cached] of this.history) {
      if (now > cached.expiresAt) this.history.delete(key);
    }
  }
}

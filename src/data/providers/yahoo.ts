import type { DataProviderInterface, OHLCV, Quote, TimeFrame } from "../types.js";

const BASE_URL = "https://query1.finance.yahoo.com";

const TIMEFRAME_MAP: Record<TimeFrame, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "4h": "60m",
  "1d": "1d",
  "1w": "1wk",
};

export class YahooDataProvider implements DataProviderInterface {
  name = "Yahoo Finance";

  async getQuote(symbol: string): Promise<Quote> {
    const url = `${BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!resp.ok) {
      throw new Error(`Yahoo Finance quote failed for ${symbol}: ${resp.status}`);
    }

    const json = (await resp.json()) as any;
    const result = json?.chart?.result?.[0];
    if (!result) {
      throw new Error(`No quote data for ${symbol}`);
    }

    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    const lastIndex = (quote?.close?.length ?? 1) - 1;

    return {
      symbol: meta.symbol,
      last: meta.regularMarketPrice ?? quote?.close?.[lastIndex] ?? 0,
      bid: undefined,
      ask: undefined,
      volume: meta.regularMarketVolume ?? quote?.volume?.[lastIndex] ?? 0,
      timestamp: (meta.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000,
    };
  }

  async getHistory(symbol: string, timeframe: TimeFrame, startDate: Date, endDate: Date): Promise<OHLCV[]> {
    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);
    const interval = TIMEFRAME_MAP[timeframe] ?? "1d";

    const url =
      `${BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}&interval=${interval}`;

    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!resp.ok) {
      throw new Error(`Yahoo Finance history failed for ${symbol}: ${resp.status}`);
    }

    const json = (await resp.json()) as any;
    const result = json?.chart?.result?.[0];
    if (!result) {
      throw new Error(`No history data for ${symbol}`);
    }

    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};

    const bars: OHLCV[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      const volume = quote.volume?.[i];

      if (open != null && high != null && low != null && close != null) {
        bars.push({
          timestamp: timestamps[i]! * 1000,
          open,
          high,
          low,
          close,
          volume: volume ?? 0,
        });
      }
    }

    return bars;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${BASE_URL}/v8/finance/chart/AAPL?interval=1d&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

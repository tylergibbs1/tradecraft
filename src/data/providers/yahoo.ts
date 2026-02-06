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

    const json = (await resp.json()) as Record<string, unknown>;
    const chart = json?.chart as Record<string, unknown> | undefined;
    const result = (chart?.result as Record<string, unknown>[] | undefined)?.[0];
    if (!result) {
      throw new Error(`No quote data for ${symbol}`);
    }

    const meta = result.meta as Record<string, unknown>;
    const indicators = result.indicators as Record<string, unknown> | undefined;
    const quotes = indicators?.quote as Record<string, unknown>[] | undefined;
    const quote = quotes?.[0];
    const closeArr = quote?.close as number[] | undefined;
    const lastIndex = (closeArr?.length ?? 1) - 1;

    return {
      symbol: meta.symbol as string,
      last: (meta.regularMarketPrice as number) ?? closeArr?.[lastIndex] ?? 0,
      bid: undefined,
      ask: undefined,
      volume: (meta.regularMarketVolume as number) ?? (quote?.volume as number[])?.[lastIndex] ?? 0,
      timestamp: ((meta.regularMarketTime as number) ?? Math.floor(Date.now() / 1000)) * 1000,
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

    const json = (await resp.json()) as Record<string, unknown>;
    const chart = json?.chart as Record<string, unknown> | undefined;
    const result = (chart?.result as Record<string, unknown>[] | undefined)?.[0];
    if (!result) {
      throw new Error(`No history data for ${symbol}`);
    }

    const timestamps: number[] = (result.timestamp as number[]) ?? [];
    const indicators = result.indicators as Record<string, unknown> | undefined;
    const quotes = indicators?.quote as Record<string, unknown>[] | undefined;
    const quote = quotes?.[0] ?? {};
    const openArr = quote.open as number[] | undefined;
    const highArr = quote.high as number[] | undefined;
    const lowArr = quote.low as number[] | undefined;
    const closeArr = quote.close as number[] | undefined;
    const volumeArr = quote.volume as number[] | undefined;

    const bars: OHLCV[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = openArr?.[i];
      const high = highArr?.[i];
      const low = lowArr?.[i];
      const close = closeArr?.[i];
      const volume = volumeArr?.[i];

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

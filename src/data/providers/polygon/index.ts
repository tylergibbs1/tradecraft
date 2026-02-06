import type { DataProviderInterface, OHLCV, Quote, TimeFrame } from "../../types.js";

const POLYGON_BASE = "https://api.polygon.io";

export type IndicatorTimespan = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";

export type TickerType =
  | "CS"
  | "ADRC"
  | "ADRP"
  | "ADRR"
  | "ADRW"
  | "AGEN"
  | "BASKET"
  | "BOND"
  | "ETF"
  | "ETN"
  | "ETS"
  | "ETV"
  | "FUND"
  | "GDR"
  | "LT"
  | "NYRS"
  | "OS"
  | "OTHER"
  | "PFD"
  | "RIGHT"
  | "SP"
  | "UNIT"
  | "WARRANT";

// --- Helpers ---

async function polygonFetch(
  path: string,
  apiKey: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<Record<string, unknown>> {
  const url = new URL(path, POLYGON_BASE);
  url.searchParams.set("apiKey", apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Polygon API error ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

const TIMEFRAME_MAP: Record<TimeFrame, { multiplier: number; timespan: string }> = {
  "1m": { multiplier: 1, timespan: "minute" },
  "5m": { multiplier: 5, timespan: "minute" },
  "15m": { multiplier: 15, timespan: "minute" },
  "30m": { multiplier: 30, timespan: "minute" },
  "1h": { multiplier: 1, timespan: "hour" },
  "4h": { multiplier: 4, timespan: "hour" },
  "1d": { multiplier: 1, timespan: "day" },
  "1w": { multiplier: 1, timespan: "week" },
};

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

// --- Quotes Provider ---

export class PolygonQuotesProvider implements DataProviderInterface {
  name = "Polygon.io";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getQuote(symbol: string): Promise<Quote> {
    // Use snapshot endpoint (available on free tier) with previous-close fallback
    try {
      const snap = await polygonFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`, this.apiKey);
      const t = snap?.ticker;
      if (t) {
        return {
          symbol,
          last: t.lastTrade?.p ?? t.prevDay?.c ?? t.day?.c ?? 0,
          bid: t.lastQuote?.P,
          ask: t.lastQuote?.p,
          volume: t.day?.v ?? t.prevDay?.v ?? 0,
          timestamp: t.updated ? t.updated / 1_000_000 : Date.now(),
        };
      }
    } catch {
      // snapshot may not be available, fall through to prev close
    }

    // Fallback: use previous close
    const json = await polygonFetch(`/v2/aggs/ticker/${symbol}/prev`, this.apiKey);
    const bar = json.results?.[0];
    if (!bar) throw new Error(`No quote data for ${symbol}`);

    return {
      symbol,
      last: bar.c,
      bid: undefined,
      ask: undefined,
      volume: bar.v ?? 0,
      timestamp: bar.t ?? Date.now(),
    };
  }

  async getHistory(symbol: string, timeframe: TimeFrame, startDate: Date, endDate: Date): Promise<OHLCV[]> {
    const tf = TIMEFRAME_MAP[timeframe] ?? { multiplier: 1, timespan: "day" };
    const from = formatDate(startDate);
    const to = formatDate(endDate);

    const json = await polygonFetch(
      `/v2/aggs/ticker/${symbol}/range/${tf.multiplier}/${tf.timespan}/${from}/${to}`,
      this.apiKey,
      { adjusted: true, sort: "asc", limit: 50000 },
    );

    if (!json.results || json.results.length === 0) {
      return [];
    }

    return json.results.map((bar: Record<string, unknown>) => ({
      timestamp: bar.t as number,
      open: bar.o as number,
      high: bar.h as number,
      low: bar.l as number,
      close: bar.c as number,
      volume: bar.v as number,
    }));
  }

  async isAvailable(): Promise<boolean> {
    try {
      await polygonFetch("/v2/aggs/ticker/AAPL/prev", this.apiKey);
      return true;
    } catch {
      return false;
    }
  }
}

// --- News Provider ---

export interface PolygonNewsArticle {
  id: string;
  title: string;
  author: string;
  publishedUtc: string;
  articleUrl: string;
  publisher: { name: string; homepageUrl?: string; logoUrl?: string };
  tickers: string[];
  description?: string;
  keywords?: string[];
  insights: Array<{
    ticker: string;
    sentiment: string;
    sentimentReasoning: string;
  }>;
}

export interface PolygonNewsSentimentSummary {
  averageSentimentScore: number;
  sentimentBreakdown: Record<string, number>;
  articleCount: number;
}

export class PolygonNewsProvider {
  name = "Polygon News";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getNews(
    symbol: string,
    options: { limit?: number; publishedAfter?: Date } = {},
  ): Promise<PolygonNewsArticle[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      ticker: symbol.toUpperCase(),
      limit: options.limit ?? 20,
      order: "desc",
      sort: "published_utc",
    };
    if (options.publishedAfter) {
      params["published_utc.gte"] = options.publishedAfter.toISOString();
    }

    const json = await polygonFetch("/v2/reference/news", this.apiKey, params);
    return (json.results ?? []).map((a: Record<string, unknown>) => ({
      id: a.id as string,
      title: a.title as string,
      author: a.author as string,
      publishedUtc: a.published_utc as string,
      articleUrl: a.article_url as string,
      publisher: (a.publisher as Record<string, unknown>) ?? { name: "Unknown" },
      tickers: (a.tickers as string[]) ?? [],
      description: a.description as string | undefined,
      keywords: a.keywords as string[] | undefined,
      insights: ((a.insights as Record<string, unknown>[]) ?? []).map((i: Record<string, unknown>) => ({
        ticker: i.ticker as string,
        sentiment: i.sentiment as string,
        sentimentReasoning: i.sentiment_reasoning as string,
      })),
    }));
  }

  async getSentimentSummary(
    symbol: string,
    options: { limit?: number; daysBack?: number } = {},
  ): Promise<PolygonNewsSentimentSummary> {
    const daysBack = options.daysBack ?? 7;
    const publishedAfter = new Date();
    publishedAfter.setDate(publishedAfter.getDate() - daysBack);

    const articles = await this.getNews(symbol, {
      limit: options.limit ?? 50,
      publishedAfter,
    });

    const breakdown: Record<string, number> = {};
    let totalScore = 0;
    let scored = 0;

    for (const article of articles) {
      const insight = article.insights.find((i) => i.ticker.toUpperCase() === symbol.toUpperCase());
      if (insight?.sentiment) {
        breakdown[insight.sentiment] = (breakdown[insight.sentiment] ?? 0) + 1;
        const s = insight.sentiment === "positive" ? 1 : insight.sentiment === "negative" ? -1 : 0;
        totalScore += s;
        scored++;
      }
    }

    return {
      averageSentimentScore: scored > 0 ? totalScore / scored : 0,
      sentimentBreakdown: breakdown,
      articleCount: articles.length,
    };
  }
}

// --- Indicators Provider ---

export interface IndicatorValue {
  timestamp: number;
  value: number;
}

export interface MACDValue {
  timestamp: number;
  value: number;
  signal: number;
  histogram: number;
}

export interface IndicatorResult {
  ticker: string;
  window: number;
  timespan: string;
  values: IndicatorValue[];
}

export interface MACDResult {
  ticker: string;
  timespan: string;
  values: MACDValue[];
}

export class PolygonIndicatorsProvider {
  name = "Polygon Indicators";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getSMA(
    symbol: string,
    options: { window?: number; timespan?: IndicatorTimespan; limit?: number } = {},
  ): Promise<IndicatorResult> {
    const window = options.window ?? 50;
    const timespan = options.timespan ?? "day";
    const limit = options.limit ?? 100;

    const json = await polygonFetch(`/v1/indicators/sma/${symbol.toUpperCase()}`, this.apiKey, {
      timespan,
      window,
      limit,
      adjusted: true,
      order: "desc",
      series_type: "close",
    });

    return {
      ticker: symbol.toUpperCase(),
      window,
      timespan,
      values: (json.results?.values ?? []).map((v: Record<string, unknown>) => ({
        timestamp: v.timestamp as number,
        value: v.value as number,
      })),
    };
  }

  async getEMA(
    symbol: string,
    options: { window?: number; timespan?: IndicatorTimespan; limit?: number } = {},
  ): Promise<IndicatorResult> {
    const window = options.window ?? 50;
    const timespan = options.timespan ?? "day";
    const limit = options.limit ?? 100;

    const json = await polygonFetch(`/v1/indicators/ema/${symbol.toUpperCase()}`, this.apiKey, {
      timespan,
      window,
      limit,
      adjusted: true,
      order: "desc",
      series_type: "close",
    });

    return {
      ticker: symbol.toUpperCase(),
      window,
      timespan,
      values: (json.results?.values ?? []).map((v: Record<string, unknown>) => ({
        timestamp: v.timestamp as number,
        value: v.value as number,
      })),
    };
  }

  async getRSI(
    symbol: string,
    options: { window?: number; timespan?: IndicatorTimespan; limit?: number } = {},
  ): Promise<IndicatorResult> {
    const window = options.window ?? 14;
    const timespan = options.timespan ?? "day";
    const limit = options.limit ?? 100;

    const json = await polygonFetch(`/v1/indicators/rsi/${symbol.toUpperCase()}`, this.apiKey, {
      timespan,
      window,
      limit,
      adjusted: true,
      order: "desc",
      series_type: "close",
    });

    return {
      ticker: symbol.toUpperCase(),
      window,
      timespan,
      values: (json.results?.values ?? []).map((v: Record<string, unknown>) => ({
        timestamp: v.timestamp as number,
        value: v.value as number,
      })),
    };
  }

  async getMACD(
    symbol: string,
    options: {
      shortWindow?: number;
      longWindow?: number;
      signalWindow?: number;
      timespan?: IndicatorTimespan;
      limit?: number;
    } = {},
  ): Promise<MACDResult> {
    const timespan = options.timespan ?? "day";
    const limit = options.limit ?? 100;

    const json = await polygonFetch(`/v1/indicators/macd/${symbol.toUpperCase()}`, this.apiKey, {
      timespan,
      limit,
      short_window: options.shortWindow ?? 12,
      long_window: options.longWindow ?? 26,
      signal_window: options.signalWindow ?? 9,
      adjusted: true,
      order: "desc",
      series_type: "close",
    });

    return {
      ticker: symbol.toUpperCase(),
      timespan,
      values: (json.results?.values ?? []).map((v: Record<string, unknown>) => ({
        timestamp: v.timestamp as number,
        value: v.value as number,
        signal: v.signal as number,
        histogram: v.histogram as number,
      })),
    };
  }
}

// --- Tickers Provider ---

export interface TickerDetails {
  ticker: string;
  name: string;
  description?: string;
  type?: string;
  sicCode?: string;
  sicDescription?: string;
  primaryExchange?: string;
  marketCap?: number;
  weightedSharesOutstanding?: number;
  totalEmployees?: number;
  homepageUrl?: string;
  phoneNumber?: string;
  address?: {
    address1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  listDate?: string;
  active?: boolean;
  cik?: string;
  compositeFigi?: string;
}

export interface TickerSearchResult {
  ticker: string;
  name: string;
  type?: string;
  primaryExchange?: string;
  active?: boolean;
  market?: string;
}

export class PolygonTickersProvider {
  name = "Polygon Tickers";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTickerDetails(symbol: string): Promise<TickerDetails | null> {
    try {
      const json = await polygonFetch(`/v3/reference/tickers/${symbol.toUpperCase()}`, this.apiKey);
      const r = json.results;
      if (!r) return null;

      return {
        ticker: r.ticker,
        name: r.name,
        description: r.description,
        type: r.type,
        sicCode: r.sic_code,
        sicDescription: r.sic_description,
        primaryExchange: r.primary_exchange,
        marketCap: r.market_cap,
        weightedSharesOutstanding: r.weighted_shares_outstanding,
        totalEmployees: r.total_employees,
        homepageUrl: r.homepage_url,
        phoneNumber: r.phone_number,
        address: r.address
          ? {
              address1: r.address.address1,
              city: r.address.city,
              state: r.address.state,
              postalCode: r.address.postal_code,
            }
          : undefined,
        listDate: r.list_date,
        active: r.active,
        cik: r.cik,
        compositeFigi: r.composite_figi,
      };
    } catch {
      return null;
    }
  }

  async getTickerDetailsBatch(symbols: string[]): Promise<Map<string, TickerDetails>> {
    const results = new Map<string, TickerDetails>();
    const fetches = symbols.map(async (s) => {
      const d = await this.getTickerDetails(s);
      if (d) results.set(s.toUpperCase(), d);
    });
    await Promise.allSettled(fetches);
    return results;
  }

  async searchTickers(options: {
    search?: string;
    ticker?: string;
    type?: TickerType;
    market?: string;
    exchange?: string;
    active?: boolean;
    limit?: number;
    sort?: string;
    order?: string;
  }): Promise<TickerSearchResult[]> {
    const json = await polygonFetch("/v3/reference/tickers", this.apiKey, {
      search: options.search,
      ticker: options.ticker,
      type: options.type,
      market: options.market ?? "stocks",
      exchange: options.exchange,
      active: options.active,
      limit: options.limit ?? 20,
      sort: options.sort ?? "ticker",
      order: options.order ?? "asc",
    });

    return (json.results ?? []).map((r: Record<string, unknown>) => ({
      ticker: r.ticker as string,
      name: r.name as string,
      type: r.type as string | undefined,
      primaryExchange: r.primary_exchange as string | undefined,
      active: r.active as boolean | undefined,
      market: r.market as string | undefined,
    }));
  }

  async searchByName(query: string, options: { limit?: number } = {}): Promise<TickerSearchResult[]> {
    return this.searchTickers({
      search: query,
      market: "stocks",
      active: true,
      limit: options.limit ?? 20,
    });
  }
}

// --- Factory functions ---

export function getPolygonNewsProvider(apiKey: string): PolygonNewsProvider {
  return new PolygonNewsProvider(apiKey);
}

export function getPolygonIndicatorsProvider(apiKey: string): PolygonIndicatorsProvider {
  return new PolygonIndicatorsProvider(apiKey);
}

export function getPolygonTickersProvider(apiKey: string): PolygonTickersProvider {
  return new PolygonTickersProvider(apiKey);
}

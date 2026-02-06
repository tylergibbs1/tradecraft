import type { DataProvider } from "../config/schema.js";
import { DataCache } from "./cache.js";
import { PolygonQuotesProvider } from "./providers/polygon/index.js";
import { YahooDataProvider } from "./providers/yahoo.js";
import type { DataProviderInterface, OHLCV, Quote, TimeFrame } from "./types.js";

export * from "./cache.js";
export { EdgarDataProvider, getEdgarProvider } from "./providers/edgar.js";
export { ExaDataProvider, getExaProvider } from "./providers/exa.js";
export { getNewsProvider, NewsDataProvider } from "./providers/news.js";
export * from "./types.js";

export class DataManager {
  private provider: DataProviderInterface;
  private cache: DataCache;

  constructor(providerType: DataProvider, apiKey?: string) {
    this.cache = new DataCache();

    switch (providerType) {
      case "polygon":
        if (!apiKey) throw new Error("Polygon requires an API key");
        this.provider = new PolygonQuotesProvider(apiKey);
        break;
      default:
        this.provider = new YahooDataProvider();
        break;
    }
  }

  /**
   * Get current quote for a symbol
   */
  async getQuote(symbol: string, useCache: boolean = true): Promise<Quote> {
    if (useCache) {
      const cached = this.cache.getQuote(symbol);
      if (cached) return cached;
    }

    const quote = await this.provider.getQuote(symbol);
    this.cache.setQuote(symbol, quote);
    return quote;
  }

  /**
   * Get quotes for multiple symbols
   */
  async getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const quotes = new Map<string, Quote>();

    // Fetch in parallel with error handling
    const results = await Promise.allSettled(symbols.map((s) => this.getQuote(s)));

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const symbol = symbols[i]!;
      if (result?.status === "fulfilled") {
        quotes.set(symbol, result.value);
      }
    }

    return quotes;
  }

  /**
   * Get historical data
   */
  async getHistory(
    symbol: string,
    timeframe: TimeFrame,
    startDate: Date,
    endDate: Date,
    useCache: boolean = true,
  ): Promise<OHLCV[]> {
    if (useCache) {
      const cached = this.cache.getHistory(symbol, timeframe, startDate, endDate);
      if (cached) return cached;
    }

    const history = await this.provider.getHistory(symbol, timeframe, startDate, endDate);
    this.cache.setHistory(symbol, timeframe, startDate, endDate, history);
    return history;
  }

  /**
   * Check if the provider is available
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.provider.name;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    this.cache.cleanup();
  }
}

/**
 * News & Sentiment Data Provider
 *
 * Fetches news headlines and sentiment for stocks.
 * Supports multiple sources (in priority order):
 * - Exa AI (preferred - semantic search with AI)
 * - Alpha Vantage News (requires API key)
 * - Finnhub News (requires API key)
 * - Yahoo Finance News (free, limited)
 */

import type { NewsItem } from "../../agents/types.js";
import { type ExaDataProvider, getExaProvider } from "./exa.js";

const YAHOO_NEWS_URL = "https://query1.finance.yahoo.com";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const FINNHUB_URL = "https://finnhub.io/api/v1";

interface NewsProviderConfig {
  alphaVantageKey?: string;
  finnhubKey?: string;
  exaApiKey?: string;
}

interface AlphaVantageNewsResponse {
  feed?: Array<{
    title: string;
    source: string;
    url: string;
    time_published: string;
    summary: string;
    overall_sentiment_score?: number;
    ticker_sentiment?: Array<{
      ticker: string;
      relevance_score: string;
      ticker_sentiment_score: string;
    }>;
  }>;
}

interface FinnhubNewsResponse {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export class NewsDataProvider {
  name = "News Provider";
  private alphaVantageKey?: string;
  private finnhubKey?: string;
  private exaApiKey?: string;
  private exaProvider?: ExaDataProvider;

  constructor(config?: NewsProviderConfig) {
    this.alphaVantageKey = config?.alphaVantageKey || process.env.ALPHA_VANTAGE_API_KEY;
    this.finnhubKey = config?.finnhubKey || process.env.FINNHUB_API_KEY;
    this.exaApiKey = config?.exaApiKey || process.env.EXA_API_KEY;

    // Initialize Exa if API key is available
    if (this.exaApiKey) {
      try {
        this.exaProvider = getExaProvider({ apiKey: this.exaApiKey });
      } catch {
        // Exa not available, will use fallback providers
      }
    }
  }

  /**
   * Get news for a symbol from available sources
   * Priority: Exa AI > Alpha Vantage > Finnhub > Yahoo
   */
  async getNews(symbol: string, limit: number = 20): Promise<NewsItem[]> {
    const results: NewsItem[] = [];

    // Try Exa first (best semantic search)
    if (this.exaProvider) {
      try {
        const exaNews = await this.exaProvider.getNewsForSymbol(symbol, {
          limit,
          daysBack: 7,
        });
        results.push(...exaNews);
      } catch (error) {
        console.error("Exa news error:", error);
      }
    }

    // Try Alpha Vantage if we need more
    if (results.length < limit && this.alphaVantageKey) {
      try {
        const avNews = await this.getAlphaVantageNews(symbol, limit - results.length);
        results.push(...avNews);
      } catch (error) {
        console.error("Alpha Vantage news error:", error);
      }
    }

    // Try Finnhub if we need more
    if (results.length < limit && this.finnhubKey) {
      try {
        const fhNews = await this.getFinnhubNews(symbol, limit - results.length);
        results.push(...fhNews);
      } catch (error) {
        console.error("Finnhub news error:", error);
      }
    }

    // Fall back to Yahoo if we have no results
    if (results.length === 0) {
      try {
        const yahooNews = await this.getYahooNews(symbol, limit);
        results.push(...yahooNews);
      } catch (error) {
        console.error("Yahoo news error:", error);
      }
    }

    // Dedupe by title
    const seen = new Set<string>();
    return results
      .filter((item) => {
        const key = item.title.toLowerCase().slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  /**
   * Get news from Alpha Vantage (includes sentiment scores)
   */
  private async getAlphaVantageNews(symbol: string, limit: number): Promise<NewsItem[]> {
    if (!this.alphaVantageKey) {
      throw new Error("Alpha Vantage API key not configured");
    }

    const url = `${ALPHA_VANTAGE_URL}?function=NEWS_SENTIMENT&tickers=${symbol}&limit=${limit}&apikey=${this.alphaVantageKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: ${response.status}`);
    }

    const data = (await response.json()) as AlphaVantageNewsResponse;

    if (!data.feed) {
      return [];
    }

    return data.feed.map((item) => {
      // Find sentiment for our specific ticker
      const tickerSentiment = item.ticker_sentiment?.find((ts) => ts.ticker.toUpperCase() === symbol.toUpperCase());

      return {
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: this.parseAlphaVantageTime(item.time_published),
        summary: item.summary,
        sentiment: tickerSentiment ? parseFloat(tickerSentiment.ticker_sentiment_score) : item.overall_sentiment_score,
      };
    });
  }

  /**
   * Get news from Finnhub
   */
  private async getFinnhubNews(symbol: string, limit: number): Promise<NewsItem[]> {
    if (!this.finnhubKey) {
      throw new Error("Finnhub API key not configured");
    }

    // Get news from last 7 days
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);

    const url = `${FINNHUB_URL}/company-news?symbol=${symbol}&from=${from.toISOString().split("T")[0]}&to=${to.toISOString().split("T")[0]}&token=${this.finnhubKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Finnhub API error: ${response.status}`);
    }

    const data = (await response.json()) as FinnhubNewsResponse[];

    return data.slice(0, limit).map((item) => ({
      title: item.headline,
      source: item.source,
      url: item.url,
      publishedAt: new Date(item.datetime * 1000).toISOString(),
      summary: item.summary,
      // Finnhub doesn't provide sentiment, could add NLP here
    }));
  }

  /**
   * Get news from Yahoo Finance (free, no sentiment)
   */
  private async getYahooNews(symbol: string, limit: number): Promise<NewsItem[]> {
    // Yahoo's news endpoint - may have rate limits
    const url = `${YAHOO_NEWS_URL}/v1/finance/search?q=${symbol}&newsCount=${limit}&quotesCount=0`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      news?: Array<{
        title: string;
        publisher: string;
        link: string;
        providerPublishTime: number;
      }>;
    };

    if (!data.news) {
      return [];
    }

    return data.news.map((item) => ({
      title: item.title,
      source: item.publisher,
      url: item.link,
      publishedAt: new Date(item.providerPublishTime * 1000).toISOString(),
    }));
  }

  /**
   * Calculate aggregate sentiment from news items
   */
  calculateAggregateSentiment(news: NewsItem[]): {
    score: number;
    label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive";
    count: number;
  } {
    const withSentiment = news.filter((n) => n.sentiment !== undefined);

    if (withSentiment.length === 0) {
      return { score: 0, label: "neutral", count: 0 };
    }

    // Weight more recent articles higher
    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of withSentiment) {
      const age = now - new Date(item.publishedAt).getTime();
      const ageHours = age / (1000 * 60 * 60);
      const weight = Math.exp(-ageHours / 24); // Decay over 24 hours

      weightedSum += item.sentiment! * weight;
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;

    let label: "very_negative" | "negative" | "neutral" | "positive" | "very_positive";
    if (score <= -0.35) label = "very_negative";
    else if (score <= -0.15) label = "negative";
    else if (score >= 0.35) label = "very_positive";
    else if (score >= 0.15) label = "positive";
    else label = "neutral";

    return { score, label, count: withSentiment.length };
  }

  /**
   * Get market-wide sentiment (for macro analysis)
   */
  async getMarketSentiment(): Promise<{
    sentiment: number;
    fearGreedIndex?: number;
    news: NewsItem[];
  }> {
    // Get news for major indices/ETFs
    const symbols = ["SPY", "QQQ", "DIA"];
    const allNews: NewsItem[] = [];

    for (const symbol of symbols) {
      try {
        const news = await this.getNews(symbol, 10);
        allNews.push(...news);
      } catch {
        // Continue with other symbols
      }
    }

    const aggregate = this.calculateAggregateSentiment(allNews);

    return {
      sentiment: aggregate.score,
      news: allNews.slice(0, 20),
    };
  }

  /**
   * Check if news provider is available
   */
  async isAvailable(): Promise<boolean> {
    // Try Yahoo first (always available)
    try {
      const news = await this.getYahooNews("AAPL", 1);
      return news.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Parse Alpha Vantage time format (20241215T143000)
   */
  private parseAlphaVantageTime(timeStr: string): string {
    // Format: 20241215T143000
    const year = timeStr.slice(0, 4);
    const month = timeStr.slice(4, 6);
    const day = timeStr.slice(6, 8);
    const hour = timeStr.slice(9, 11);
    const minute = timeStr.slice(11, 13);
    const second = timeStr.slice(13, 15);

    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }
}

// Singleton instance
let newsProvider: NewsDataProvider | null = null;

export function getNewsProvider(config?: NewsProviderConfig): NewsDataProvider {
  if (!newsProvider) {
    newsProvider = new NewsDataProvider(config);
  }
  return newsProvider;
}

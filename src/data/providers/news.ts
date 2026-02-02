/**
 * News & Sentiment Data Provider
 *
 * Fetches news headlines and sentiment for stocks.
 * Sources (in priority order):
 * - Exa AI (preferred - semantic search with AI)
 * - Yahoo Finance News (free fallback)
 */

import { NewsItem } from '../../agents/types.js';
import { getExaProvider, ExaDataProvider } from './exa.js';

const YAHOO_NEWS_URL = 'https://query1.finance.yahoo.com';

interface NewsProviderConfig {
  exaApiKey?: string;
}

export class NewsDataProvider {
  name = 'News Provider';
  private exaApiKey?: string;
  private exaProvider?: ExaDataProvider;

  constructor(config?: NewsProviderConfig) {
    this.exaApiKey = config?.exaApiKey || process.env.EXA_API_KEY;

    // Initialize Exa if API key is available
    if (this.exaApiKey) {
      try {
        this.exaProvider = getExaProvider({ apiKey: this.exaApiKey });
      } catch {
        // Exa not available, will use fallback
      }
    }
  }

  /**
   * Get news for a symbol from available sources
   * Priority: Exa AI > Yahoo
   */
  async getNews(symbol: string, limit: number = 20): Promise<NewsItem[]> {
    const results: NewsItem[] = [];

    // Try Exa first (best semantic search with sentiment)
    if (this.exaProvider) {
      try {
        const exaNews = await this.exaProvider.getNewsForSymbol(symbol, {
          limit,
          daysBack: 7,
        });
        results.push(...exaNews);
      } catch (error) {
        console.error('Exa news error:', error);
      }
    }

    // Fall back to Yahoo if we have no results or need more
    if (results.length < limit) {
      try {
        const yahooNews = await this.getYahooNews(symbol, limit - results.length);
        results.push(...yahooNews);
      } catch (error) {
        console.error('Yahoo news error:', error);
      }
    }

    // Dedupe by title
    const seen = new Set<string>();
    return results.filter(item => {
      const key = item.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
  }

  /**
   * Get news from Yahoo Finance (free, no sentiment)
   */
  private async getYahooNews(symbol: string, limit: number): Promise<NewsItem[]> {
    const url = `${YAHOO_NEWS_URL}/v1/finance/search?q=${symbol}&newsCount=${limit}&quotesCount=0`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo API error: ${response.status}`);
    }

    const data = (await response.json()) as { news?: Array<{
      title: string;
      publisher: string;
      link: string;
      providerPublishTime: number;
    }> };

    if (!data.news) {
      return [];
    }

    return data.news.map(item => ({
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
    label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
    count: number;
  } {
    const withSentiment = news.filter(n => n.sentiment !== undefined);

    if (withSentiment.length === 0) {
      return { score: 0, label: 'neutral', count: 0 };
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

    let label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive';
    if (score <= -0.35) label = 'very_negative';
    else if (score <= -0.15) label = 'negative';
    else if (score >= 0.35) label = 'very_positive';
    else if (score >= 0.15) label = 'positive';
    else label = 'neutral';

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
    const symbols = ['SPY', 'QQQ', 'DIA'];
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
    // Check Exa first, then Yahoo
    if (this.exaProvider) {
      try {
        const available = await this.exaProvider.isAvailable();
        if (available) return true;
      } catch {
        // Fall through to Yahoo check
      }
    }

    try {
      const news = await this.getYahooNews('AAPL', 1);
      return news.length > 0;
    } catch {
      return false;
    }
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

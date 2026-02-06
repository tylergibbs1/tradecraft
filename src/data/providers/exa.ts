/**
 * Exa AI Data Provider
 *
 * Uses Exa's AI-powered search to find financial reports, news,
 * company information, and research for trading analysis.
 *
 * Exa provides semantic search with categories optimized for finance:
 * - financial report: 10-Ks, earnings reports, analyst reports
 * - news: Recent news articles
 * - company: Company information and profiles
 * - research paper: Academic/research content
 */

import Exa from "exa-js";
import type { FilingMetadata, NewsItem } from "../../agents/types.js";

export interface ExaSearchResult {
  url: string;
  title: string;
  text?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
}

export interface ExaProviderConfig {
  apiKey: string;
}

export type ExaCategory =
  | "financial report"
  | "news"
  | "company"
  | "research paper"
  | "tweet"
  | "pdf"
  | "personal site"
  | "people";

export class ExaDataProvider {
  name = "Exa AI";
  private client: Exa;

  constructor(config?: ExaProviderConfig) {
    const apiKey = config?.apiKey || process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error("Exa API key not configured. Set EXA_API_KEY or pass apiKey in config.");
    }
    this.client = new Exa(apiKey);
  }

  /**
   * Search for financial reports (10-Ks, earnings, analyst reports)
   */
  async searchFinancialReports(
    query: string,
    options?: {
      numResults?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<ExaSearchResult[]> {
    const result = await this.client.search(query, {
      category: "financial report",
      type: "auto",
      numResults: options?.numResults || 10,
      startPublishedDate: options?.startDate?.toISOString(),
      endPublishedDate: options?.endDate?.toISOString(),
      contents: {
        text: true,
      },
    });

    return this.mapResults(result.results);
  }

  /**
   * Search for news articles
   */
  async searchNews(
    query: string,
    options?: {
      numResults?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<ExaSearchResult[]> {
    const result = await this.client.search(query, {
      category: "news",
      type: "auto",
      numResults: options?.numResults || 20,
      startPublishedDate: options?.startDate?.toISOString(),
      endPublishedDate: options?.endDate?.toISOString(),
      contents: {
        text: true,
      },
    });

    return this.mapResults(result.results);
  }

  /**
   * Search for company information
   */
  async searchCompany(
    query: string,
    options?: {
      numResults?: number;
    },
  ): Promise<ExaSearchResult[]> {
    const result = await this.client.search(query, {
      category: "company",
      type: "auto",
      numResults: options?.numResults || 10,
      contents: {
        text: true,
      },
    });

    return this.mapResults(result.results);
  }

  /**
   * Search for research papers
   */
  async searchResearch(
    query: string,
    options?: {
      numResults?: number;
    },
  ): Promise<ExaSearchResult[]> {
    const result = await this.client.search(query, {
      category: "research paper",
      type: "auto",
      numResults: options?.numResults || 10,
      contents: {
        text: true,
      },
    });

    return this.mapResults(result.results);
  }

  /**
   * General semantic search across all categories
   */
  async search(
    query: string,
    options?: {
      category?: ExaCategory;
      numResults?: number;
      startDate?: Date;
      endDate?: Date;
      includeText?: boolean;
    },
  ): Promise<ExaSearchResult[]> {
    const searchOptions: Record<string, unknown> = {
      type: "auto",
      numResults: options?.numResults || 10,
      contents: { text: true },
    };

    if (options?.category) {
      searchOptions.category = options.category;
    }
    if (options?.startDate) {
      searchOptions.startPublishedDate = options.startDate.toISOString();
    }
    if (options?.endDate) {
      searchOptions.endPublishedDate = options.endDate.toISOString();
    }

    const result = await this.client.search(query, searchOptions as Record<string, unknown>);
    return this.mapResults(result.results);
  }

  /**
   * Find similar content to a URL
   */
  async findSimilar(
    url: string,
    options?: {
      numResults?: number;
      includeText?: boolean;
    },
  ): Promise<ExaSearchResult[]> {
    const result = await this.client.findSimilar(url, {
      numResults: options?.numResults || 10,
      contents: { text: true },
    });

    return this.mapResults(result.results);
  }

  /**
   * Get news for a stock symbol in NewsItem format
   */
  async getNewsForSymbol(
    symbol: string,
    options?: {
      limit?: number;
      daysBack?: number;
    },
  ): Promise<NewsItem[]> {
    const limit = options?.limit || 20;
    const daysBack = options?.daysBack || 7;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const results = await this.searchNews(`${symbol} stock`, {
      numResults: limit,
      startDate,
    });

    return results.map((r) => ({
      title: r.title,
      source: this.extractDomain(r.url),
      url: r.url,
      publishedAt: r.publishedDate || new Date().toISOString(),
      summary: r.text?.slice(0, 500),
      // Exa doesn't provide sentiment, but we can add basic analysis
      sentiment: this.analyzeSentiment(`${r.title} ${r.text || ""}`),
    }));
  }

  /**
   * Get financial reports for a symbol
   */
  async getFilingsForSymbol(
    symbol: string,
    options?: {
      limit?: number;
      formTypes?: string[];
    },
  ): Promise<FilingMetadata[]> {
    const limit = options?.limit || 10;

    // Search for 10-K, 10-Q, earnings reports
    const query = options?.formTypes
      ? `${symbol} ${options.formTypes.join(" OR ")}`
      : `${symbol} 10-K OR 10-Q OR earnings report`;

    const results = await this.searchFinancialReports(query, {
      numResults: limit,
    });

    return results.map((r) => ({
      form: this.detectFormType(r.title),
      filedAt: r.publishedDate || new Date().toISOString(),
      url: r.url,
      description: r.title,
    }));
  }

  /**
   * Search for earnings call transcripts
   */
  async getEarningsCallTranscripts(
    symbol: string,
    options?: {
      limit?: number;
      quarter?: string;
    },
  ): Promise<Array<{ title: string; url: string; date: string; text?: string }>> {
    const query = options?.quarter
      ? `${symbol} earnings call transcript ${options.quarter}`
      : `${symbol} earnings call transcript`;

    const results = await this.searchFinancialReports(query, {
      numResults: options?.limit || 5,
    });

    return results.map((r) => ({
      title: r.title,
      url: r.url,
      date: r.publishedDate || new Date().toISOString(),
      text: r.text,
    }));
  }

  /**
   * Search for analyst reports and research
   */
  async getAnalystResearch(
    symbol: string,
    options?: {
      limit?: number;
    },
  ): Promise<ExaSearchResult[]> {
    const results = await this.searchFinancialReports(`${symbol} analyst report price target recommendation`, {
      numResults: options?.limit || 10,
    });

    return results;
  }

  /**
   * Search for competitor analysis
   */
  async getCompetitorAnalysis(
    symbol: string,
    options?: {
      limit?: number;
    },
  ): Promise<ExaSearchResult[]> {
    const results = await this.search(`${symbol} competitors market share industry analysis`, {
      category: "company",
      numResults: options?.limit || 10,
    });

    return results;
  }

  /**
   * Check if Exa API is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.search("test", { numResults: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private mapResults(results: Record<string, unknown>[]): ExaSearchResult[] {
    return results.map((r) => ({
      url: r.url,
      title: r.title || "Untitled",
      text: r.text,
      publishedDate: r.publishedDate,
      author: r.author,
      score: r.score,
    }));
  }

  private extractDomain(url: string): string {
    try {
      const domain = new URL(url).hostname;
      return domain.replace("www.", "");
    } catch {
      return "unknown";
    }
  }

  private detectFormType(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes("10-k") || lower.includes("annual report")) return "10-K";
    if (lower.includes("10-q") || lower.includes("quarterly")) return "10-Q";
    if (lower.includes("8-k")) return "8-K";
    if (lower.includes("earnings")) return "Earnings";
    if (lower.includes("analyst")) return "Analyst Report";
    return "Report";
  }

  /**
   * Basic sentiment analysis from text
   * Returns -1 to 1 scale
   */
  private analyzeSentiment(text: string): number {
    const lower = text.toLowerCase();

    const positiveWords = [
      "beat",
      "exceeds",
      "growth",
      "surge",
      "jump",
      "soar",
      "gain",
      "rise",
      "strong",
      "outperform",
      "upgrade",
      "bullish",
      "record",
      "breakthrough",
      "profit",
      "success",
      "positive",
      "optimistic",
      "expand",
      "accelerate",
    ];

    const negativeWords = [
      "miss",
      "decline",
      "fall",
      "drop",
      "plunge",
      "crash",
      "loss",
      "weak",
      "underperform",
      "downgrade",
      "bearish",
      "warning",
      "concern",
      "risk",
      "cut",
      "layoff",
      "downturn",
      "negative",
      "pessimistic",
      "slow",
      "fail",
    ];

    let score = 0;
    let count = 0;

    for (const word of positiveWords) {
      if (lower.includes(word)) {
        score += 1;
        count++;
      }
    }

    for (const word of negativeWords) {
      if (lower.includes(word)) {
        score -= 1;
        count++;
      }
    }

    if (count === 0) return 0;
    return Math.max(-1, Math.min(1, score / count));
  }
}

// Singleton instance
let exaProvider: ExaDataProvider | null = null;

export function getExaProvider(config?: ExaProviderConfig): ExaDataProvider {
  if (!exaProvider) {
    exaProvider = new ExaDataProvider(config);
  }
  return exaProvider;
}

export function resetExaProvider(): void {
  exaProvider = null;
}

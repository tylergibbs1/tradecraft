/**
 * Sentiment Analyst Agent
 *
 * Specializes in analyzing news, social sentiment, and market
 * psychology to identify sentiment extremes and shifts.
 */

import { getNewsProvider, type NewsDataProvider } from "../../data/providers/news.js";
import { ResearchAgent, type ResearchAgentDependencies, type ToolDefinition } from "../base.js";
import type { AgentSignal, ResearchAgentConfig, ResearchContext, SignalStrength } from "../types.js";

export class SentimentAnalyst extends ResearchAgent {
  private newsProvider: NewsDataProvider;

  constructor(
    config: Omit<ResearchAgentConfig, "role">,
    deps: ResearchAgentDependencies & {
      newsProviderConfig?: { alphaVantageKey?: string; finnhubKey?: string };
    },
  ) {
    super({ ...config, role: "sentiment-analyst" }, deps);
    this.newsProvider = getNewsProvider(deps.newsProviderConfig);
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: "get_news",
        description: "Get recent news articles and sentiment for a symbol",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
            limit: { type: "number", description: "Max articles to return (default 20)" },
          },
          required: ["symbol"],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const limit = (input.limit as number) || 20;
          const news = await this.newsProvider.getNews(symbol, limit);
          const aggregate = this.newsProvider.calculateAggregateSentiment(news);

          return {
            news: news.slice(0, 10), // Return top 10 for context
            sentiment: aggregate,
            totalArticles: news.length,
          };
        },
      },
      {
        name: "get_market_sentiment",
        description: "Get overall market sentiment from major indices news",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          return this.newsProvider.getMarketSentiment();
        },
      },
      {
        name: "analyze_headlines",
        description: "Analyze a list of headlines for sentiment themes",
        inputSchema: {
          type: "object",
          properties: {
            headlines: {
              type: "array",
              items: { type: "string" },
              description: "Headlines to analyze",
            },
          },
          required: ["headlines"],
        },
        handler: async (input: Record<string, unknown>) => {
          const headlines = input.headlines as string[];
          return this.analyzeHeadlines(headlines);
        },
      },
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert sentiment analyst at a quantitative hedge fund. Your role is to analyze news sentiment, market psychology, and identify sentiment extremes that may signal contrarian opportunities.

Your analysis framework:
1. SENTIMENT ASSESSMENT
   - Overall sentiment tone (positive/negative/neutral)
   - Sentiment intensity (mild vs extreme)
   - Sentiment trend (improving/deteriorating/stable)

2. CONTRARIAN SIGNALS
   - Extreme pessimism (potential buying opportunity)
   - Extreme optimism (potential selling opportunity)
   - Sentiment divergence from price action

3. NEWS ANALYSIS
   - Key themes and narratives
   - Event-driven catalysts
   - Media coverage intensity

4. MARKET PSYCHOLOGY
   - Fear/greed indicators
   - Crowding signals
   - Narrative shifts

IMPORTANT: Sentiment is often a contrarian indicator:
- Extreme negative sentiment + stable/improving fundamentals = potential BUY
- Extreme positive sentiment + deteriorating fundamentals = potential SELL
- Use sentiment as a timing tool, not a primary signal

OUTPUT FORMAT:
After your analysis, provide a trading signal in this exact JSON format:

\`\`\`json
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "confidence": 0.0 to 1.0,
  "timeframe": "day" | "week",
  "reasoning": "2-3 sentence sentiment summary",
  "data": {
    "sentimentScore": -1.0 to 1.0,
    "sentimentLabel": "very_negative" | "negative" | "neutral" | "positive" | "very_positive",
    "isContrarian": boolean,
    "keyThemes": ["theme1", "theme2"],
    "newsIntensity": "low" | "normal" | "high"
  }
}
\`\`\`

Remember: Extreme sentiment often marks turning points. Be contrarian when appropriate.`;
  }

  protected buildAnalysisPrompt(symbol: string, context: ResearchContext): string {
    let prompt = `Analyze sentiment for ${symbol} to identify sentiment extremes and potential contrarian opportunities.\n\n`;

    if (context.existingSignals && context.existingSignals.length > 0) {
      prompt += `Other analysts have provided these signals:\n`;
      for (const sig of context.existingSignals.slice(0, 3)) {
        prompt += `- ${sig.agentRole}: ${sig.signal} (${sig.confidence.toFixed(2)} confidence)\n`;
      }
      prompt += "\nConsider whether sentiment aligns with or diverges from fundamental/technical views.\n\n";
    }

    prompt += `Steps:
1. Use get_news to fetch recent news and sentiment scores
2. Use get_market_sentiment to understand broader market context
3. Analyze headlines for themes and intensity
4. Determine if sentiment represents a contrarian opportunity

Key questions:
- Is sentiment at an extreme (very positive or very negative)?
- Does sentiment diverge from price action or fundamentals?
- Are there any narrative shifts or theme changes?
- What's the news intensity (coverage volume)?

Provide your signal in the JSON format specified. Remember that extreme sentiment can be a contrarian indicator.`;

    return prompt;
  }

  protected parseSignals(
    symbol: string,
    response: string,
    _context: ResearchContext,
  ): Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole">[] {
    const signals: Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole">[] = [];

    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      const rawJsonMatch = response.match(/\{[\s\S]*"signal"[\s\S]*\}/);
      if (!rawJsonMatch) return signals;

      try {
        const parsed = JSON.parse(rawJsonMatch[0]);
        signals.push(this.createSignalFromParsed(symbol, parsed));
      } catch {
        return signals;
      }
    } else {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        signals.push(this.createSignalFromParsed(symbol, parsed));
      } catch {
        return signals;
      }
    }

    return signals;
  }

  private createSignalFromParsed(
    symbol: string,
    parsed: Record<string, unknown>,
  ): Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole"> {
    const data = parsed.data as Record<string, unknown> | undefined;

    return {
      symbol,
      signal: parsed.signal as SignalStrength,
      confidence: Math.max(0, Math.min(1, parsed.confidence as number)),
      timeframe: (parsed.timeframe as "day" | "week") || "week",
      reasoning: parsed.reasoning as string,
      data: {
        ...data,
        isContrarianSignal: data?.isContrarian || false,
      },
    };
  }

  private analyzeHeadlines(headlines: string[]): Record<string, unknown> {
    const themes: Record<string, number> = {};
    const keywords = {
      earnings: ["earnings", "revenue", "profit", "eps", "beat", "miss"],
      growth: ["growth", "expand", "increase", "surge", "jump", "soar"],
      decline: ["decline", "fall", "drop", "plunge", "crash", "sink"],
      acquisition: ["acquire", "merger", "buyout", "deal", "takeover"],
      layoffs: ["layoff", "cut", "reduce", "restructure", "downsize"],
      product: ["launch", "release", "announce", "unveil", "introduce"],
      legal: ["lawsuit", "sue", "investigation", "probe", "regulatory"],
      analyst: ["upgrade", "downgrade", "target", "rating", "analyst"],
    };

    for (const headline of headlines) {
      const lower = headline.toLowerCase();
      for (const [theme, words] of Object.entries(keywords)) {
        if (words.some((word) => lower.includes(word))) {
          themes[theme] = (themes[theme] || 0) + 1;
        }
      }
    }

    // Sort themes by frequency
    const sortedThemes = Object.entries(themes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Simple sentiment from keywords
    let positiveCount = 0;
    let negativeCount = 0;
    const positiveWords = ["beat", "surge", "jump", "soar", "growth", "expand", "upgrade"];
    const negativeWords = ["miss", "decline", "fall", "drop", "plunge", "crash", "downgrade", "layoff"];

    for (const headline of headlines) {
      const lower = headline.toLowerCase();
      if (positiveWords.some((w) => lower.includes(w))) positiveCount++;
      if (negativeWords.some((w) => lower.includes(w))) negativeCount++;
    }

    return {
      topThemes: sortedThemes.map(([theme, count]) => ({ theme, count })),
      headlineCount: headlines.length,
      positiveHeadlines: positiveCount,
      negativeHeadlines: negativeCount,
      sentimentSkew: headlines.length > 0 ? (positiveCount - negativeCount) / headlines.length : 0,
    };
  }
}

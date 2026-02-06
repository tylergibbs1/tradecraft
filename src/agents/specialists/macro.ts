/**
 * Macro Analyst Agent
 *
 * Specializes in analyzing macroeconomic conditions, sector rotation,
 * and market regimes to provide context for individual stock decisions.
 */

import { ResearchAgent, type ResearchAgentDependencies, type ToolDefinition } from "../base.js";
import type { AgentSignal, PriceBar, ResearchAgentConfig, ResearchContext, SignalStrength } from "../types.js";

interface SectorPerformance {
  sector: string;
  symbol: string;
  return1w: number;
  return1m: number;
  return3m: number;
  relativeStrength: number;
}

interface MarketRegime {
  regime: "risk-on" | "risk-off" | "neutral";
  volatilityLevel: "low" | "normal" | "high" | "extreme";
  trendStrength: "strong" | "moderate" | "weak";
  breadth: "healthy" | "narrow" | "deteriorating";
}

// Sector ETFs for rotation analysis
const SECTOR_ETFS: Record<string, string> = {
  Technology: "XLK",
  Healthcare: "XLV",
  Financials: "XLF",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Energy: "XLE",
  Industrials: "XLI",
  Materials: "XLB",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Communication Services": "XLC",
};

// Market ETFs for regime analysis
const MARKET_ETFS = {
  sp500: "SPY",
  nasdaq: "QQQ",
  smallCap: "IWM",
  bonds: "TLT",
  volatility: "VIX",
  gold: "GLD",
};

export class MacroAnalyst extends ResearchAgent {
  private priceDataFetcher: (symbol: string, days: number) => Promise<PriceBar[]>;

  constructor(
    config: Omit<ResearchAgentConfig, "role">,
    deps: ResearchAgentDependencies & {
      priceDataFetcher: (symbol: string, days: number) => Promise<PriceBar[]>;
    },
  ) {
    super({ ...config, role: "macro-analyst" }, deps);
    this.priceDataFetcher = deps.priceDataFetcher;
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: "get_sector_rotation",
        description: "Analyze sector performance and rotation trends",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          return this.analyzeSectorRotation();
        },
      },
      {
        name: "get_market_regime",
        description: "Determine current market regime (risk-on/risk-off, volatility, trend)",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          return this.analyzeMarketRegime();
        },
      },
      {
        name: "get_relative_strength",
        description: "Compare a symbol's performance to the S&P 500",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
          },
          required: ["symbol"],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          return this.calculateRelativeStrength(symbol);
        },
      },
      {
        name: "get_sector_for_symbol",
        description: "Get sector context for a specific symbol",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
            sector: { type: "string", description: "Sector name (e.g., Technology, Healthcare)" },
          },
          required: ["symbol", "sector"],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const sector = input.sector as string;
          return this.getSectorContext(symbol, sector);
        },
      },
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert macro strategist at a quantitative hedge fund. Your role is to analyze macroeconomic conditions, sector rotation, and market regimes to provide context for stock selection.

Your analysis framework:
1. MARKET REGIME
   - Risk appetite (risk-on vs risk-off)
   - Volatility environment
   - Trend direction and strength
   - Market breadth (broad vs narrow participation)

2. SECTOR ROTATION
   - Leading and lagging sectors
   - Rotation trends (early/mid/late cycle)
   - Relative strength rankings

3. INTERMARKET ANALYSIS
   - Stock/bond relationship
   - Growth vs value dynamics
   - Large cap vs small cap preference
   - Defensive vs cyclical bias

4. POSITION CONTEXT
   - Does the current regime favor this stock's sector?
   - Is relative strength positive or negative?
   - What's the macro risk/reward?

OUTPUT FORMAT:
After your analysis, provide a trading signal in this exact JSON format:

\`\`\`json
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "confidence": 0.0 to 1.0,
  "timeframe": "week" | "month",
  "reasoning": "2-3 sentence macro context",
  "data": {
    "regime": "risk-on" | "risk-off" | "neutral",
    "sectorRanking": "top_quartile" | "middle" | "bottom_quartile",
    "relativeStrength": number,
    "macroSupport": "strong" | "moderate" | "weak" | "headwind"
  }
}
\`\`\`

Focus on whether macro conditions support or hinder the stock's potential. Even great companies struggle in unfavorable macro environments.`;
  }

  protected buildAnalysisPrompt(symbol: string, context: ResearchContext): string {
    let prompt = `Analyze the macro environment for ${symbol} to determine if conditions are favorable.\n\n`;

    if (context.sector) {
      prompt += `Sector: ${context.sector}\n`;
    }
    if (context.industry) {
      prompt += `Industry: ${context.industry}\n\n`;
    }

    if (context.existingSignals && context.existingSignals.length > 0) {
      prompt += `Other analysts have provided these signals:\n`;
      for (const sig of context.existingSignals.slice(0, 3)) {
        prompt += `- ${sig.agentRole}: ${sig.signal} (${sig.confidence.toFixed(2)} confidence)\n`;
      }
      prompt += "\nProvide macro context for these views.\n\n";
    }

    prompt += `Steps:
1. Use get_market_regime to understand current market conditions
2. Use get_sector_rotation to see where this stock's sector ranks
3. Use get_relative_strength to compare ${symbol} to the broader market
4. Synthesize into a macro-informed signal

Key questions:
- Does the current regime favor this type of stock?
- Is the sector in favor or out of favor?
- Is the stock outperforming or underperforming its benchmark?
- Are there macro headwinds or tailwinds?

Provide your signal in the JSON format specified.`;

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
    return {
      symbol,
      signal: parsed.signal as SignalStrength,
      confidence: Math.max(0, Math.min(1, parsed.confidence as number)),
      timeframe: (parsed.timeframe as "week" | "month") || "month",
      reasoning: parsed.reasoning as string,
      data: parsed.data as Record<string, unknown> | undefined,
    };
  }

  private async analyzeSectorRotation(): Promise<{
    sectors: SectorPerformance[];
    leadingSectors: string[];
    laggingSectors: string[];
    rotationSignal: string;
  }> {
    const sectors: SectorPerformance[] = [];
    const spyPrices = await this.priceDataFetcher(MARKET_ETFS.sp500, 90);
    const spyReturns = this.calculateReturns(spyPrices);

    for (const [sector, etf] of Object.entries(SECTOR_ETFS)) {
      try {
        const prices = await this.priceDataFetcher(etf, 90);
        const returns = this.calculateReturns(prices);

        sectors.push({
          sector,
          symbol: etf,
          return1w: returns.return1w,
          return1m: returns.return1m,
          return3m: returns.return3m,
          relativeStrength: returns.return1m - spyReturns.return1m,
        });
      } catch {
        // Skip unavailable sectors
      }
    }

    // Sort by 1-month relative strength
    sectors.sort((a, b) => b.relativeStrength - a.relativeStrength);

    const leadingSectors = sectors.slice(0, 3).map((s) => s.sector);
    const laggingSectors = sectors.slice(-3).map((s) => s.sector);

    // Determine rotation signal
    let rotationSignal = "neutral";
    const cyclicalLeading = leadingSectors.some((s) =>
      ["Technology", "Consumer Discretionary", "Financials", "Industrials"].includes(s),
    );
    const defensiveLeading = leadingSectors.some((s) => ["Utilities", "Consumer Staples", "Healthcare"].includes(s));

    if (cyclicalLeading && !defensiveLeading) {
      rotationSignal = "risk-on: cyclicals leading";
    } else if (defensiveLeading && !cyclicalLeading) {
      rotationSignal = "risk-off: defensives leading";
    } else {
      rotationSignal = "mixed: no clear rotation";
    }

    return {
      sectors,
      leadingSectors,
      laggingSectors,
      rotationSignal,
    };
  }

  private async analyzeMarketRegime(): Promise<
    MarketRegime & {
      details: Record<string, unknown>;
    }
  > {
    const spyPrices = await this.priceDataFetcher(MARKET_ETFS.sp500, 200);
    const qqq = await this.priceDataFetcher(MARKET_ETFS.nasdaq, 60);
    const iwm = await this.priceDataFetcher(MARKET_ETFS.smallCap, 60);
    const tlt = await this.priceDataFetcher(MARKET_ETFS.bonds, 60);

    const spyCloses = spyPrices.map((p) => p.close);
    const current = spyCloses[spyCloses.length - 1];

    // Trend analysis
    const sma50 = this.sma(spyCloses, 50);
    const sma200 = this.sma(spyCloses, 200);
    const aboveSma50 = current > sma50;
    const aboveSma200 = current > sma200;
    const sma50AboveSma200 = sma50 > sma200;

    let trendStrength: "strong" | "moderate" | "weak" = "weak";
    if (aboveSma50 && aboveSma200 && sma50AboveSma200) {
      trendStrength = "strong";
    } else if (aboveSma50 || aboveSma200) {
      trendStrength = "moderate";
    }

    // Volatility (simplified - use price range)
    const returns = [];
    for (let i = 1; i < spyCloses.length; i++) {
      returns.push((spyCloses[i] - spyCloses[i - 1]) / spyCloses[i - 1]);
    }
    const recentReturns = returns.slice(-20);
    const volatility =
      Math.sqrt(recentReturns.reduce((sum, r) => sum + r * r, 0) / recentReturns.length) * Math.sqrt(252) * 100; // Annualized

    let volatilityLevel: "low" | "normal" | "high" | "extreme" = "normal";
    if (volatility < 12) volatilityLevel = "low";
    else if (volatility > 25) volatilityLevel = "extreme";
    else if (volatility > 18) volatilityLevel = "high";

    // Risk appetite
    const qqqReturn = this.calculateReturns(qqq).return1m;
    const iwmReturn = this.calculateReturns(iwm).return1m;
    const tltReturn = this.calculateReturns(tlt).return1m;

    let regime: "risk-on" | "risk-off" | "neutral" = "neutral";
    if (qqqReturn > 0 && iwmReturn > 0 && tltReturn < 0) {
      regime = "risk-on";
    } else if (tltReturn > 0 && (qqqReturn < 0 || iwmReturn < 0)) {
      regime = "risk-off";
    }

    // Breadth (simplified)
    const spyReturn = this.calculateReturns(spyPrices).return1m;
    let breadth: "healthy" | "narrow" | "deteriorating" = "healthy";
    if (Math.abs(qqqReturn - iwmReturn) > 0.05) {
      breadth = "narrow";
    }
    if (iwmReturn < spyReturn - 0.02) {
      breadth = "deteriorating";
    }

    return {
      regime,
      volatilityLevel,
      trendStrength,
      breadth,
      details: {
        spy: { current, sma50, sma200, return1m: spyReturn },
        qqq: { return1m: qqqReturn },
        iwm: { return1m: iwmReturn },
        tlt: { return1m: tltReturn },
        volatility: `${volatility.toFixed(1)}%`,
      },
    };
  }

  private async calculateRelativeStrength(symbol: string): Promise<{
    symbol: string;
    relativeStrength1w: number;
    relativeStrength1m: number;
    relativeStrength3m: number;
    outperforming: boolean;
    trend: "improving" | "stable" | "deteriorating";
  }> {
    const stockPrices = await this.priceDataFetcher(symbol, 90);
    const spyPrices = await this.priceDataFetcher(MARKET_ETFS.sp500, 90);

    const stockReturns = this.calculateReturns(stockPrices);
    const spyReturns = this.calculateReturns(spyPrices);

    const rs1w = stockReturns.return1w - spyReturns.return1w;
    const rs1m = stockReturns.return1m - spyReturns.return1m;
    const rs3m = stockReturns.return3m - spyReturns.return3m;

    let trend: "improving" | "stable" | "deteriorating" = "stable";
    if (rs1w > rs1m && rs1m > 0) {
      trend = "improving";
    } else if (rs1w < rs1m && rs1m < 0) {
      trend = "deteriorating";
    }

    return {
      symbol,
      relativeStrength1w: rs1w,
      relativeStrength1m: rs1m,
      relativeStrength3m: rs3m,
      outperforming: rs1m > 0,
      trend,
    };
  }

  private async getSectorContext(symbol: string, sector: string): Promise<Record<string, unknown>> {
    const sectorEtf = SECTOR_ETFS[sector];
    if (!sectorEtf) {
      return { error: `Unknown sector: ${sector}` };
    }

    const [stockPrices, sectorPrices, spyPrices] = await Promise.all([
      this.priceDataFetcher(symbol, 90),
      this.priceDataFetcher(sectorEtf, 90),
      this.priceDataFetcher(MARKET_ETFS.sp500, 90),
    ]);

    const stockReturns = this.calculateReturns(stockPrices);
    const sectorReturns = this.calculateReturns(sectorPrices);
    const spyReturns = this.calculateReturns(spyPrices);

    return {
      symbol,
      sector,
      sectorEtf,
      stockVsSector: {
        "1w": stockReturns.return1w - sectorReturns.return1w,
        "1m": stockReturns.return1m - sectorReturns.return1m,
        "3m": stockReturns.return3m - sectorReturns.return3m,
      },
      sectorVsSpy: {
        "1w": sectorReturns.return1w - spyReturns.return1w,
        "1m": sectorReturns.return1m - spyReturns.return1m,
        "3m": sectorReturns.return3m - spyReturns.return3m,
      },
      sectorInFavor: sectorReturns.return1m > spyReturns.return1m,
      stockLeadingSector: stockReturns.return1m > sectorReturns.return1m,
    };
  }

  private calculateReturns(prices: PriceBar[]): {
    return1w: number;
    return1m: number;
    return3m: number;
  } {
    const closes = prices.map((p) => p.close);
    const current = closes[closes.length - 1];

    const get1wAgo = closes.length >= 5 ? closes[closes.length - 6] : closes[0];
    const get1mAgo = closes.length >= 21 ? closes[closes.length - 22] : closes[0];
    const get3mAgo = closes.length >= 63 ? closes[closes.length - 64] : closes[0];

    return {
      return1w: (current - get1wAgo) / get1wAgo,
      return1m: (current - get1mAgo) / get1mAgo,
      return3m: (current - get3mAgo) / get3mAgo,
    };
  }

  private sma(data: number[], period: number): number {
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }
}

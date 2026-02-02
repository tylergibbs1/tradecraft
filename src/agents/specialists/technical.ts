/**
 * Technical Analyst Agent
 *
 * Specializes in analyzing price patterns, momentum, and
 * volume to identify entry/exit points and trend direction.
 */

import {
  ResearchAgent,
  ResearchAgentDependencies,
  ToolDefinition,
} from '../base.js';
import {
  ResearchAgentConfig,
  ResearchContext,
  AgentSignal,
  SignalStrength,
  PriceBar,
} from '../types.js';

interface TechnicalIndicators {
  sma20: number;
  sma50: number;
  sma200: number;
  rsi14: number;
  macd: { line: number; signal: number; histogram: number };
  atr14: number;
  bollingerBands: { upper: number; middle: number; lower: number };
  volumeAvg20: number;
  priceChange: { day: number; week: number; month: number };
  support: number;
  resistance: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

export class TechnicalAnalyst extends ResearchAgent {
  private priceDataFetcher: (symbol: string, days: number) => Promise<PriceBar[]>;

  constructor(
    config: Omit<ResearchAgentConfig, 'role'>,
    deps: ResearchAgentDependencies & {
      priceDataFetcher: (symbol: string, days: number) => Promise<PriceBar[]>;
    }
  ) {
    super({ ...config, role: 'technical-analyst' }, deps);
    this.priceDataFetcher = deps.priceDataFetcher;
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: 'get_technical_indicators',
        description: 'Calculate technical indicators for a symbol (SMA, RSI, MACD, Bollinger Bands, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
            days: { type: 'number', description: 'Days of history to analyze (default 200)' },
          },
          required: ['symbol'],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const days = (input.days as number) || 200;
          const prices = await this.priceDataFetcher(symbol, days);
          return this.calculateIndicators(prices);
        },
      },
      {
        name: 'get_price_history',
        description: 'Get raw price history for custom analysis',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
            days: { type: 'number', description: 'Days of history' },
          },
          required: ['symbol'],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const days = (input.days as number) || 60;
          const prices = await this.priceDataFetcher(symbol, days);
          return prices.slice(-60); // Return last 60 bars max
        },
      },
      {
        name: 'identify_patterns',
        description: 'Identify chart patterns (support/resistance, trends, reversals)',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const prices = await this.priceDataFetcher(symbol, 100);
          return this.identifyPatterns(prices);
        },
      },
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert technical analyst at a quantitative hedge fund. Your role is to analyze price action, momentum, and volume to identify trading opportunities and optimal entry/exit points.

Your analysis framework:
1. TREND ANALYSIS
   - Primary trend (bullish/bearish/neutral)
   - Trend strength and momentum
   - Moving average alignment (20/50/200)

2. MOMENTUM INDICATORS
   - RSI for overbought/oversold conditions
   - MACD for momentum shifts
   - Volume confirmation of moves

3. SUPPORT/RESISTANCE
   - Key price levels
   - Breakout/breakdown potential
   - Risk/reward at current levels

4. PATTERN RECOGNITION
   - Chart patterns (double tops/bottoms, head & shoulders, etc.)
   - Candlestick patterns
   - Volume patterns

5. RISK PARAMETERS
   - Entry price
   - Stop loss level
   - Target prices

OUTPUT FORMAT:
After your analysis, provide a trading signal in this exact JSON format:

\`\`\`json
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "confidence": 0.0 to 1.0,
  "timeframe": "day" | "week",
  "reasoning": "2-3 sentence technical summary",
  "priceTarget": number,
  "stopLoss": number,
  "data": {
    "trend": "bullish" | "bearish" | "neutral",
    "rsi": number,
    "aboveSma200": boolean,
    "support": number,
    "resistance": number,
    "momentum": "strong" | "moderate" | "weak" | "reversing"
  }
}
\`\`\`

Focus on actionable signals with clear risk/reward. A HOLD is appropriate when the setup is unclear or risk/reward is unfavorable.`;
  }

  protected buildAnalysisPrompt(
    symbol: string,
    context: ResearchContext
  ): string {
    let prompt = `Analyze ${symbol} from a technical perspective to identify trading opportunities.\n\n`;

    if (context.currentPrice) {
      prompt += `Current price: $${context.currentPrice.toFixed(2)}\n\n`;
    }

    if (context.existingSignals && context.existingSignals.length > 0) {
      prompt += `Other analysts have provided these signals:\n`;
      for (const sig of context.existingSignals.slice(0, 3)) {
        prompt += `- ${sig.agentRole}: ${sig.signal} (${sig.confidence.toFixed(2)} confidence)\n`;
      }
      prompt += '\n';
    }

    prompt += `Steps:
1. Use get_technical_indicators to calculate key indicators
2. Use identify_patterns to find chart patterns and levels
3. Synthesize into a trading signal with specific price targets and stop loss

Consider:
- Is the trend in your favor?
- What does momentum suggest?
- Where are the key levels?
- What's the risk/reward from current price?

Provide your signal in the JSON format specified.`;

    return prompt;
  }

  protected parseSignals(
    symbol: string,
    response: string,
    context: ResearchContext
  ): Omit<AgentSignal, 'id' | 'timestamp' | 'agentId' | 'agentRole'>[] {
    const signals: Omit<AgentSignal, 'id' | 'timestamp' | 'agentId' | 'agentRole'>[] = [];

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
    parsed: Record<string, unknown>
  ): Omit<AgentSignal, 'id' | 'timestamp' | 'agentId' | 'agentRole'> {
    return {
      symbol,
      signal: (parsed.signal as SignalStrength) || 'HOLD',
      confidence: Math.max(0, Math.min(1, (parsed.confidence as number) || 0.5)),
      timeframe: (parsed.timeframe as 'day' | 'week') || 'week',
      reasoning: (parsed.reasoning as string) || 'Technical analysis complete',
      priceTarget: parsed.priceTarget as number | undefined,
      stopLoss: parsed.stopLoss as number | undefined,
      data: parsed.data as Record<string, unknown> | undefined,
    };
  }

  private calculateIndicators(prices: PriceBar[]): TechnicalIndicators | null {
    if (prices.length < 50) return null;

    const closes = prices.map(p => p.close);
    const highs = prices.map(p => p.high);
    const lows = prices.map(p => p.low);
    const volumes = prices.map(p => p.volume);

    const current = closes[closes.length - 1]!;
    const prevClose = closes[closes.length - 2]!;

    // Simple Moving Averages
    const sma20 = this.sma(closes, 20);
    const sma50 = this.sma(closes, 50);
    const sma200 = prices.length >= 200 ? this.sma(closes, 200) : sma50;

    // RSI
    const rsi14 = this.rsi(closes, 14);

    // MACD
    const macd = this.macd(closes);

    // ATR
    const atr14 = this.atr(highs, lows, closes, 14);

    // Bollinger Bands
    const bb = this.bollingerBands(closes, 20, 2);

    // Volume average
    const volumeAvg20 = this.sma(volumes, 20);

    // Price changes
    const priceChange = {
      day: (current - prevClose) / prevClose,
      week: closes.length >= 6 ? (current - closes[closes.length - 6]!) / closes[closes.length - 6]! : 0,
      month: closes.length >= 22 ? (current - closes[closes.length - 22]!) / closes[closes.length - 22]! : 0,
    };

    // Support/Resistance (simplified)
    const recentLows = lows.slice(-20);
    const recentHighs = highs.slice(-20);
    const support = Math.min(...recentLows);
    const resistance = Math.max(...recentHighs);

    // Trend determination
    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (current > sma20 && sma20 > sma50 && (prices.length < 200 || sma50 > sma200)) {
      trend = 'bullish';
    } else if (current < sma20 && sma20 < sma50 && (prices.length < 200 || sma50 < sma200)) {
      trend = 'bearish';
    }

    return {
      sma20,
      sma50,
      sma200,
      rsi14,
      macd,
      atr14,
      bollingerBands: bb,
      volumeAvg20,
      priceChange,
      support,
      resistance,
      trend,
    };
  }

  private identifyPatterns(prices: PriceBar[]): Record<string, unknown> {
    const closes = prices.map(p => p.close);
    const highs = prices.map(p => p.high);
    const lows = prices.map(p => p.low);

    const current = closes[closes.length - 1];
    const patterns: string[] = [];

    // Check for higher highs/higher lows (uptrend)
    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    const olderHighs = highs.slice(-20, -10);
    const olderLows = lows.slice(-20, -10);

    if (Math.max(...recentHighs) > Math.max(...olderHighs) &&
        Math.min(...recentLows) > Math.min(...olderLows)) {
      patterns.push('Higher highs and higher lows (uptrend)');
    }

    if (Math.max(...recentHighs) < Math.max(...olderHighs) &&
        Math.min(...recentLows) < Math.min(...olderLows)) {
      patterns.push('Lower highs and lower lows (downtrend)');
    }

    // Check for breakout
    const resistance20 = Math.max(...highs.slice(-20));
    const support20 = Math.min(...lows.slice(-20));

    if (current > resistance20 * 0.98) {
      patterns.push('Near/at 20-day resistance breakout');
    }
    if (current < support20 * 1.02) {
      patterns.push('Near/at 20-day support breakdown');
    }

    // RSI divergence check (simplified)
    const rsiCurrent = this.rsi(closes.slice(-14), 14);
    const rsiOlder = this.rsi(closes.slice(-28, -14), 14);

    if (current > closes[closes.length - 14] && rsiCurrent < rsiOlder) {
      patterns.push('Bearish RSI divergence');
    }
    if (current < closes[closes.length - 14] && rsiCurrent > rsiOlder) {
      patterns.push('Bullish RSI divergence');
    }

    return {
      patterns,
      support20,
      resistance20,
      currentPrice: current,
      distanceToSupport: ((current - support20) / current * 100).toFixed(2) + '%',
      distanceToResistance: ((resistance20 - current) / current * 100).toFixed(2) + '%',
    };
  }

  // Technical indicator calculations
  private sma(data: number[], period: number): number {
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  private rsi(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }

  private macd(closes: number[]): { line: number; signal: number; histogram: number } {
    const ema12 = this.ema(closes, 12);
    const ema26 = this.ema(closes, 26);
    const line = ema12 - ema26;

    // For signal line, we'd need historical MACD values
    // Simplified: use current MACD as approximation
    const signal = line * 0.9; // Simplified
    const histogram = line - signal;

    return { line, signal, histogram };
  }

  private ema(data: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = data[0];

    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }

    return ema;
  }

  private atr(highs: number[], lows: number[], closes: number[], period: number): number {
    const trs: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }

    return this.sma(trs, period);
  }

  private bollingerBands(closes: number[], period: number, stdDev: number): { upper: number; middle: number; lower: number } {
    const middle = this.sma(closes, period);
    const slice = closes.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: middle + stdDev * std,
      middle,
      lower: middle - stdDev * std,
    };
  }
}

/**
 * Fundamental Analyst Agent
 *
 * Specializes in analyzing SEC filings (10-K, 10-Q) to extract
 * insights about business quality, financial health, and growth.
 */

import { type EdgarDataProvider, getEdgarProvider } from "../../data/providers/edgar.js";
import { ResearchAgent, type ResearchAgentDependencies, type ToolDefinition } from "../base.js";
import type { AgentSignal, ResearchAgentConfig, ResearchContext, SignalStrength } from "../types.js";

export class FundamentalAnalyst extends ResearchAgent {
  private edgar: EdgarDataProvider;

  constructor(config: Omit<ResearchAgentConfig, "role">, deps: ResearchAgentDependencies) {
    super({ ...config, role: "fundamental-analyst" }, deps);
    this.edgar = getEdgarProvider();
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: "get_10k_sections",
        description:
          "Get specific sections from the most recent 10-K filing. Sections: business (company overview), risk_factors (key risks), mda (management discussion & analysis)",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
            sections: {
              type: "array",
              items: { type: "string", enum: ["business", "risk_factors", "mda"] },
              description: "Sections to retrieve",
            },
          },
          required: ["symbol", "sections"],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const sections = input.sections as ("business" | "risk_factors" | "mda")[];
          return this.edgar.get10KSections(symbol, sections);
        },
      },
      {
        name: "get_financial_metrics",
        description: "Get key financial metrics from SEC filings (revenue, margins, ratios, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
          },
          required: ["symbol"],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          return this.edgar.getFinancialFacts(symbol);
        },
      },
      {
        name: "get_recent_filings",
        description: "List recent SEC filings for a company",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock ticker symbol" },
            formTypes: {
              type: "array",
              items: { type: "string" },
              description: "Filter by form types (e.g., 10-K, 10-Q, 8-K)",
            },
            limit: { type: "number", description: "Max filings to return" },
          },
          required: ["symbol"],
        },
        handler: async (input: Record<string, unknown>) => {
          const symbol = input.symbol as string;
          const formTypes = input.formTypes as string[] | undefined;
          const limit = (input.limit as number) || 10;
          return this.edgar.getFilings(symbol, formTypes, limit);
        },
      },
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert fundamental analyst at a quantitative hedge fund. Your role is to analyze SEC filings (10-K, 10-Q) to assess business quality and identify investment opportunities.

Your analysis framework:
1. BUSINESS QUALITY
   - Competitive moat (brand, network effects, switching costs, cost advantages)
   - Market position and share trends
   - Management quality and capital allocation
   - Revenue concentration and customer dependency

2. FINANCIAL HEALTH
   - Revenue growth trajectory
   - Margin trends (gross, operating, net)
   - Balance sheet strength (debt levels, liquidity)
   - Cash flow generation and quality
   - Return metrics (ROE, ROIC)

3. RISK ASSESSMENT
   - Key risk factors from filings
   - Industry headwinds
   - Regulatory concerns
   - Competitive threats

4. VALUATION CONTEXT
   - Growth vs. value characteristics
   - Capital intensity
   - Earnings quality

OUTPUT FORMAT:
After your analysis, provide a trading signal in this exact JSON format:

\`\`\`json
{
  "signal": "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL",
  "confidence": 0.0 to 1.0,
  "timeframe": "month" | "quarter",
  "reasoning": "2-3 sentence summary of key thesis",
  "thesis": "One sentence investment thesis",
  "catalysts": ["Expected positive catalysts"],
  "risks": ["Key risks to monitor"],
  "metrics": {
    "revenueGrowth": number or null,
    "grossMargin": number or null,
    "operatingMargin": number or null,
    "debtToEquity": number or null,
    "qualityScore": 1-10
  }
}
\`\`\`

Be rigorous and skeptical. Focus on facts from the filings, not speculation. A HOLD signal is appropriate when the picture is unclear.`;
  }

  protected buildAnalysisPrompt(symbol: string, context: ResearchContext): string {
    let prompt = `Analyze ${symbol} using its SEC filings to determine investment merit.\n\n`;

    // Include existing signals from other agents for context
    if (context.existingSignals && context.existingSignals.length > 0) {
      prompt += `Other analysts have provided these signals:\n`;
      for (const sig of context.existingSignals.slice(0, 3)) {
        prompt += `- ${sig.agentRole}: ${sig.signal} (${sig.confidence.toFixed(2)} confidence) - ${sig.reasoning.slice(0, 100)}\n`;
      }
      prompt += "\n";
    }

    prompt += `Steps:
1. Use get_financial_metrics to get key financial data
2. Use get_10k_sections to read relevant sections (focus on mda and risk_factors)
3. Synthesize findings into a trading signal

Focus your analysis on:
- Is this a high-quality business with durable advantages?
- Are financials improving or deteriorating?
- What are the key risks?
- Is current sentiment justified by fundamentals?

Provide your signal in the JSON format specified.`;

    return prompt;
  }

  protected parseSignals(
    symbol: string,
    response: string,
    _context: ResearchContext,
  ): Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole">[] {
    const signals: Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole">[] = [];

    // Extract JSON from response
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      // Try to find raw JSON object
      const rawJsonMatch = response.match(/\{[\s\S]*"signal"[\s\S]*\}/);
      if (!rawJsonMatch) {
        return signals;
      }

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
      signal: (parsed.signal as SignalStrength) || "HOLD",
      confidence: Math.max(0, Math.min(1, (parsed.confidence as number) || 0.5)),
      timeframe: (parsed.timeframe as "month" | "quarter") || "quarter",
      reasoning: (parsed.reasoning as string) || "Analysis complete",
      thesis: parsed.thesis as string | undefined,
      catalysts: parsed.catalysts as string[] | undefined,
      risks: parsed.risks as string[] | undefined,
      data: parsed.metrics as Record<string, unknown> | undefined,
    };
  }
}

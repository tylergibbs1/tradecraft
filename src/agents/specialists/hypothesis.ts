/**
 * Hypothesis Generator Agent
 *
 * The alpha discovery engine. This agent analyzes outputs from other
 * specialist agents, identifies patterns they might have missed, and
 * generates novel trading hypotheses for validation.
 *
 * This is where the real edge comes from - letting AI discover
 * strategies humans wouldn't think of.
 */

import { v4 as uuidv4 } from "uuid";
import { ResearchAgent, type ResearchAgentDependencies, type ToolDefinition } from "../base.js";
import type {
  AgentSignal,
  ConsensusResult,
  Hypothesis,
  ResearchAgentConfig,
  ResearchContext,
  SignalStrength,
} from "../types.js";

interface HypothesisStore {
  hypotheses: Hypothesis[];
  addHypothesis(h: Omit<Hypothesis, "id" | "createdAt" | "status">): Hypothesis;
  getActive(): Hypothesis[];
  getBySymbol(symbol: string): Hypothesis[];
  updateStatus(id: string, status: Hypothesis["status"]): void;
  prune(maxAge: number): number;
}

function createHypothesisStore(): HypothesisStore {
  const hypotheses: Hypothesis[] = [];

  return {
    hypotheses,

    addHypothesis(h: Omit<Hypothesis, "id" | "createdAt" | "status">): Hypothesis {
      const hypothesis: Hypothesis = {
        ...h,
        id: uuidv4(),
        status: "proposed",
        createdAt: new Date().toISOString(),
      };
      hypotheses.push(hypothesis);
      return hypothesis;
    },

    getActive(): Hypothesis[] {
      return hypotheses.filter((h) => h.status === "active" || h.status === "validating");
    },

    getBySymbol(symbol: string): Hypothesis[] {
      return hypotheses.filter((h) => h.symbols.includes(symbol));
    },

    updateStatus(id: string, status: Hypothesis["status"]): void {
      const h = hypotheses.find((h) => h.id === id);
      if (h) {
        h.status = status;
        if (status === "active") {
          h.validatedAt = new Date().toISOString();
        }
      }
    },

    prune(maxAge: number): number {
      const cutoff = Date.now() - maxAge;
      const before = hypotheses.length;
      const toKeep = hypotheses.filter((h) => {
        if (h.status === "active") return true;
        return new Date(h.createdAt).getTime() > cutoff;
      });
      hypotheses.length = 0;
      hypotheses.push(...toKeep);
      return before - hypotheses.length;
    },
  };
}

export class HypothesisGenerator extends ResearchAgent {
  private hypothesisStore: HypothesisStore;

  constructor(config: Omit<ResearchAgentConfig, "role">, deps: ResearchAgentDependencies) {
    super({ ...config, role: "hypothesis-generator" }, deps);
    this.hypothesisStore = createHypothesisStore();
  }

  protected getTools(): ToolDefinition[] {
    return [
      {
        name: "get_all_signals",
        description: "Get all recent signals from specialist agents across all symbols",
        inputSchema: {
          type: "object",
          properties: {
            maxAge: { type: "number", description: "Max age in hours (default 24)" },
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const maxAge = ((input.maxAge as number) || 24) * 60 * 60 * 1000;
          const signals = this.signalBus.getAllSignals({ maxAge });

          // Group by symbol
          const bySymbol = new Map<string, AgentSignal[]>();
          for (const signal of signals) {
            const existing = bySymbol.get(signal.symbol) || [];
            existing.push(signal);
            bySymbol.set(signal.symbol, existing);
          }

          return {
            totalSignals: signals.length,
            symbols: Array.from(bySymbol.keys()),
            signalsBySymbol: Object.fromEntries(bySymbol),
          };
        },
      },
      {
        name: "get_consensus_overview",
        description: "Get consensus view across all symbols",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          const allConsensus = this.signalBus.getAllConsensus();
          const results: Record<
            string,
            {
              recommendation: SignalStrength;
              confidence: number;
              signalCount: number;
              dissent: boolean;
            }
          > = {};

          for (const [symbol, consensus] of allConsensus) {
            results[symbol] = {
              recommendation: consensus.recommendation,
              confidence: consensus.averageConfidence,
              signalCount: consensus.signalCount,
              dissent: (consensus.dissent?.length || 0) > 0,
            };
          }

          return {
            symbolCount: allConsensus.size,
            consensus: results,
          };
        },
      },
      {
        name: "find_disagreements",
        description: "Find symbols where specialist agents disagree (potential alpha)",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          const allConsensus = this.signalBus.getAllConsensus();
          const disagreements: Array<{
            symbol: string;
            consensus: ConsensusResult;
            conflictingViews: string[];
          }> = [];

          for (const [symbol, consensus] of allConsensus) {
            if (consensus.dissent && consensus.dissent.length > 0) {
              disagreements.push({
                symbol,
                consensus,
                conflictingViews: consensus.dissent,
              });
            }
          }

          return {
            disagreementCount: disagreements.length,
            disagreements,
          };
        },
      },
      {
        name: "find_signal_patterns",
        description: "Analyze patterns in signals across symbols (sector trends, theme clusters)",
        inputSchema: {
          type: "object",
          properties: {},
        },
        handler: async () => {
          const signals = this.signalBus.getAllSignals({ maxAge: 24 * 60 * 60 * 1000 });

          // Analyze patterns
          const byRole = new Map<string, { bullish: number; bearish: number }>();
          const themes = new Map<string, number>();

          for (const signal of signals) {
            // Count by role
            const roleStats = byRole.get(signal.agentRole) || { bullish: 0, bearish: 0 };
            if (signal.signal === "BUY" || signal.signal === "STRONG_BUY") {
              roleStats.bullish++;
            } else if (signal.signal === "SELL" || signal.signal === "STRONG_SELL") {
              roleStats.bearish++;
            }
            byRole.set(signal.agentRole, roleStats);

            // Extract themes from reasoning
            const words = signal.reasoning.toLowerCase().split(/\s+/);
            const themeWords = [
              "growth",
              "value",
              "momentum",
              "quality",
              "risk",
              "margin",
              "revenue",
              "earnings",
              "catalyst",
              "breakout",
              "support",
              "resistance",
              "sentiment",
              "macro",
              "sector",
              "rotation",
            ];

            for (const word of words) {
              if (themeWords.some((t) => word.includes(t))) {
                themes.set(word, (themes.get(word) || 0) + 1);
              }
            }
          }

          return {
            signalCount: signals.length,
            byRole: Object.fromEntries(byRole),
            topThemes: Array.from(themes.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10),
          };
        },
      },
      {
        name: "get_existing_hypotheses",
        description: "Get current hypotheses being tracked",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", description: "Filter by status" },
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const status = input.status as Hypothesis["status"] | undefined;
          let hypotheses = this.hypothesisStore.hypotheses;

          if (status) {
            hypotheses = hypotheses.filter((h) => h.status === status);
          }

          return {
            count: hypotheses.length,
            hypotheses: hypotheses.map((h) => ({
              id: h.id,
              title: h.title,
              symbols: h.symbols,
              expectedReturn: h.expectedReturn,
              confidence: h.confidence,
              status: h.status,
              createdAt: h.createdAt,
            })),
          };
        },
      },
      {
        name: "record_hypothesis",
        description: "Record a new trading hypothesis for tracking",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the hypothesis" },
            description: { type: "string", description: "Detailed description" },
            thesis: { type: "string", description: "One-sentence investment thesis" },
            symbols: {
              type: "array",
              items: { type: "string" },
              description: "Symbols involved",
            },
            expectedReturn: { type: "number", description: "Expected return (e.g., 0.15 for 15%)" },
            timeHorizon: { type: "string", description: "Time horizon (day/week/month/quarter)" },
            confidence: { type: "number", description: "Confidence 0-1" },
            supportingEvidence: {
              type: "array",
              items: { type: "string" },
              description: "Supporting evidence",
            },
            risks: {
              type: "array",
              items: { type: "string" },
              description: "Key risks",
            },
          },
          required: ["title", "thesis", "symbols", "expectedReturn", "confidence"],
        },
        handler: async (input: Record<string, unknown>) => {
          const hypothesis = this.hypothesisStore.addHypothesis({
            title: input.title as string,
            description: (input.description as string) || "",
            thesis: input.thesis as string,
            symbols: input.symbols as string[],
            expectedReturn: input.expectedReturn as number,
            timeHorizon: (input.timeHorizon as Hypothesis["timeHorizon"]) || "month",
            confidence: input.confidence as number,
            supportingEvidence: (input.supportingEvidence as string[]) || [],
            risks: (input.risks as string[]) || [],
          });

          return {
            success: true,
            hypothesis,
          };
        },
      },
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an alpha discovery engine at a quantitative hedge fund. Your role is to analyze the outputs of specialist research agents and identify novel trading opportunities they might have missed.

Your mission is to find alpha - excess returns that can't be explained by market movements. You do this by:

1. CROSS-POLLINATION
   - Look for connections between signals that specialists might miss
   - A fundamental analyst sees strong earnings + technical analyst sees breakout = compound signal
   - Sector rotation + individual stock strength = timing opportunity

2. CONTRARIAN DETECTION
   - Find cases where specialists disagree
   - Disagreement often indicates uncertainty, which can mean opportunity
   - When sentiment is extreme but fundamentals are stable = contrarian play

3. PATTERN RECOGNITION
   - Look for themes across multiple symbols
   - Multiple tech stocks showing margin expansion = sector trend
   - Several companies mentioning same risk factor = emerging theme

4. SECOND-ORDER EFFECTS
   - What do the specialists' findings imply that they didn't explicitly state?
   - Strong competitor results might be bad for the leader
   - Supply chain stress in one company affects others

5. HYPOTHESIS GENERATION
   - Formulate specific, testable trading hypotheses
   - Include expected return, timeframe, and key risks
   - Focus on ideas that are non-obvious and differentiated

OUTPUT FORMAT:
After your analysis, provide any novel hypotheses in this JSON format:

\`\`\`json
{
  "hypotheses": [
    {
      "title": "Short descriptive title",
      "thesis": "One sentence investment thesis",
      "symbols": ["SYMBOL1", "SYMBOL2"],
      "signal": "BUY" | "SELL",
      "expectedReturn": 0.15,
      "timeHorizon": "month",
      "confidence": 0.7,
      "supportingEvidence": ["Evidence 1", "Evidence 2"],
      "risks": ["Risk 1", "Risk 2"],
      "reasoning": "Detailed explanation of the alpha source"
    }
  ],
  "marketObservations": ["Observation 1", "Observation 2"],
  "emergingThemes": ["Theme 1", "Theme 2"]
}
\`\`\`

Be creative but rigorous. The best hypotheses are non-obvious but well-supported by evidence. Don't just repeat what the specialists said - find what they MISSED.`;
  }

  protected buildAnalysisPrompt(_symbol: string, _context: ResearchContext): string {
    // For hypothesis generator, we analyze across all symbols, not just one
    let prompt = `Analyze all specialist agent signals to identify novel alpha opportunities.\n\n`;

    prompt += `Steps:
1. Use get_all_signals to see what specialists have found
2. Use get_consensus_overview to understand the aggregate view
3. Use find_disagreements to identify where specialists conflict
4. Use find_signal_patterns to spot cross-symbol themes
5. Use get_existing_hypotheses to avoid duplicating existing ideas

Look for:
- Compound signals (multiple specialists bullish for different reasons)
- Contrarian opportunities (extreme sentiment vs stable fundamentals)
- Cross-symbol patterns (sector themes, supply chain effects)
- Second-order effects (implications specialists didn't state)
- Disagreements that suggest uncertainty and opportunity

For each novel idea, use record_hypothesis to track it.

Provide your findings in the JSON format specified. Focus on NON-OBVIOUS insights.`;

    return prompt;
  }

  protected parseSignals(
    _symbol: string,
    response: string,
    _context: ResearchContext,
  ): Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole">[] {
    const signals: Omit<AgentSignal, "id" | "timestamp" | "agentId" | "agentRole">[] = [];

    // Extract JSON from response
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) return signals;

    try {
      const parsed = JSON.parse(jsonMatch[1]);

      if (parsed.hypotheses && Array.isArray(parsed.hypotheses)) {
        for (const h of parsed.hypotheses) {
          // Create a signal for each hypothesis
          for (const sym of h.symbols || []) {
            signals.push({
              symbol: sym,
              signal: h.signal === "SELL" ? "SELL" : "BUY",
              confidence: h.confidence || 0.6,
              timeframe: h.timeHorizon || "month",
              reasoning: h.reasoning || h.thesis,
              thesis: h.thesis,
              catalysts: h.supportingEvidence,
              risks: h.risks,
              data: {
                hypothesisTitle: h.title,
                expectedReturn: h.expectedReturn,
                isNovelHypothesis: true,
              },
            });
          }
        }
      }
    } catch {
      // Failed to parse JSON
    }

    return signals;
  }

  /**
   * Get all tracked hypotheses
   */
  getHypotheses(): Hypothesis[] {
    return [...this.hypothesisStore.hypotheses];
  }

  /**
   * Get active hypotheses
   */
  getActiveHypotheses(): Hypothesis[] {
    return this.hypothesisStore.getActive();
  }

  /**
   * Update hypothesis status (e.g., after backtesting)
   */
  updateHypothesisStatus(id: string, status: Hypothesis["status"]): void {
    this.hypothesisStore.updateStatus(id, status);
  }

  /**
   * Prune old hypotheses
   */
  pruneHypotheses(maxAge: number = 7 * 24 * 60 * 60 * 1000): number {
    return this.hypothesisStore.prune(maxAge);
  }
}

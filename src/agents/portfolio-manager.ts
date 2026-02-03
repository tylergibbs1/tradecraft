/**
 * Portfolio Manager Agent (Orchestrator)
 *
 * The top-level agent that orchestrates specialist research agents,
 * aggregates their signals via consensus, and makes final trading decisions.
 *
 * This is the only agent that can execute trades.
 */

import { v4 as uuidv4 } from 'uuid';
import { query, createSdkMcpServer, tool, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  AgentSignal,
  AgentRole,
  ConsensusResult,
  ResearchAgentConfig,
  AgentCycleContext,
  AgentWeights,
  DEFAULT_AGENT_WEIGHTS,
  PriceBar,
  SwarmCallbacks,
  SwarmCycleResult,
  TradeDecision,
  AgentAnalysisResult,
} from './types.js';
import { SignalBus, getSharedSignalBus } from './signal-bus.js';
import { ResearchAgent, AnalysisCycleResult } from './base.js';
import {
  FundamentalAnalyst,
  TechnicalAnalyst,
  SentimentAnalyst,
  MacroAnalyst,
} from './specialists/index.js';

export interface PortfolioManagerConfig {
  agentId: string;
  model: string;
  maxTokens: number;
  tradingUniverse: string[];
  maxPositions: number;
  maxPositionSize: number;  // As fraction of equity (e.g., 0.10 = 10%)
  minConsensusConfidence: number;  // Min confidence to act on signal
  weights?: Partial<AgentWeights>;
}

export interface PortfolioManagerDependencies {
  apiKey: string;
  signalBus?: SignalBus;
  priceDataFetcher: (symbol: string, days: number) => Promise<PriceBar[]>;
  exaApiKey?: string;
  callbacks?: SwarmCallbacks;
  // Optional execution deps for trading via SDK tools
  portfolioManager?: import('../portfolio/manager.js').PortfolioManager;
  riskMonitor?: import('../risk/monitor.js').RiskMonitor;
  dataManager?: import('../data/index.js').DataManager;
}

// TradeDecision and SwarmCycleResult are imported from types.ts

export class PortfolioManagerAgent {
  private config: PortfolioManagerConfig;
  private signalBus: SignalBus;
  private specialists: ResearchAgent[];
  private weights: AgentWeights;
  private callbacks?: SwarmCallbacks;
  private execDeps?: {
    portfolioManager: import('../portfolio/manager.js').PortfolioManager;
    riskMonitor: import('../risk/monitor.js').RiskMonitor;
    dataManager: import('../data/index.js').DataManager;
  };

  constructor(
    config: PortfolioManagerConfig,
    deps: PortfolioManagerDependencies
  ) {
    this.config = config;
    this.signalBus = deps.signalBus || getSharedSignalBus();
    this.weights = { ...DEFAULT_AGENT_WEIGHTS, ...config.weights };
    this.callbacks = deps.callbacks;
    if (deps.portfolioManager && deps.riskMonitor && deps.dataManager) {
      this.execDeps = {
        portfolioManager: deps.portfolioManager,
        riskMonitor: deps.riskMonitor,
        dataManager: deps.dataManager,
      };
    }

    // Update signal bus weights
    this.signalBus.setWeights(this.weights);

    // Initialize specialist agents with callbacks
    const baseConfig = {
      model: config.model,
      maxTokens: config.maxTokens,
      signalThreshold: 0.5,
    };

    this.specialists = [
      new FundamentalAnalyst(
        { ...baseConfig, agentId: `${config.agentId}-fundamental` },
        { apiKey: deps.apiKey, signalBus: this.signalBus, callbacks: this.callbacks }
      ),
      new TechnicalAnalyst(
        { ...baseConfig, agentId: `${config.agentId}-technical` },
        { apiKey: deps.apiKey, signalBus: this.signalBus, priceDataFetcher: deps.priceDataFetcher, callbacks: this.callbacks }
      ),
      new SentimentAnalyst(
        { ...baseConfig, agentId: `${config.agentId}-sentiment` },
        { apiKey: deps.apiKey, signalBus: this.signalBus, exaApiKey: deps.exaApiKey, callbacks: this.callbacks }
      ),
      new MacroAnalyst(
        { ...baseConfig, agentId: `${config.agentId}-macro` },
        { apiKey: deps.apiKey, signalBus: this.signalBus, priceDataFetcher: deps.priceDataFetcher, callbacks: this.callbacks }
      ),
    ];
  }

  /**
   * Update callbacks dynamically
   */
  setCallbacks(callbacks: SwarmCallbacks): void {
    this.callbacks = callbacks;
    // Update callbacks on all specialists
    for (const specialist of this.specialists) {
      specialist.setCallbacks(callbacks);
    }
  }

  /**
   * Run a full swarm cycle:
   * 1. Run all specialist agents in parallel
   * 2. Aggregate signals via consensus
   * 3. Make trade decisions
   */
  async runSwarmCycle(
    cycleContext: AgentCycleContext,
    options?: {
      symbolsToAnalyze?: string[];  // Subset of universe to focus on
      parallelSpecialists?: boolean;
    }
  ): Promise<SwarmCycleResult> {
    const cycleId = uuidv4();
    const startedAt = new Date().toISOString();
    const symbols = options?.symbolsToAnalyze || this.config.tradingUniverse;
    const runParallel = options?.parallelSpecialists ?? true;

    // Emit cycle start callback
    this.callbacks?.onCycleStart?.(cycleId);

    // Prune stale signals before new cycle
    this.signalBus.pruneStale();

    const specialistResults: AnalysisCycleResult[] = [];
    let totalTokensUsed = 0;

    try {
      // Run specialist agents
      if (runParallel) {
        // Run all specialists in parallel
        const results = await Promise.all(
          this.specialists.map(specialist =>
            specialist.runCycle(symbols, cycleContext)
          )
        );
        specialistResults.push(...results);
      } else {
        // Run sequentially (for debugging or rate limit concerns)
        for (const specialist of this.specialists) {
          const result = await specialist.runCycle(symbols, cycleContext);
          specialistResults.push(result);
        }
      }

      // Sum up tokens
      for (const result of specialistResults) {
        totalTokensUsed += result.tokensUsed;
      }

      // Get consensus for each symbol and emit updates
      const tradeDecisions: TradeDecision[] = [];

      for (const symbol of symbols) {
        const consensus = this.signalBus.getConsensus(symbol, this.weights);

        // Emit consensus update callback
        this.callbacks?.onConsensusUpdate?.(symbol, consensus);

        // Only act on signals with sufficient confidence
        if (consensus.signalCount > 0 &&
            consensus.averageConfidence >= this.config.minConsensusConfidence) {
          const decision = this.makeTradeDecision(symbol, consensus, cycleContext);
          if (decision.action !== 'HOLD') {
            tradeDecisions.push(decision);
          }
        }
      }

      // Prioritize decisions by consensus strength
      tradeDecisions.sort((a, b) =>
        Math.abs(b.consensus.weightedScore) - Math.abs(a.consensus.weightedScore)
      );

      const result: SwarmCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        symbolsAnalyzed: symbols,
        specialistResults,
        tradeDecisions,
        totalTokensUsed,
        totalCostUsd: (totalTokensUsed / 1_000_000) * 9,
      };

      // If execution deps provided, let Claude execute trades via SDK tools
      if (this.execDeps && tradeDecisions.length > 0) {
        try {
          const execTokens = await this.executeDecisionsWithClaude(tradeDecisions);
          totalTokensUsed += execTokens;
          result.totalTokensUsed = totalTokensUsed;
          result.totalCostUsd = (totalTokensUsed / 1_000_000) * 9;
        } catch (e) {
          // Non-fatal, include error in result
          (result as any).executionError = String(e);
        }
      }

      // Emit cycle complete callback
      this.callbacks?.onCycleComplete?.(result);

      return result;
    } catch (error) {
      const result: SwarmCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        symbolsAnalyzed: symbols,
        specialistResults,
        tradeDecisions: [],
        totalTokensUsed,
        totalCostUsd: (totalTokensUsed / 1_000_000) * 9,
        error: String(error),
      };

      // Emit cycle complete callback even on error
      this.callbacks?.onCycleComplete?.(result);

      return result;
    }
  }

  // Execute trade decisions by invoking trading MCP tools via Agent SDK
  private async executeDecisionsWithClaude(tradeDecisions: TradeDecision[]): Promise<number> {
    if (!this.execDeps) return 0;
    const { portfolioManager, riskMonitor, dataManager } = this.execDeps;

    const { createTradingTools } = await import('../agent/mcp-server.js');
    const toolDefs = createTradingTools({
      portfolioManager,
      riskMonitor,
      dataManager,
      tradingUniverse: this.config.tradingUniverse,
    } as any);

    const toRawShape = (schema: unknown): Record<string, z.ZodTypeAny> => {
      const zobj = schema as z.ZodObject<any>;
      return (zobj as any).shape || (zobj as any)._def?.shape?.();
    };

    const sdkTools = Object.entries(toolDefs).map(([name, def]) =>
      tool(name, def.description, toRawShape(def.inputSchema), async (args) => {
        const res = await def.handler(args as any);
        return { content: [{ type: 'text', text: JSON.stringify(res) }] };
      })
    );

    const mcp = createSdkMcpServer({ name: 'pm-trading', tools: sdkTools });

    const plan = tradeDecisions
      .map(d => `${d.symbol}: ${d.action}${d.quantity ? ' ' + d.quantity : ''} (confidence ${(d.confidence * 100).toFixed(0)}%)`)
      .join('\n');

    const system = `You are the portfolio manager. Execute trades safely:
- Validate risk using get_risk_status and current portfolio state.
- Use get_market_data to confirm prices.
- Place orders via place_order when justified.
- Only act on the provided plan and symbols.
- Keep output concise.`;

    const user = `Trade plan for this cycle:\n${plan}\n\nUse tools to validate and execute.`;

    let usedTokens = 0;
    const options: Options = {
      systemPrompt: system,
      model: this.config.model,
      maxTurns: 10,
      mcpServers: { trading: mcp },
      allowedTools: ['get_risk_status','get_portfolio','get_market_data','place_order','cancel_order'],
      includePartialMessages: true,
    };

    for await (const msg of query({ prompt: user, options })) {
      if ((msg as any).type === 'result' && (msg as any).subtype === 'success') {
        const res: any = msg;
        const u = res.usage;
        if (u) usedTokens += (u.input_tokens || 0) + (u.output_tokens || 0);
      }
    }

    return usedTokens;
  }

  /**
   * Make a trade decision based on consensus
   */
  private makeTradeDecision(
    symbol: string,
    consensus: ConsensusResult,
    context: AgentCycleContext
  ): TradeDecision {
    const position = context.portfolioSnapshot.positions.get(symbol);
    const hasPosition = position && position.quantity > 0;

    // Determine action based on consensus
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (consensus.recommendation === 'STRONG_BUY' || consensus.recommendation === 'BUY') {
      if (!hasPosition) {
        action = 'BUY';
      } else {
        action = 'HOLD'; // Already have position
      }
    } else if (consensus.recommendation === 'STRONG_SELL' || consensus.recommendation === 'SELL') {
      if (hasPosition) {
        action = 'SELL';
      } else {
        action = 'HOLD'; // No position to sell (no shorting in this version)
      }
    }

    // Calculate position size based on consensus strength
    let quantity: number | undefined;
    if (action === 'BUY') {
      const equity = context.portfolioSnapshot.equity;
      const maxPositionValue = equity * this.config.maxPositionSize;
      const targetValue = maxPositionValue * consensus.positionSizeMultiplier;

      // Get approximate price from position or signals
      const price = position?.currentPrice ||
        (consensus.signals[0]?.priceTarget || 100); // Fallback

      quantity = Math.floor(targetValue / price);
    } else if (action === 'SELL' && position) {
      quantity = position.quantity; // Sell entire position
    }

    // Build reason from top signals
    const topSignals = consensus.signals.slice(0, 3);
    const reason = topSignals
      .map(s => `${s.agentRole}: ${s.reasoning.slice(0, 100)}`)
      .join(' | ');

    return {
      symbol,
      action,
      quantity,
      reason,
      consensus,
      confidence: consensus.averageConfidence,
    };
  }

  /**
   * Get current consensus for all symbols
   */
  getAllConsensus(): Map<string, ConsensusResult> {
    return this.signalBus.getAllConsensus(this.weights);
  }

  /**
   * Get top buy recommendations
   */
  getTopBuys(limit: number = 5): ConsensusResult[] {
    return this.signalBus.getTopRecommendations(limit, 'buy');
  }

  /**
   * Get top sell recommendations
   */
  getTopSells(limit: number = 5): ConsensusResult[] {
    return this.signalBus.getTopRecommendations(limit, 'sell');
  }

  /**
   * Get signals by role
   */
  getSignalsByRole(): Map<AgentRole, number> {
    return this.signalBus.getSignalCountByRole();
  }

  /**
   * Get dissenting views for a symbol
   */
  getDissent(symbol: string): string[] | undefined {
    return this.signalBus.getConsensus(symbol).dissent;
  }

  /**
   * Update agent weights
   */
  setWeights(weights: Partial<AgentWeights>): void {
    this.weights = { ...this.weights, ...weights };
    this.signalBus.setWeights(this.weights);
  }

  /**
   * Get current weights
   */
  getWeights(): AgentWeights {
    return { ...this.weights };
  }

  /**
   * Add a custom specialist agent
   */
  addSpecialist(specialist: ResearchAgent): void {
    this.specialists.push(specialist);
  }

  /**
   * Get specialist agents
   */
  getSpecialists(): ResearchAgent[] {
    return [...this.specialists];
  }

  /**
   * Clear all signals (for testing or reset)
   */
  clearSignals(): void {
    this.signalBus.clear();
  }
}

/**
 * Create a simple swarm for quick setup
 */
export function createSwarm(
  config: {
    apiKey: string;
    tradingUniverse: string[];
    model?: string;
    priceDataFetcher: (symbol: string, days: number) => Promise<PriceBar[]>;
    exaApiKey?: string;
    callbacks?: SwarmCallbacks;
    // Optional execution deps for trading
    portfolioManager?: import('../portfolio/manager.js').PortfolioManager;
    riskMonitor?: import('../risk/monitor.js').RiskMonitor;
    dataManager?: import('../data/index.js').DataManager;
  }
): PortfolioManagerAgent {
  return new PortfolioManagerAgent(
    {
      agentId: 'swarm-pm',
      model: config.model || 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      tradingUniverse: config.tradingUniverse,
      maxPositions: 10,
      maxPositionSize: 0.10,
      minConsensusConfidence: 0.5,
    },
    {
      apiKey: config.apiKey,
      priceDataFetcher: config.priceDataFetcher,
      exaApiKey: config.exaApiKey,
      callbacks: config.callbacks,
      portfolioManager: config.portfolioManager,
      riskMonitor: config.riskMonitor,
      dataManager: config.dataManager,
    }
  );
}

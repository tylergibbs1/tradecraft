/**
 * Swarm Trading Agent Adapter
 *
 * Wraps PortfolioManagerAgent to implement ITradingAgent interface.
 * Translates SwarmCycleResult -> AgentCycleResult and executes trade
 * decisions through the existing place_order tool (preserving risk validation).
 */

import { v4 as uuidv4 } from "uuid";
import { createSwarm, type PortfolioManagerAgent, type TradeDecision } from "../agents/portfolio-manager.js";
import type { AgentCycleContext } from "../agents/types.js";
import type { Config } from "../config/index.js";
import type { DataManager } from "../data/index.js";
import type { PortfolioManager } from "../portfolio/manager.js";
import type { PortfolioSnapshot, RiskMonitor } from "../risk/monitor.js";
import type { AgentCycleResult, AgentMessage, AgentState, ITradingAgent } from "./types.js";

export interface SwarmAgentCallbacks {
  onStateChange?: (state: AgentState) => void;
  onMessage?: (message: AgentMessage) => void;
  onCycleComplete?: (result: AgentCycleResult) => void;
}

export interface SwarmAgentDependencies {
  config: Config;
  portfolioManager: PortfolioManager;
  riskMonitor: RiskMonitor;
  dataManager: DataManager;
}

export class SwarmTradingAgent implements ITradingAgent {
  private state: AgentState = "stopped";
  private deps: SwarmAgentDependencies;
  private callbacks: SwarmAgentCallbacks;
  private swarm: PortfolioManagerAgent;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private cycleIntervalMs: number;

  constructor(deps: SwarmAgentDependencies, callbacks: SwarmAgentCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
    this.cycleIntervalMs = deps.config.agentParams.cycleIntervalMs;

    const apiKey = deps.config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key not configured");
    }

    const swarmParams = deps.config.swarmParams;

    this.swarm = createSwarm({
      apiKey,
      tradingUniverse: deps.config.tradingUniverse.symbols,
      model: swarmParams.specialistModel,
      priceDataFetcher: async (symbol: string, days: number) => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const bars = await deps.dataManager.getHistory(symbol, "1d", startDate, endDate);
        return bars.map((b) => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));
      },
    });

    // Apply custom weights if configured
    if (swarmParams.weights) {
      this.swarm.setWeights(swarmParams.weights);
    }
  }

  private emitMessage(type: AgentMessage["type"], content: string): void {
    const message: AgentMessage = {
      id: uuidv4(),
      type,
      content,
      timestamp: new Date().toISOString(),
    };
    this.callbacks.onMessage?.(message);
  }

  private setState(newState: AgentState): void {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
    this.emitMessage("system", `Swarm agent state: ${newState}`);
  }

  getState(): AgentState {
    return this.state;
  }

  start(): void {
    if (this.state === "running") return;
    this.setState("running");
    this.scheduleCycle();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.setState("paused");
    this.clearCycleTimer();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.setState("running");
    this.scheduleCycle();
  }

  stop(): void {
    this.setState("stopped");
    this.clearCycleTimer();
  }

  halt(): void {
    this.setState("halted");
    this.clearCycleTimer();
  }

  private clearCycleTimer(): void {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  private scheduleCycle(): void {
    this.clearCycleTimer();
    if (this.state !== "running") return;

    this.runCycle().then(() => {
      if (this.state === "running") {
        this.cycleTimer = setTimeout(() => this.scheduleCycle(), this.cycleIntervalMs);
      }
    });
  }

  async runSingleCycle(): Promise<AgentCycleResult> {
    const previousState = this.state;
    this.state = "running";
    try {
      return await this.runCycle();
    } finally {
      this.state = previousState;
    }
  }

  private async runCycle(): Promise<AgentCycleResult> {
    const cycleId = uuidv4();
    const startedAt = new Date().toISOString();

    this.emitMessage("system", `Starting swarm cycle ${cycleId.slice(0, 8)}`);

    try {
      // Build cycle context
      const _portfolioState = this.deps.portfolioManager.getState();
      const positions = this.deps.portfolioManager.getPositions();

      // Update prices
      if (positions.length > 0) {
        const quotes = await this.deps.dataManager.getQuotes(positions.map((p) => p.symbol));
        this.deps.portfolioManager.updatePrices(quotes);
      }

      const updatedState = this.deps.portfolioManager.getState();
      const positionsMap = new Map<string, { quantity: number; averageCost: number; currentPrice: number }>();
      for (const pos of positions) {
        positionsMap.set(pos.symbol, {
          quantity: pos.quantity,
          averageCost: pos.averageCost,
          currentPrice: pos.currentPrice,
        });
      }

      const snapshot: PortfolioSnapshot = {
        cash: updatedState.cash,
        equity: updatedState.equity,
        positions: positionsMap,
        dailyPnL: updatedState.dailyPnL,
        weeklyPnL: updatedState.weeklyPnL,
        peakEquity: updatedState.peakEquity,
      };

      const riskStatus = this.deps.riskMonitor.getStatus(snapshot);

      const cycleContext: AgentCycleContext = {
        cycleId,
        timestamp: new Date().toISOString(),
        tradingUniverse: this.deps.config.tradingUniverse.symbols,
        portfolioSnapshot: {
          cash: updatedState.cash,
          equity: updatedState.equity,
          positions: positionsMap,
        },
        riskStatus: {
          canTrade: riskStatus.canTrade,
          circuitBreaker: riskStatus.circuitBreaker.state,
          currentDrawdown: riskStatus.currentDrawdown,
        },
      };

      // Run the swarm cycle
      this.emitMessage("system", "Running specialist agents...");
      const swarmResult = await this.swarm.runSwarmCycle(cycleContext, {
        parallelSpecialists: this.deps.config.swarmParams.parallelSpecialists,
      });

      // Report specialist results
      for (const sr of swarmResult.specialistResults) {
        this.emitMessage(
          "assistant",
          `[${sr.role}] Analyzed ${sr.symbolsAnalyzed.join(",")} — ${sr.signalsPublished} signals (${sr.tokensUsed} tokens)`,
        );
      }

      // Execute trade decisions through portfolio manager (preserves risk validation)
      let ordersPlaced = 0;
      for (const decision of swarmResult.tradeDecisions) {
        if (!riskStatus.canTrade) {
          this.emitMessage("system", "Circuit breaker active — skipping trades");
          break;
        }

        const result = await this.executeTrade(decision);
        if (result) ordersPlaced++;
      }

      const agentResult: AgentCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        turnsUsed: swarmResult.specialistResults.length,
        tokensUsed: swarmResult.totalTokensUsed,
        costUsd: swarmResult.totalCostUsd,
        ordersPlaced,
        ordersCancelled: 0,
      };

      this.callbacks.onCycleComplete?.(agentResult);
      this.emitMessage(
        "system",
        `Swarm cycle complete: ${ordersPlaced} orders, ${swarmResult.tradeDecisions.length} decisions, $${swarmResult.totalCostUsd.toFixed(4)}`,
      );

      return agentResult;
    } catch (error) {
      const result: AgentCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        turnsUsed: 0,
        tokensUsed: 0,
        costUsd: 0,
        ordersPlaced: 0,
        ordersCancelled: 0,
        error: String(error),
      };
      this.emitMessage("error", `Swarm cycle error: ${error}`);
      this.callbacks.onCycleComplete?.(result);
      return result;
    }
  }

  private async executeTrade(decision: TradeDecision): Promise<boolean> {
    if (decision.action === "HOLD" || !decision.quantity || decision.quantity <= 0) {
      return false;
    }

    try {
      const quote = await this.deps.dataManager.getQuote(decision.symbol);

      // Risk validation
      const positions = this.deps.portfolioManager.getPositions();
      const quotes = await this.deps.dataManager.getQuotes(positions.map((p) => p.symbol));
      this.deps.portfolioManager.updatePrices(quotes);

      const state = this.deps.portfolioManager.getState();
      const positionsMap = new Map<string, { quantity: number; averageCost: number; currentPrice: number }>();
      for (const pos of positions) {
        const q = quotes.get(pos.symbol);
        positionsMap.set(pos.symbol, {
          quantity: pos.quantity,
          averageCost: pos.averageCost,
          currentPrice: q?.last ?? pos.currentPrice,
        });
      }

      const snapshot: PortfolioSnapshot = {
        cash: state.cash,
        equity: state.equity,
        positions: positionsMap,
        dailyPnL: state.dailyPnL,
        weeklyPnL: state.weeklyPnL,
        peakEquity: state.peakEquity,
      };

      const side = decision.action === "BUY" ? ("buy" as const) : ("sell" as const);
      const validation = this.deps.riskMonitor.preValidate(
        { symbol: decision.symbol, side, type: "market", quantity: decision.quantity },
        snapshot,
        quote.last,
      );

      if (!validation.valid) {
        this.emitMessage("tool_result", `Order rejected: ${decision.symbol} ${side} — ${validation.reason}`);
        return false;
      }

      // Execute
      const order = this.deps.portfolioManager.createOrder(decision.symbol, side, "market", decision.quantity);
      this.deps.portfolioManager.submitOrder(order.id);

      const fillPrice = side === "buy" ? (quote.ask ?? quote.last) : (quote.bid ?? quote.last);
      const fillResult = this.deps.portfolioManager.fillOrder(order.id, fillPrice);

      if (fillResult) {
        this.deps.riskMonitor.recordTradeSuccess();
        this.emitMessage(
          "tool_result",
          `${side.toUpperCase()} ${decision.quantity} ${decision.symbol} @ $${fillPrice.toFixed(2)} — ${decision.reason.slice(0, 100)}`,
        );
        return true;
      }
    } catch (error) {
      this.emitMessage("error", `Trade execution error: ${decision.symbol} — ${error}`);
    }

    return false;
  }
}

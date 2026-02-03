import { v4 as uuidv4 } from "uuid";
import { query, createSdkMcpServer, tool, type Options, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Config } from "../config/index.js";
import { PortfolioManager } from "../portfolio/manager.js";
import { RiskMonitor } from "../risk/monitor.js";
import { DataManager } from "../data/index.js";
import { createTradingTools, type TradingMCPServerDeps } from "./mcp-server.js";
import { createCanUseTool as createRiskCanUseTool } from "./permissions.js";
import { AgentLogger, createHooks } from "./hooks.js";
import { buildSystemPrompt, buildCyclePrompt } from "./prompts.js";
import type { AgentState, AgentMessage, AgentCycleResult, AgentConfig } from "./types.js";

export interface AgentDependencies {
  config: Config;
  portfolioManager: PortfolioManager;
  riskMonitor: RiskMonitor;
  dataManager: DataManager;
}

export interface AgentCallbacks {
  onStateChange?: (state: AgentState) => void;
  onMessage?: (message: AgentMessage) => void;
  onCycleComplete?: (result: AgentCycleResult) => void;
}

export class SdkTradingAgent {
  private config: AgentConfig;
  private deps: AgentDependencies;
  private callbacks: AgentCallbacks;
  private state: { current: AgentState } = { current: "stopped" };
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private logger: AgentLogger;
  private tradingUniverse: string[];
  private allowShorts: boolean;
  private cycleInProgress = false;

  constructor(deps: AgentDependencies, callbacks: AgentCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
    this.config = deps.config.agentParams;
    this.tradingUniverse = deps.config.tradingUniverse.symbols;
    this.allowShorts = deps.config.tradingUniverse.allowShorts;

    const apiKey = deps.config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Anthropic API key not configured");
    }

    this.logger = new AgentLogger({
      agentState: this.state,
      onMessage: (content, type) => {
        this.emitMessage(type as AgentMessage["type"], content);
      },
    });
  }

  private emitMessage(type: AgentMessage["type"], content: string, metadata?: Record<string, unknown>): void {
    const message: AgentMessage = {
      id: uuidv4(),
      type,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };
    this.callbacks.onMessage?.(message);
  }

  private setState(newState: AgentState): void {
    this.state.current = newState;
    this.callbacks.onStateChange?.(newState);
    this.emitMessage("system", `Agent state changed to: ${newState}`);
  }

  getState(): AgentState {
    return this.state.current;
  }

  start(): void {
    if (this.state.current === "running") return;
    this.setState("running");
    this.scheduleCycle();
  }

  pause(): void {
    if (this.state.current !== "running") return;
    this.setState("paused");
    this.clearCycleTimer();
  }

  resume(): void {
    if (this.state.current !== "paused") return;
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
    if (this.state.current !== "running") return;
    this.runCycle().catch(err => this.emitMessage("error", `Cycle scheduler error: ${err}`)).finally(() => {
      if (this.state.current === "running") {
        this.cycleTimer = setTimeout(() => this.scheduleCycle(), this.config.cycleIntervalMs);
      }
    });
  }

  async runSingleCycle(): Promise<AgentCycleResult> {
    const prev = this.state.current;
    this.state.current = "running";
    try {
      return await this.runCycle();
    } finally {
      this.state.current = prev;
    }
  }

  async runCycle(): Promise<AgentCycleResult> {
    if (this.cycleInProgress) {
      return {
        cycleId: "skipped",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        turnsUsed: 0,
        tokensUsed: 0,
        costUsd: 0,
        ordersPlaced: 0,
        ordersCancelled: 0,
        error: "Previous cycle still in progress",
      };
    }

    this.cycleInProgress = true;
    const cycleId = uuidv4();
    const startedAt = new Date().toISOString();
    let tokensUsed = 0;
    let ordersPlaced = 0;
    let ordersCancelled = 0;

    this.logger.startCycle(cycleId);
    this.emitMessage("system", `Starting trading cycle ${cycleId.slice(0, 8)}`);

    try {
      // Update prices on any open positions
      const positions = this.deps.portfolioManager.getPositions();
      if (positions.length > 0) {
        const quotes = await this.deps.dataManager.getQuotes(positions.map(p => p.symbol));
        this.deps.portfolioManager.updatePrices(quotes);
      }

      const portfolioState = this.deps.portfolioManager.getState();
      const riskStatus = this.deps.riskMonitor.getStatus({
        cash: portfolioState.cash,
        equity: portfolioState.equity,
        positions: new Map(Object.entries(portfolioState.positions).map(([sym, p]) => [sym, { quantity: p.quantity, averageCost: p.averageCost, currentPrice: p.currentPrice }])),
        dailyPnL: portfolioState.dailyPnL,
        weeklyPnL: portfolioState.weeklyPnL,
        peakEquity: portfolioState.peakEquity,
      });

      const systemPrompt = buildSystemPrompt(this.tradingUniverse, this.allowShorts);
      const userPrompt = buildCyclePrompt(portfolioState, riskStatus);

      // Build MCP server with trading tools
      const toolDeps: TradingMCPServerDeps = {
        portfolioManager: this.deps.portfolioManager,
        riskMonitor: this.deps.riskMonitor,
        dataManager: this.deps.dataManager,
        tradingUniverse: this.tradingUniverse,
        polygonApiKey: this.deps.config.dataProviderApiKey,
      };
      const tradingTools = createTradingTools(toolDeps);

      // Convert Zod object schemas to raw shapes expected by tool()
      const toRawShape = (schema: unknown): Record<string, z.ZodTypeAny> => {
        const zobj = schema as z.ZodObject<any>;
        // @ts-ignore - access internal shape regardless of zod v3/v4
        return (zobj as any).shape || (zobj as any)._def?.shape();
      };

      const sdkTools = Object.entries(tradingTools).map(([name, def]) =>
        tool(name, def.description, toRawShape(def.inputSchema), async (args) => {
          const result = await def.handler(args as any);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        })
      );

      const mcp = createSdkMcpServer({ name: "trading", tools: sdkTools });

      // Permission mapping: reuse existing risk validator
      const riskCanUse = createRiskCanUseTool({
        riskMonitor: this.deps.riskMonitor,
        portfolioManager: this.deps.portfolioManager,
        dataManager: this.deps.dataManager,
        agentState: this.state,
      });

      const canUseTool: CanUseTool = async (toolName, input) => {
        const res = await riskCanUse({ tool: toolName, input: input as any });
        const out: PermissionResult = res.allowed
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: res.reason || "Denied" };
        return out;
      };

      // Hooks for tool metrics and streaming
      const hooks = createHooks(this.logger, this.state);

      const options: Options = {
        systemPrompt,
        model: this.config.model,
        maxTurns: this.config.maxTurns,
        mcpServers: { trading: mcp },
        allowedTools: Object.keys(tradingTools),
        includePartialMessages: true,
        canUseTool,
        hooks: {
          PreToolUse: [{ matcher: ".*", hooks: [async (input) => {
            const tool = (input as any).tool_name || "unknown";
            const start = Date.now();
            this.callbacks.onMessage?.({ id: uuidv4(), type: "tool_use", content: tool, timestamp: new Date().toISOString() });
            // re-use logger pre-call pathway
            await hooks.preToolUse(tool, (input as any).tool_input);
            return { continue: true };
          }] }],
          PostToolUse: [{ matcher: ".*", hooks: [async (input) => {
            const tool = (input as any).tool_name || "unknown";
            await hooks.postToolUse(tool, (input as any).tool_input, (input as any).tool_response, { startTime: Date.now() });
            if (tool === "place_order" && (input as any).tool_response?.success) ordersPlaced++;
            if (tool === "cancel_order" && (input as any).tool_response?.success) ordersCancelled++;
            this.callbacks.onMessage?.({ id: uuidv4(), type: "tool_result", content: tool, timestamp: new Date().toISOString() });
            return { continue: true };
          }] }],
        },
      };

      let resultText = "";

      for await (const msg of query({ prompt: userPrompt, options })) {
        if (msg.type === "stream_event") {
          const ev: any = (msg as any).event;
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            const text = ev.delta.text as string;
            if (text) this.emitMessage("assistant", text);
          }
        }

        // Capture final result and usage when available
        if ((msg as any).type === "result" && (msg as any).subtype === "success") {
          const res = msg as any;
          resultText = (res.result || "").toString();
          const usage = res.usage;
          if (usage) tokensUsed += (usage.input_tokens || 0) + (usage.output_tokens || 0);
        }
      }

      const completedAt = new Date().toISOString();
      const result: AgentCycleResult = {
        cycleId,
        startedAt,
        completedAt,
        turnsUsed: this.config.maxTurns, // upper bound; SDK result has num_turns but not on every event
        tokensUsed,
        costUsd: this.estimateCost(tokensUsed),
        ordersPlaced,
        ordersCancelled,
      };

      this.logger.endCycle();
      this.callbacks.onCycleComplete?.(result);
      return result;
    } catch (error) {
      const result: AgentCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        turnsUsed: 0,
        tokensUsed,
        costUsd: this.estimateCost(tokensUsed),
        ordersPlaced,
        ordersCancelled,
        error: String(error),
      };
      this.logger.endCycle(String(error));
      this.emitMessage("error", `Cycle error: ${error}`);
      this.callbacks.onCycleComplete?.(result);
      return result;
    } finally {
      this.cycleInProgress = false;
    }
  }

  private estimateCost(tokens: number): number {
    return (tokens / 1_000_000) * 9;
  }
}


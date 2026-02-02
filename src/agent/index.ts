import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import { Config } from "../config/index.js";
import { PortfolioManager } from "../portfolio/manager.js";
import { RiskMonitor, PortfolioSnapshot } from "../risk/monitor.js";
import { DataManager } from "../data/index.js";
import { createTradingTools, TradingMCPServerDeps } from "./mcp-server.js";
import { createCanUseTool } from "./permissions.js";
import { AgentLogger, createHooks } from "./hooks.js";
import { buildSystemPrompt, buildCyclePrompt } from "./prompts.js";
import { AgentState, AgentMessage, AgentCycleResult, AgentConfig } from "./types.js";

export * from "./types.js";

// Convert Zod 4 schema to JSON Schema for Anthropic tools
function zodToJsonSchema(schema: unknown): Anthropic.Tool.InputSchema {
  const zodSchema = schema as { shape?: Record<string, unknown> };

  if (!zodSchema.shape) {
    return { type: "object", properties: {} };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, fieldSchema] of Object.entries(zodSchema.shape)) {
    const field = fieldSchema as {
      _def?: {
        type?: string;
        element?: { type?: string };
        innerType?: { _def?: { type?: string; element?: { type?: string }; values?: string[] } };
        values?: string[];
      };
      description?: string;
      isOptional?: () => boolean;
    };
    const def = field._def;

    if (!def) continue;

    // Handle optional wrapper (Zod 4 uses type: "optional")
    let innerDef = def;
    let isOptional = def.type === "optional";
    if (isOptional && def.innerType?._def) {
      innerDef = def.innerType._def;
    }

    // Map Zod types to JSON Schema (Zod 4 uses lowercase type strings)
    const typeName = innerDef.type;
    let prop: Record<string, unknown> = {};

    if (typeName === "string") {
      prop = { type: "string" };
    } else if (typeName === "number") {
      prop = { type: "number" };
    } else if (typeName === "boolean") {
      prop = { type: "boolean" };
    } else if (typeName === "array") {
      const itemType = innerDef.element?.type;
      prop = {
        type: "array",
        items: { type: itemType === "number" ? "number" : "string" }
      };
    } else if (typeName === "enum") {
      prop = { type: "string", enum: innerDef.values };
    } else {
      prop = { type: "string" }; // fallback
    }

    // Add description if present
    if (field.description) {
      prop.description = field.description;
    }

    properties[key] = prop;

    if (!isOptional) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  } as Anthropic.Tool.InputSchema;
}

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

export class TradingAgent {
  private client: Anthropic;
  private config: AgentConfig;
  private deps: AgentDependencies;
  private callbacks: AgentCallbacks;
  private state: { current: AgentState } = { current: "stopped" };
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private logger: AgentLogger;
  private tools: ReturnType<typeof createTradingTools>;
  private tradingUniverse: string[];
  private allowShorts: boolean;

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

    this.client = new Anthropic({ apiKey });

    this.logger = new AgentLogger({
      agentState: this.state,
      onMessage: (content, type) => {
        this.emitMessage(type as AgentMessage["type"], content);
      },
    });

    const toolDeps: TradingMCPServerDeps = {
      portfolioManager: deps.portfolioManager,
      riskMonitor: deps.riskMonitor,
      dataManager: deps.dataManager,
      tradingUniverse: this.tradingUniverse,
    };

    this.tools = createTradingTools(toolDeps);
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

  /**
   * Start the agent
   */
  start(): void {
    if (this.state.current === "running") {
      return;
    }

    this.setState("running");
    this.scheduleCycle();
  }

  /**
   * Pause the agent (stops new cycles but doesn't halt)
   */
  pause(): void {
    if (this.state.current !== "running") {
      return;
    }

    this.setState("paused");
    this.clearCycleTimer();
  }

  /**
   * Resume the agent from paused state
   */
  resume(): void {
    if (this.state.current !== "paused") {
      return;
    }

    this.setState("running");
    this.scheduleCycle();
  }

  /**
   * Stop the agent gracefully
   */
  stop(): void {
    this.setState("stopped");
    this.clearCycleTimer();
  }

  /**
   * Halt the agent immediately (emergency stop)
   */
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

    if (this.state.current !== "running") {
      return;
    }

    // Run cycle immediately, then schedule next
    this.runCycle().then(() => {
      if (this.state.current === "running") {
        this.cycleTimer = setTimeout(
          () => this.scheduleCycle(),
          this.config.cycleIntervalMs
        );
      }
    });
  }

  /**
   * Run a single trading cycle
   */
  async runCycle(): Promise<AgentCycleResult> {
    const cycleId = uuidv4();
    const startedAt = new Date().toISOString();
    let turnsUsed = 0;
    let tokensUsed = 0;
    let ordersPlaced = 0;
    let ordersCancelled = 0;

    this.logger.startCycle(cycleId);
    this.emitMessage("system", `Starting trading cycle ${cycleId.slice(0, 8)}`);

    try {
      // Get current state for the prompt
      const portfolioState = this.deps.portfolioManager.getState();
      const positions = this.deps.portfolioManager.getPositions();

      // Update prices
      if (positions.length > 0) {
        const quotes = await this.deps.dataManager.getQuotes(
          positions.map((p) => p.symbol)
        );
        this.deps.portfolioManager.updatePrices(quotes);
      }

      const updatedState = this.deps.portfolioManager.getState();

      // Build portfolio snapshot for risk check
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

      // Build prompts
      const systemPrompt = buildSystemPrompt(this.tradingUniverse, this.allowShorts);
      const cyclePrompt = buildCyclePrompt(updatedState, riskStatus);

      // Convert tools to Anthropic format with proper JSON schema types
      const anthropicTools: Anthropic.Tool[] = Object.entries(this.tools).map(
        ([name, tool]) => ({
          name,
          description: tool.description,
          input_schema: zodToJsonSchema(tool.inputSchema),
        })
      );

      // Create canUseTool function
      const canUseTool = createCanUseTool({
        riskMonitor: this.deps.riskMonitor,
        portfolioManager: this.deps.portfolioManager,
        dataManager: this.deps.dataManager,
        agentState: this.state,
      });

      // Create hooks
      const hooks = createHooks(this.logger, this.state);

      // Run conversation loop
      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: cyclePrompt },
      ];

      while (turnsUsed < this.config.maxTurns) {
        // Check if we should stop
        if (await hooks.stop()) {
          this.emitMessage("system", "Cycle stopped by hook");
          break;
        }

        turnsUsed++;

        const response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: 4096,
          system: systemPrompt,
          tools: anthropicTools,
          messages,
        });

        tokensUsed += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

        // Process response - collect tool uses first
        const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

        for (const block of response.content) {
          if (block.type === "text") {
            this.logger.logMessage("assistant", block.text);
            this.emitMessage("assistant", block.text);
          } else if (block.type === "tool_use") {
            toolUseBlocks.push({
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
          }
        }

        // If no tool use and stop_reason is end_turn, we're done
        if (toolUseBlocks.length === 0 && response.stop_reason === "end_turn") {
          break;
        }

        // If no tool use, add assistant response and exit
        if (toolUseBlocks.length === 0) {
          messages.push({ role: "assistant", content: response.content });
          break;
        }

        // Process all tool calls and collect results
        const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];

        for (const toolBlock of toolUseBlocks) {
          const { id, name: toolName, input: toolInput } = toolBlock;
          const startTime = Date.now();

          // Pre-hook
          const preResult = await hooks.preToolUse(toolName, toolInput);
          if (!preResult.continue) {
            this.emitMessage("tool_result", `Tool ${toolName} blocked: ${preResult.reason}`);
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: JSON.stringify({ error: preResult.reason || "Blocked by hook" }),
              is_error: true,
            });
            continue;
          }

          // Check permissions
          const permResult = await canUseTool({ tool: toolName, input: toolInput });
          if (!permResult.allowed) {
            this.emitMessage("tool_result", `Tool ${toolName} denied: ${permResult.reason}`);
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: JSON.stringify({ error: permResult.reason }),
              is_error: true,
            });
            continue;
          }

          // Execute tool
          const tool = this.tools[toolName as keyof typeof this.tools];
          if (tool) {
            try {
              const result = await tool.handler(toolInput as never);
              await hooks.postToolUse(toolName, toolInput, result, { startTime });

              // Track orders
              if (toolName === "place_order" && (result as { success: boolean }).success) {
                ordersPlaced++;
              } else if (toolName === "cancel_order" && (result as { success: boolean }).success) {
                ordersCancelled++;
              }

              this.emitMessage("tool_result", `${toolName}: ${JSON.stringify(result).slice(0, 200)}`);
              toolResults.push({
                type: "tool_result",
                tool_use_id: id,
                content: JSON.stringify(result),
              });
            } catch (error) {
              this.logger.logToolError(toolName, toolInput, String(error), startTime);
              this.emitMessage("error", `Tool ${toolName} error: ${error}`);
              toolResults.push({
                type: "tool_result",
                tool_use_id: id,
                content: JSON.stringify({ error: String(error) }),
                is_error: true,
              });
            }
          } else {
            toolResults.push({
              type: "tool_result",
              tool_use_id: id,
              content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
              is_error: true,
            });
          }
        }

        // Add assistant message (with all content including tool_use blocks) ONCE
        messages.push({ role: "assistant", content: response.content });

        // Add all tool results in a single user message
        messages.push({ role: "user", content: toolResults });
      }

      const result: AgentCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        turnsUsed,
        tokensUsed,
        costUsd: this.estimateCost(tokensUsed),
        ordersPlaced,
        ordersCancelled,
      };

      this.logger.endCycle();
      this.callbacks.onCycleComplete?.(result);
      this.emitMessage("system", `Cycle ${cycleId.slice(0, 8)} complete: ${turnsUsed} turns, ${ordersPlaced} orders`);

      return result;
    } catch (error) {
      const result: AgentCycleResult = {
        cycleId,
        startedAt,
        completedAt: new Date().toISOString(),
        turnsUsed,
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
    }
  }

  private estimateCost(tokens: number): number {
    // Rough estimate based on Claude pricing
    // Sonnet: $3/1M input, $15/1M output - assume 50/50 split
    return (tokens / 1_000_000) * 9;
  }

  /**
   * Run a single cycle manually (for testing)
   */
  async runSingleCycle(): Promise<AgentCycleResult> {
    const previousState = this.state.current;
    this.state.current = "running";

    try {
      return await this.runCycle();
    } finally {
      this.state.current = previousState;
    }
  }
}

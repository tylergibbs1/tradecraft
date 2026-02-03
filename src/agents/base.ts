/**
 * Base Research Agent
 *
 * Abstract base class for all specialist research agents.
 * Uses the Claude Agent SDK for tool execution and streaming.
 */

import { v4 as uuidv4 } from 'uuid';
import { query, Options, HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import {
  AgentSignal,
  AgentRole,
  ResearchAgentConfig,
  ResearchContext,
  AgentCycleContext,
  SignalStrength,
  SignalTimeframe,
  SwarmCallbacks,
  AgentAnalysisResult,
} from './types.js';
import { SignalBus, getSharedSignalBus } from './signal-bus.js';

export interface ResearchAgentDependencies {
  apiKey: string;
  signalBus?: SignalBus;
  callbacks?: SwarmCallbacks;
}

// Re-export for backward compatibility
export type AnalysisCycleResult = AgentAnalysisResult;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export abstract class ResearchAgent {
  protected config: ResearchAgentConfig;
  protected signalBus: SignalBus;
  protected tools: Map<string, ToolDefinition> = new Map();
  protected callbacks?: SwarmCallbacks;

  constructor(config: ResearchAgentConfig, deps: ResearchAgentDependencies) {
    this.config = config;
    this.signalBus = deps.signalBus || getSharedSignalBus();
    this.callbacks = deps.callbacks;

    // Register tools provided by subclass
    for (const tool of this.getTools()) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Update callbacks (for dynamic wiring)
   */
  setCallbacks(callbacks: SwarmCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Get the agent's unique identifier
   */
  get agentId(): string {
    return this.config.agentId;
  }

  /**
   * Get the agent's role
   */
  get role(): AgentRole {
    return this.config.role;
  }

  /**
   * Override in subclass to provide agent-specific tools
   */
  protected abstract getTools(): ToolDefinition[];

  /**
   * Override in subclass to provide the system prompt
   */
  protected abstract getSystemPrompt(): string;

  /**
   * Override in subclass to build the analysis prompt for a symbol
   */
  protected abstract buildAnalysisPrompt(
    symbol: string,
    context: ResearchContext
  ): string;

  /**
   * Override in subclass to parse signals from Claude's response
   */
  protected abstract parseSignals(
    symbol: string,
    response: string,
    context: ResearchContext
  ): Omit<AgentSignal, 'id' | 'timestamp' | 'agentId' | 'agentRole'>[];

  /**
   * Get the list of allowed tool names for the Agent SDK
   */
  protected getAllowedTools(): string[] {
    // Include built-in tools plus custom tools
    return ['WebSearch', 'WebFetch', ...Array.from(this.tools.keys())];
  }

  /**
   * Run an analysis cycle for specified symbols
   */
  async runCycle(
    symbols: string[],
    cycleContext: AgentCycleContext
  ): Promise<AnalysisCycleResult> {
    const cycleId = uuidv4();
    const startedAt = new Date().toISOString();
    let tokensUsed = 0;
    let signalsPublished = 0;
    const symbolsToAnalyze = this.config.focusSymbols || symbols;

    try {
      for (const symbol of symbolsToAnalyze) {
        // Emit agent start callback
        this.callbacks?.onAgentStart?.(this.agentId, this.role, symbol);

        const context = await this.buildResearchContext(symbol, cycleContext);
        const result = await this.analyzeSymbol(symbol, context);

        tokensUsed += result.tokensUsed;

        // Parse and publish signals
        const signals = this.parseSignals(symbol, result.response, context);

        for (const signal of signals) {
          if (signal.confidence >= (this.config.signalThreshold || 0.5)) {
            const publishedSignal = this.publishSignal(symbol, signal);
            signalsPublished++;

            // Emit signal published callback
            this.callbacks?.onSignalPublished?.(publishedSignal);
          }

          // Respect max signals per cycle
          if (
            this.config.maxSignalsPerCycle &&
            signalsPublished >= this.config.maxSignalsPerCycle
          ) {
            break;
          }
        }

        if (
          this.config.maxSignalsPerCycle &&
          signalsPublished >= this.config.maxSignalsPerCycle
        ) {
          break;
        }
      }

      const result: AnalysisCycleResult = {
        cycleId,
        agentId: this.agentId,
        role: this.role,
        startedAt,
        completedAt: new Date().toISOString(),
        symbolsAnalyzed: symbolsToAnalyze,
        signalsPublished,
        tokensUsed,
        costUsd: this.estimateCost(tokensUsed),
      };

      // Emit agent complete callback
      this.callbacks?.onAgentComplete?.(this.agentId, result);

      return result;
    } catch (error) {
      const errorStr = String(error);

      // Emit agent error callback
      this.callbacks?.onAgentError?.(this.agentId, errorStr);

      const result: AnalysisCycleResult = {
        cycleId,
        agentId: this.agentId,
        role: this.role,
        startedAt,
        completedAt: new Date().toISOString(),
        symbolsAnalyzed: symbolsToAnalyze,
        signalsPublished,
        tokensUsed,
        costUsd: this.estimateCost(tokensUsed),
        error: errorStr,
      };

      // Emit agent complete callback even on error
      this.callbacks?.onAgentComplete?.(this.agentId, result);

      return result;
    }
  }

  /**
   * Analyze a single symbol using the Claude Agent SDK
   */
  protected async analyzeSymbol(
    symbol: string,
    context: ResearchContext
  ): Promise<{ response: string; tokensUsed: number }> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildAnalysisPrompt(symbol, context);

    let fullResponse = '';
    let tokensUsed = 0;
    let currentToolName: string | null = null;

    // Build hooks for tool callbacks
    const preToolUseHook: HookCallback = async (
      input: HookInput,
      _toolUseID: string | undefined,
      _opts: { signal: AbortSignal }
    ): Promise<HookJSONOutput> => {
      const toolName = (input as any).tool_name || 'unknown';
      currentToolName = toolName;
      this.callbacks?.onToolStart?.(this.agentId, toolName);
      return { continue: true };
    };

    const postToolUseHook: HookCallback = async (
      input: HookInput,
      _toolUseID: string | undefined,
      _opts: { signal: AbortSignal }
    ): Promise<HookJSONOutput> => {
      const toolName = (input as any).tool_name || currentToolName || 'unknown';
      this.callbacks?.onToolComplete?.(this.agentId, toolName, 0);
      currentToolName = null;
      return { continue: true };
    };

    // Configure Agent SDK options
    const options: Options = {
      systemPrompt,
      allowedTools: this.getAllowedTools(),
      maxTurns: 5,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      hooks: {
        PreToolUse: [{ matcher: '.*', hooks: [preToolUseHook] }],
        PostToolUse: [{ matcher: '.*', hooks: [postToolUseHook] }],
      },
    };

    // Run the query with streaming
    for await (const message of query({ prompt: userPrompt, options })) {
      // Handle streaming events for real-time text updates
      if (message.type === 'stream_event') {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && !currentToolName) {
            // Emit text delta for UI streaming
            this.callbacks?.onTextDelta?.(this.agentId, delta.text);
          }
        }
      }

      // Capture the final result
      if ('result' in message && typeof message.result === 'string') {
        fullResponse = message.result;
      }

      // Track token usage from assistant messages
      if (message.type === 'assistant') {
        // Estimate tokens from message length (rough approximation)
        const msgText = JSON.stringify((message as any).message?.content || '');
        tokensUsed += Math.ceil(msgText.length / 4);
      }
    }

    return {
      response: fullResponse.trim(),
      tokensUsed,
    };
  }

  /**
   * Build research context for a symbol
   */
  protected async buildResearchContext(
    symbol: string,
    cycleContext: AgentCycleContext
  ): Promise<ResearchContext> {
    // Get existing signals from other agents
    const existingSignals = this.signalBus.getSignals(symbol, {
      maxAge: 24 * 60 * 60 * 1000,  // Last 24 hours
    });

    return {
      symbol,
      existingSignals: existingSignals.filter(s => s.agentId !== this.agentId),
    };
  }

  /**
   * Publish a signal to the bus
   */
  protected publishSignal(
    symbol: string,
    signal: Omit<AgentSignal, 'id' | 'timestamp' | 'agentId' | 'agentRole'>
  ): AgentSignal {
    return this.signalBus.publish({
      ...signal,
      symbol,
      agentId: this.agentId,
      agentRole: this.role,
    });
  }

  /**
   * Helper to create a properly formatted signal
   */
  protected createSignal(
    signal: SignalStrength,
    confidence: number,
    timeframe: SignalTimeframe,
    reasoning: string,
    options?: {
      thesis?: string;
      priceTarget?: number;
      stopLoss?: number;
      catalysts?: string[];
      risks?: string[];
      data?: Record<string, unknown>;
      expiresAt?: string;
    }
  ): Omit<AgentSignal, 'id' | 'timestamp' | 'agentId' | 'agentRole' | 'symbol'> {
    return {
      signal,
      confidence: Math.max(0, Math.min(1, confidence)),
      timeframe,
      reasoning,
      ...options,
    };
  }

  /**
   * Estimate cost based on tokens
   */
  protected estimateCost(tokens: number): number {
    // Rough estimate - varies by model
    // Sonnet: ~$9/1M tokens average
    return (tokens / 1_000_000) * 9;
  }

  /**
   * Get signals published by this agent
   */
  getMySignals(maxAge?: number): AgentSignal[] {
    return this.signalBus.getAllSignals({
      roles: [this.role],
      maxAge,
    }).filter(s => s.agentId === this.agentId);
  }
}

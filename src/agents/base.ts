/**
 * Base Research Agent
 *
 * Abstract base class for all specialist research agents.
 * Provides common functionality for running analysis cycles,
 * interacting with Claude, and publishing signals.
 */

import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import {
  AgentSignal,
  AgentRole,
  ResearchAgentConfig,
  ResearchContext,
  AgentCycleContext,
  SignalStrength,
  SignalTimeframe,
} from './types.js';
import { SignalBus, getSharedSignalBus } from './signal-bus.js';

export interface ResearchAgentDependencies {
  apiKey: string;
  signalBus?: SignalBus;
}

export interface AnalysisCycleResult {
  cycleId: string;
  agentId: string;
  role: AgentRole;
  startedAt: string;
  completedAt: string;
  symbolsAnalyzed: string[];
  signalsPublished: number;
  tokensUsed: number;
  costUsd: number;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool.InputSchema;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export abstract class ResearchAgent {
  protected client: Anthropic;
  protected config: ResearchAgentConfig;
  protected signalBus: SignalBus;
  protected tools: Map<string, ToolDefinition> = new Map();

  constructor(config: ResearchAgentConfig, deps: ResearchAgentDependencies) {
    this.config = config;
    this.client = new Anthropic({ apiKey: deps.apiKey });
    this.signalBus = deps.signalBus || getSharedSignalBus();

    // Register tools provided by subclass
    for (const tool of this.getTools()) {
      this.tools.set(tool.name, tool);
    }
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
        const context = await this.buildResearchContext(symbol, cycleContext);
        const result = await this.analyzeSymbol(symbol, context);

        tokensUsed += result.tokensUsed;

        // Parse and publish signals
        const signals = this.parseSignals(symbol, result.response, context);

        for (const signal of signals) {
          if (signal.confidence >= (this.config.signalThreshold || 0.5)) {
            this.publishSignal(symbol, signal);
            signalsPublished++;
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

      return {
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
    } catch (error) {
      return {
        cycleId,
        agentId: this.agentId,
        role: this.role,
        startedAt,
        completedAt: new Date().toISOString(),
        symbolsAnalyzed: symbolsToAnalyze,
        signalsPublished,
        tokensUsed,
        costUsd: this.estimateCost(tokensUsed),
        error: String(error),
      };
    }
  }

  /**
   * Analyze a single symbol
   */
  protected async analyzeSymbol(
    symbol: string,
    context: ResearchContext
  ): Promise<{ response: string; tokensUsed: number }> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildAnalysisPrompt(symbol, context);

    const anthropicTools: Anthropic.Tool[] = Array.from(this.tools.values()).map(
      tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })
    );

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userPrompt },
    ];

    let totalTokens = 0;
    let fullResponse = '';
    let turns = 0;
    const maxTurns = 5;

    while (turns < maxTurns) {
      turns++;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: systemPrompt,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        messages,
      });

      totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      // Collect tool uses and text
      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          fullResponse += block.text + '\n';
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // If no tool use, we're done
      if (toolUseBlocks.length === 0) {
        break;
      }

      // Process all tool calls
      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }> = [];

      for (const toolBlock of toolUseBlocks) {
        const tool = this.tools.get(toolBlock.name);
        if (tool) {
          try {
            const result = await tool.handler(toolBlock.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: JSON.stringify(result),
            });
          } catch (error) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: JSON.stringify({ error: String(error) }),
              is_error: true,
            });
          }
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolBlock.name}` }),
            is_error: true,
          });
        }
      }

      // Add messages for next turn
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    return {
      response: fullResponse.trim(),
      tokensUsed: totalTokens,
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

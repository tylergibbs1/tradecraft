export type AgentState = "stopped" | "running" | "paused" | "halted";

export interface AgentMessage {
  id: string;
  type: "system" | "user" | "assistant" | "tool_use" | "tool_result" | "error";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCycleResult {
  cycleId: string;
  startedAt: string;
  completedAt: string;
  turnsUsed: number;
  tokensUsed: number;
  costUsd: number;
  ordersPlaced: number;
  ordersCancelled: number;
  error?: string;
}

export interface AgentConfig {
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  cycleIntervalMs: number;
  systemPromptPath?: string;
}

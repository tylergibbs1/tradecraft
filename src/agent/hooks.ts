import * as fs from "fs";
import * as path from "path";
import { AgentState } from "./types.js";

const LOGS_DIR = path.join(process.cwd(), "logs");
const AUDIT_DIR = path.join(LOGS_DIR, "audit");
const AGENT_DIR = path.join(LOGS_DIR, "agent");

export interface HookContext {
  agentState: { current: AgentState };
  onMessage?: (message: string, type: string) => void;
}

export interface ToolCallLog {
  timestamp: string;
  cycleId: string;
  tool: string;
  input: unknown;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface AgentCycleLog {
  cycleId: string;
  startedAt: string;
  completedAt?: string;
  messages: Array<{
    timestamp: string;
    role: string;
    content: string;
  }>;
  toolCalls: ToolCallLog[];
  error?: string;
}

function ensureLogDirs(): void {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
  if (!fs.existsSync(AGENT_DIR)) {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
  }
}

function getAuditLogPath(): string {
  const date = new Date().toISOString().split("T")[0];
  return path.join(AUDIT_DIR, `${date}.jsonl`);
}

function getAgentLogPath(): string {
  const date = new Date().toISOString().split("T")[0];
  return path.join(AGENT_DIR, `${date}.jsonl`);
}

function appendToLog(filePath: string, data: unknown): void {
  ensureLogDirs();
  fs.appendFileSync(filePath, JSON.stringify(data) + "\n");
}

export class AgentLogger {
  private currentCycleId: string = "";
  private currentCycleLog: AgentCycleLog | null = null;
  private context: HookContext;

  constructor(context: HookContext) {
    this.context = context;
  }

  startCycle(cycleId: string): void {
    this.currentCycleId = cycleId;
    this.currentCycleLog = {
      cycleId,
      startedAt: new Date().toISOString(),
      messages: [],
      toolCalls: [],
    };
  }

  logMessage(role: string, content: string): void {
    if (this.currentCycleLog) {
      this.currentCycleLog.messages.push({
        timestamp: new Date().toISOString(),
        role,
        content,
      });
    }
    this.context.onMessage?.(content, role);
  }

  logToolCall(tool: string, input: unknown, startTime: number): void {
    const log: ToolCallLog = {
      timestamp: new Date().toISOString(),
      cycleId: this.currentCycleId,
      tool,
      input,
      durationMs: Date.now() - startTime,
    };

    if (this.currentCycleLog) {
      this.currentCycleLog.toolCalls.push(log);
    }

    // Write to audit log
    appendToLog(getAuditLogPath(), log);
  }

  logToolResult(tool: string, input: unknown, result: unknown, startTime: number): void {
    const log: ToolCallLog = {
      timestamp: new Date().toISOString(),
      cycleId: this.currentCycleId,
      tool,
      input,
      result,
      durationMs: Date.now() - startTime,
    };

    // Update last tool call in cycle log
    if (this.currentCycleLog && this.currentCycleLog.toolCalls.length > 0) {
      const lastCall = this.currentCycleLog.toolCalls[this.currentCycleLog.toolCalls.length - 1];
      if (lastCall && lastCall.tool === tool) {
        lastCall.result = result;
        lastCall.durationMs = Date.now() - startTime;
      }
    }

    // Write to audit log
    appendToLog(getAuditLogPath(), log);
  }

  logToolError(tool: string, input: unknown, error: string, startTime: number): void {
    const log: ToolCallLog = {
      timestamp: new Date().toISOString(),
      cycleId: this.currentCycleId,
      tool,
      input,
      error,
      durationMs: Date.now() - startTime,
    };

    if (this.currentCycleLog) {
      this.currentCycleLog.toolCalls.push(log);
    }

    appendToLog(getAuditLogPath(), log);
  }

  endCycle(error?: string): void {
    if (this.currentCycleLog) {
      this.currentCycleLog.completedAt = new Date().toISOString();
      if (error) {
        this.currentCycleLog.error = error;
      }

      // Write cycle log
      appendToLog(getAgentLogPath(), this.currentCycleLog);
    }

    this.currentCycleLog = null;
    this.currentCycleId = "";
  }

  getCycleId(): string {
    return this.currentCycleId;
  }
}

/**
 * Creates hooks for the agent loop
 */
export function createHooks(logger: AgentLogger, agentState: { current: AgentState }) {
  return {
    preToolUse: async (tool: string, input: unknown) => {
      const startTime = Date.now();
      logger.logToolCall(tool, input, startTime);

      // Check kill switch
      if (agentState.current === "halted") {
        return { continue: false, reason: "Agent halted" };
      }

      return { continue: true, startTime };
    },

    postToolUse: async (
      tool: string,
      input: unknown,
      result: unknown,
      context: { startTime?: number }
    ) => {
      logger.logToolResult(tool, input, result, context.startTime ?? Date.now());

      // Check if we should continue
      if (agentState.current === "halted" || agentState.current === "stopped") {
        return { continue: false };
      }

      return { continue: true };
    },

    stop: async () => {
      // Check if agent should stop
      return agentState.current === "halted" || agentState.current === "stopped";
    },
  };
}

import type { DataManager } from "../data/index.js";
import type { PortfolioManager } from "../portfolio/manager.js";
import type { PortfolioSnapshot, RiskMonitor } from "../risk/monitor.js";
import type { AgentState } from "./types.js";

export interface CanUseToolContext {
  riskMonitor: RiskMonitor;
  portfolioManager: PortfolioManager;
  dataManager: DataManager;
  agentState: { current: AgentState };
}

export interface ToolUseRequest {
  tool: string;
  input: Record<string, unknown>;
}

export interface CanUseToolResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Creates a canUseTool function that validates tool calls against risk limits
 */
export function createCanUseTool(ctx: CanUseToolContext) {
  return async (request: ToolUseRequest): Promise<CanUseToolResult> => {
    const { tool, input } = request;
    const { riskMonitor, portfolioManager, dataManager, agentState } = ctx;

    // Check agent state first
    if (agentState.current === "halted") {
      return {
        allowed: false,
        reason: "Agent is halted - trading is disabled",
      };
    }

    if (agentState.current === "paused") {
      // Allow read-only tools when paused
      if (tool === "get_market_data" || tool === "get_portfolio" || tool === "get_risk_status") {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: "Agent is paused - only read operations allowed",
      };
    }

    if (agentState.current === "stopped") {
      return {
        allowed: false,
        reason: "Agent is stopped",
      };
    }

    // For place_order, do pre-validation
    if (tool === "place_order") {
      const symbol = input.symbol as string;
      const quantity = input.quantity as number;
      const side = input.side as "buy" | "sell";

      // Get current price for validation
      try {
        const quote = await dataManager.getQuote(symbol);
        const positions = portfolioManager.getPositions();
        const quotes = await dataManager.getQuotes(positions.map((p) => p.symbol));

        // Build portfolio snapshot
        const state = portfolioManager.getState();
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

        // Check portfolio risk first
        const portfolioCheck = riskMonitor.checkPortfolioRisk(snapshot);
        if (!portfolioCheck.valid) {
          return {
            allowed: false,
            reason: portfolioCheck.reason,
          };
        }

        // Validate the specific order
        const validation = riskMonitor.preValidate(
          {
            symbol,
            side,
            type: (input.type as "market" | "limit" | "stop" | "stop_limit") ?? "market",
            quantity,
            price: input.price as number | undefined,
            stopPrice: input.stopPrice as number | undefined,
          },
          snapshot,
          quote.last,
        );

        if (!validation.valid) {
          return {
            allowed: false,
            reason: validation.reason,
          };
        }
      } catch (error) {
        return {
          allowed: false,
          reason: `Failed to validate order: ${error}`,
        };
      }
    }

    // Allow all other tools
    return { allowed: true };
  };
}

import { RiskMonitor, PortfolioSnapshot } from "../risk/monitor.js";
import { PortfolioManager } from "../portfolio/manager.js";
import { DataManager } from "../data/index.js";
import { AgentState } from "./types.js";
import { OrderType, OrderSide } from "../risk/types.js";

// Valid enum values for runtime validation
const VALID_ORDER_TYPES: OrderType[] = ["market", "limit", "stop", "stop_limit"];
const VALID_ORDER_SIDES: OrderSide[] = ["buy", "sell"];

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
      if (
        tool === "get_market_data" ||
        tool === "get_portfolio" ||
        tool === "get_risk_status"
      ) {
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
      const side = input.side as string;
      const orderType = input.type as string;

      // Validate side enum
      if (!VALID_ORDER_SIDES.includes(side as OrderSide)) {
        return {
          allowed: false,
          reason: `Invalid order side: ${side}. Must be one of: ${VALID_ORDER_SIDES.join(", ")}`,
        };
      }

      // Validate type enum if provided
      if (orderType && !VALID_ORDER_TYPES.includes(orderType as OrderType)) {
        return {
          allowed: false,
          reason: `Invalid order type: ${orderType}. Must be one of: ${VALID_ORDER_TYPES.join(", ")}`,
        };
      }

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
            side: side as OrderSide,
            type: (orderType as OrderType) ?? "market",
            quantity,
            price: input.price as number | undefined,
            stopPrice: input.stopPrice as number | undefined,
          },
          snapshot,
          quote.last
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

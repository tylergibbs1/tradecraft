import { z } from "zod";
import { PortfolioManager } from "../portfolio/manager.js";
import { RiskMonitor, PortfolioSnapshot } from "../risk/monitor.js";
import { DataManager, Quote } from "../data/index.js";
import { OrderSideSchema, OrderTypeSchema } from "../risk/types.js";

// Tool input schemas
const PlaceOrderSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
  side: OrderSideSchema.describe("Order side: buy or sell"),
  type: OrderTypeSchema.describe("Order type: market, limit, stop, or stop_limit"),
  quantity: z.number().int().positive().describe("Number of shares"),
  price: z.number().positive().optional().describe("Limit price (required for limit orders)"),
  stopPrice: z.number().positive().optional().describe("Stop price (required for stop orders)"),
});

const CancelOrderSchema = z.object({
  orderId: z.string().uuid().describe("Order ID to cancel"),
});

const GetMarketDataSchema = z.object({
  symbols: z.array(z.string()).min(1).max(20).describe("List of stock symbols"),
  includeHistory: z.boolean().optional().describe("Include recent price history"),
  historyDays: z.number().int().min(1).max(365).optional().describe("Days of history to include"),
});

const GetPortfolioSchema = z.object({
  includeOrders: z.boolean().optional().describe("Include open orders"),
  includeTrades: z.boolean().optional().describe("Include recent trades"),
  tradeLimit: z.number().int().min(1).max(100).optional().describe("Number of recent trades to include"),
});

const GetRiskStatusSchema = z.object({});

// Types
type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;
type CancelOrderInput = z.infer<typeof CancelOrderSchema>;
type GetMarketDataInput = z.infer<typeof GetMarketDataSchema>;
type GetPortfolioInput = z.infer<typeof GetPortfolioSchema>;

export interface TradingMCPServerDeps {
  portfolioManager: PortfolioManager;
  riskMonitor: RiskMonitor;
  dataManager: DataManager;
  tradingUniverse: string[];
}

function createPortfolioSnapshot(
  portfolioManager: PortfolioManager,
  quotes: Map<string, Quote>
): PortfolioSnapshot {
  const state = portfolioManager.getState();
  const positions = new Map<string, { quantity: number; averageCost: number; currentPrice: number }>();

  for (const [symbol, position] of Object.entries(state.positions)) {
    const quote = quotes.get(symbol);
    positions.set(symbol, {
      quantity: position.quantity,
      averageCost: position.averageCost,
      currentPrice: quote?.last ?? position.currentPrice,
    });
  }

  return {
    cash: state.cash,
    equity: state.equity,
    positions,
    dailyPnL: state.dailyPnL,
    weeklyPnL: state.weeklyPnL,
    peakEquity: state.peakEquity,
  };
}

export function createTradingTools(deps: TradingMCPServerDeps) {
  const { portfolioManager, riskMonitor, dataManager, tradingUniverse } = deps;

  return {
    place_order: {
      description: `Place a trading order. Only symbols in the trading universe are allowed: ${tradingUniverse.join(", ")}. Orders are validated against risk limits before execution.`,
      inputSchema: PlaceOrderSchema,
      handler: async (input: PlaceOrderInput) => {
        // Validate symbol is in trading universe
        if (!tradingUniverse.includes(input.symbol.toUpperCase())) {
          return {
            success: false,
            error: `Symbol ${input.symbol} is not in the trading universe. Allowed: ${tradingUniverse.join(", ")}`,
          };
        }

        // Get current price
        let quote: Quote;
        try {
          quote = await dataManager.getQuote(input.symbol);
        } catch (error) {
          return {
            success: false,
            error: `Failed to get quote for ${input.symbol}: ${error}`,
          };
        }

        // Get portfolio snapshot for risk validation
        const quotes = await dataManager.getQuotes([
          input.symbol,
          ...Object.keys(portfolioManager.getState().positions),
        ]);
        const snapshot = createPortfolioSnapshot(portfolioManager, quotes);

        // Validate against risk limits
        const validation = riskMonitor.preValidate(
          {
            symbol: input.symbol,
            side: input.side,
            type: input.type,
            quantity: input.quantity,
            price: input.price,
            stopPrice: input.stopPrice,
          },
          snapshot,
          quote.last
        );

        if (!validation.valid) {
          return {
            success: false,
            error: validation.reason,
            riskMetrics: validation.riskMetrics,
          };
        }

        // Create and submit order
        const order = portfolioManager.createOrder(
          input.symbol.toUpperCase(),
          input.side,
          input.type,
          input.quantity,
          input.price,
          input.stopPrice
        );

        portfolioManager.submitOrder(order.id);

        // For paper trading with market orders, fill immediately
        if (input.type === "market") {
          const fillPrice = input.side === "buy" ? quote.ask : quote.bid;
          const result = portfolioManager.fillOrder(order.id, fillPrice);
          if (result) {
            riskMonitor.recordTradeSuccess();
            return {
              success: true,
              order: result.order,
              trade: result.trade,
              riskMetrics: validation.riskMetrics,
            };
          }
        }

        return {
          success: true,
          order,
          message: `Order ${order.id} placed successfully`,
          riskMetrics: validation.riskMetrics,
        };
      },
    },

    cancel_order: {
      description: "Cancel an open order by its ID",
      inputSchema: CancelOrderSchema,
      handler: async (input: CancelOrderInput) => {
        const order = portfolioManager.cancelOrder(input.orderId);
        if (!order) {
          return {
            success: false,
            error: `Order ${input.orderId} not found or already filled`,
          };
        }
        return {
          success: true,
          order,
          message: `Order ${input.orderId} cancelled`,
        };
      },
    },

    get_market_data: {
      description: "Get current market data and optionally price history for specified symbols",
      inputSchema: GetMarketDataSchema,
      handler: async (input: GetMarketDataInput) => {
        const quotes = await dataManager.getQuotes(input.symbols);
        const result: Record<string, unknown> = {};

        for (const symbol of input.symbols) {
          const quote = quotes.get(symbol);
          if (quote) {
            const data: Record<string, unknown> = {
              symbol: quote.symbol,
              last: quote.last,
              bid: quote.bid,
              ask: quote.ask,
              volume: quote.volume,
              timestamp: new Date(quote.timestamp).toISOString(),
            };

            if (input.includeHistory) {
              const days = input.historyDays ?? 30;
              const endDate = new Date();
              const startDate = new Date();
              startDate.setDate(startDate.getDate() - days);

              try {
                const history = await dataManager.getHistory(
                  symbol,
                  "1d",
                  startDate,
                  endDate
                );
                data.history = history.map((bar) => ({
                  date: new Date(bar.timestamp).toISOString().split("T")[0],
                  open: bar.open,
                  high: bar.high,
                  low: bar.low,
                  close: bar.close,
                  volume: bar.volume,
                }));
              } catch {
                data.historyError = "Failed to fetch history";
              }
            }

            result[symbol] = data;
          } else {
            result[symbol] = { error: "Quote not available" };
          }
        }

        return {
          success: true,
          data: result,
          provider: dataManager.getProviderName(),
          timestamp: new Date().toISOString(),
        };
      },
    },

    get_portfolio: {
      description: "Get current portfolio state including positions, cash, equity, and P&L",
      inputSchema: GetPortfolioSchema,
      handler: async (input: GetPortfolioInput) => {
        const state = portfolioManager.getState();
        const positions = portfolioManager.getPositions();

        // Update prices
        if (positions.length > 0) {
          const quotes = await dataManager.getQuotes(positions.map((p) => p.symbol));
          portfolioManager.updatePrices(quotes);
        }

        const updatedState = portfolioManager.getState();

        const response: Record<string, unknown> = {
          cash: updatedState.cash,
          equity: updatedState.equity,
          peakEquity: updatedState.peakEquity,
          dailyPnL: updatedState.dailyPnL,
          weeklyPnL: updatedState.weeklyPnL,
          totalPnL: updatedState.totalPnL,
          positions: portfolioManager.getPositions(),
        };

        if (input.includeOrders) {
          response.openOrders = portfolioManager.getOpenOrders();
        }

        if (input.includeTrades) {
          response.recentTrades = portfolioManager.getTrades(input.tradeLimit ?? 10);
        }

        return {
          success: true,
          portfolio: response,
          timestamp: new Date().toISOString(),
        };
      },
    },

    get_risk_status: {
      description: "Get current risk status including circuit breaker state, P&L limits, and position limits",
      inputSchema: GetRiskStatusSchema,
      handler: async () => {
        const positions = portfolioManager.getPositions();
        const quotes = positions.length > 0
          ? await dataManager.getQuotes(positions.map((p) => p.symbol))
          : new Map();

        const snapshot = createPortfolioSnapshot(portfolioManager, quotes);
        const status = riskMonitor.getStatus(snapshot);
        const limits = riskMonitor.getLimits();

        return {
          success: true,
          status: {
            canTrade: status.canTrade,
            circuitBreaker: status.circuitBreaker,
            metrics: {
              dailyPnL: status.dailyPnL,
              dailyPnLPercent: snapshot.equity > 0 ? status.dailyPnL / snapshot.equity : 0,
              weeklyPnL: status.weeklyPnL,
              weeklyPnLPercent: snapshot.equity > 0 ? status.weeklyPnL / snapshot.equity : 0,
              currentDrawdown: status.currentDrawdown,
              peakEquity: status.peakEquity,
              positionCount: status.positionCount,
            },
            limits: {
              maxPositionSize: limits.maxPositionSize,
              maxPositionCount: limits.maxPositionCount,
              dailyLossLimit: limits.dailyLossLimit,
              weeklyLossLimit: limits.weeklyLossLimit,
              maxDrawdown: limits.maxDrawdown,
              maxOrderValue: limits.maxOrderValue,
            },
          },
          timestamp: new Date().toISOString(),
        };
      },
    },
  };
}

// Export schemas for use in permissions
export {
  PlaceOrderSchema,
  CancelOrderSchema,
  GetMarketDataSchema,
  GetPortfolioSchema,
  GetRiskStatusSchema,
};

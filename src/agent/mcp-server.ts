import { z } from "zod";
import { PortfolioManager } from "../portfolio/manager.js";
import { RiskMonitor, PortfolioSnapshot } from "../risk/monitor.js";
import { DataManager, Quote } from "../data/index.js";
import { OrderSideSchema, OrderTypeSchema } from "../risk/types.js";
import { getEdgarProvider } from "../data/providers/edgar.js";
import { getNewsProvider } from "../data/providers/news.js";
import { getExaProvider, ExaCategory } from "../data/providers/exa.js";

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

// Fundamental data schemas
const GetFilingSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
  formType: z.enum(["10-K", "10-Q", "8-K"]).optional().describe("SEC form type (default: 10-K)"),
  sections: z.array(z.enum(["business", "risk_factors", "mda", "financials"])).optional()
    .describe("Specific sections to extract (for 10-K only)"),
});

const GetFinancialsSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
});

const GetNewsSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
  limit: z.number().int().min(1).max(50).optional().describe("Max articles to return (default: 20)"),
});

const GetRecentFilingsSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
  formTypes: z.array(z.string()).optional().describe("Filter by form types (e.g., 10-K, 10-Q, 8-K)"),
  limit: z.number().int().min(1).max(50).optional().describe("Max filings to return (default: 10)"),
});

const GetAgentSignalsSchema = z.object({
  symbol: z.string().min(1).max(10).optional().describe("Filter by stock symbol"),
  maxAge: z.number().int().min(1).optional().describe("Max signal age in hours (default: 24)"),
});

// Exa AI search schemas
const ExaSearchSchema = z.object({
  query: z.string().min(1).describe("Search query"),
  category: z.enum(["financial report", "news", "company", "research paper"]).optional()
    .describe("Search category (default: auto-detect)"),
  numResults: z.number().int().min(1).max(50).optional().describe("Number of results (default: 10)"),
  daysBack: z.number().int().min(1).max(365).optional().describe("Limit to recent content (days)"),
});

const ExaFinancialSearchSchema = z.object({
  symbol: z.string().min(1).max(10).describe("Stock ticker symbol"),
  searchType: z.enum(["reports", "news", "earnings", "analyst", "competitors"]).describe("Type of financial content to search"),
  numResults: z.number().int().min(1).max(20).optional().describe("Number of results (default: 10)"),
});

// Types
type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;
type CancelOrderInput = z.infer<typeof CancelOrderSchema>;
type GetMarketDataInput = z.infer<typeof GetMarketDataSchema>;
type GetPortfolioInput = z.infer<typeof GetPortfolioSchema>;
type GetFilingInput = z.infer<typeof GetFilingSchema>;
type GetFinancialsInput = z.infer<typeof GetFinancialsSchema>;
type GetNewsInput = z.infer<typeof GetNewsSchema>;
type GetRecentFilingsInput = z.infer<typeof GetRecentFilingsSchema>;
type GetAgentSignalsInput = z.infer<typeof GetAgentSignalsSchema>;
type ExaSearchInput = z.infer<typeof ExaSearchSchema>;
type ExaFinancialSearchInput = z.infer<typeof ExaFinancialSearchSchema>;

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

    // Fundamental data tools
    get_filing: {
      description: "Get SEC filing content (10-K, 10-Q, 8-K) for fundamental analysis. For 10-K, can extract specific sections like business description, risk factors, and management discussion.",
      inputSchema: GetFilingSchema,
      handler: async (input: GetFilingInput) => {
        const edgar = getEdgarProvider();
        const formType = input.formType || "10-K";

        try {
          if (formType === "10-K" && input.sections && input.sections.length > 0) {
            const sections = await edgar.get10KSections(
              input.symbol,
              input.sections as ("business" | "risk_factors" | "mda" | "financials")[]
            );
            return {
              success: true,
              symbol: input.symbol,
              formType,
              sections,
              timestamp: new Date().toISOString(),
            };
          } else {
            const { filing, text } = await edgar.getFilingText(input.symbol, formType);
            return {
              success: true,
              symbol: input.symbol,
              filing,
              text: text.slice(0, 50000), // Limit text size
              truncated: text.length > 50000,
              timestamp: new Date().toISOString(),
            };
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to fetch ${formType} for ${input.symbol}: ${error}`,
          };
        }
      },
    },

    get_financials: {
      description: "Get key financial metrics from SEC filings including revenue, margins, debt ratios, and profitability metrics.",
      inputSchema: GetFinancialsSchema,
      handler: async (input: GetFinancialsInput) => {
        const edgar = getEdgarProvider();

        try {
          const metrics = await edgar.getFinancialFacts(input.symbol);
          if (!metrics) {
            return {
              success: false,
              error: `No financial data available for ${input.symbol}`,
            };
          }
          return {
            success: true,
            symbol: input.symbol,
            metrics,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to fetch financials for ${input.symbol}: ${error}`,
          };
        }
      },
    },

    get_news: {
      description: "Get recent news articles and sentiment scores for a stock. Includes headlines, sources, and sentiment analysis when available.",
      inputSchema: GetNewsSchema,
      handler: async (input: GetNewsInput) => {
        const newsProvider = getNewsProvider();
        const limit = input.limit || 20;

        try {
          const news = await newsProvider.getNews(input.symbol, limit);
          const sentiment = newsProvider.calculateAggregateSentiment(news);

          return {
            success: true,
            symbol: input.symbol,
            articleCount: news.length,
            sentiment,
            articles: news.slice(0, 10).map(n => ({
              title: n.title,
              source: n.source,
              publishedAt: n.publishedAt,
              sentiment: n.sentiment,
              summary: n.summary?.slice(0, 200),
            })),
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to fetch news for ${input.symbol}: ${error}`,
          };
        }
      },
    },

    get_recent_filings: {
      description: "List recent SEC filings for a company with filing dates and links.",
      inputSchema: GetRecentFilingsSchema,
      handler: async (input: GetRecentFilingsInput) => {
        const edgar = getEdgarProvider();
        const limit = input.limit || 10;

        try {
          const filings = await edgar.getFilings(input.symbol, input.formTypes, limit);
          return {
            success: true,
            symbol: input.symbol,
            filings,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            error: `Failed to fetch filings for ${input.symbol}: ${error}`,
          };
        }
      },
    },

    // Exa AI search tools
    exa_search: {
      description: "AI-powered semantic search using Exa. Search for financial reports, news, company info, or research papers with natural language queries.",
      inputSchema: ExaSearchSchema,
      handler: async (input: ExaSearchInput) => {
        try {
          const exa = getExaProvider();
          const startDate = input.daysBack
            ? new Date(Date.now() - input.daysBack * 24 * 60 * 60 * 1000)
            : undefined;

          const results = await exa.search(input.query, {
            category: input.category as ExaCategory | undefined,
            numResults: input.numResults || 10,
            startDate,
            includeText: true,
          });

          return {
            success: true,
            query: input.query,
            category: input.category || 'auto',
            resultCount: results.length,
            results: results.map(r => ({
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              text: r.text?.slice(0, 1000), // Limit text size
              score: r.score,
            })),
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            error: `Exa search failed: ${error}`,
          };
        }
      },
    },

    exa_financial_search: {
      description: "Search for specific financial content using Exa AI. Find reports, news, earnings calls, analyst research, or competitor analysis for a stock.",
      inputSchema: ExaFinancialSearchSchema,
      handler: async (input: ExaFinancialSearchInput) => {
        try {
          const exa = getExaProvider();
          const numResults = input.numResults || 10;

          let results;
          switch (input.searchType) {
            case 'reports':
              results = await exa.searchFinancialReports(`${input.symbol} 10-K 10-Q annual quarterly report`, {
                numResults,
              });
              break;
            case 'news':
              results = await exa.searchNews(`${input.symbol} stock`, {
                numResults,
                startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              });
              break;
            case 'earnings':
              const earnings = await exa.getEarningsCallTranscripts(input.symbol, {
                limit: numResults,
              });
              return {
                success: true,
                symbol: input.symbol,
                searchType: input.searchType,
                resultCount: earnings.length,
                results: earnings.map(e => ({
                  title: e.title,
                  url: e.url,
                  date: e.date,
                  text: e.text?.slice(0, 2000),
                })),
                timestamp: new Date().toISOString(),
              };
            case 'analyst':
              results = await exa.getAnalystResearch(input.symbol, { limit: numResults });
              break;
            case 'competitors':
              results = await exa.getCompetitorAnalysis(input.symbol, { limit: numResults });
              break;
            default:
              results = await exa.search(`${input.symbol}`, { numResults });
          }

          return {
            success: true,
            symbol: input.symbol,
            searchType: input.searchType,
            resultCount: results.length,
            results: results.map(r => ({
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              text: r.text?.slice(0, 1000),
              score: r.score,
            })),
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            error: `Exa financial search failed: ${error}`,
          };
        }
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
  GetFilingSchema,
  GetFinancialsSchema,
  GetNewsSchema,
  GetRecentFilingsSchema,
  GetAgentSignalsSchema,
  ExaSearchSchema,
  ExaFinancialSearchSchema,
};

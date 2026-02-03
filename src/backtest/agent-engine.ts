import { v4 as uuidv4 } from "uuid";
import { query, createSdkMcpServer, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DataManager, OHLCV, Quote } from "../data/index.js";
import { RiskMonitor, PortfolioSnapshot } from "../risk/monitor.js";
import { RiskLimits } from "../config/schema.js";
import { buildCyclePrompt } from "../agent/prompts.js";
import { PortfolioState, Position, Order, Trade } from "../portfolio/types.js";

export interface AgentBacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols: string[];
  model: string;
  maxTurnsPerCycle: number;
  allowShorts: boolean;
  riskLimits: RiskLimits;
  // Skip weekends and run every N trading days
  cycleFrequency: number; // 1 = daily, 5 = weekly
}

export interface AgentBacktestTrade {
  date: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  value: number;
  pnl?: number;
}

export interface AgentBacktestCycle {
  date: string;
  turns: number;
  tokens: number;
  cost: number;
  trades: AgentBacktestTrade[];
  reasoning: string;
  portfolioValue: number;
}

export interface AgentBacktestResult {
  config: AgentBacktestConfig;
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownDate: string;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  cycles: AgentBacktestCycle[];
  trades: AgentBacktestTrade[];
  equityCurve: Array<{ date: string; equity: number }>;
  totalApiCost: number;
  totalTokens: number;
}

// Simulated portfolio for backtesting
class SimulatedPortfolio {
  private cash: number;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private peakEquity: number;
  private initialCapital: number;

  constructor(initialCapital: number) {
    this.cash = initialCapital;
    this.initialCapital = initialCapital;
    this.peakEquity = initialCapital;
  }

  getState(prices: Map<string, number>): PortfolioState {
    let positionValue = 0;
    const positionsObj: Record<string, Position> = {};
    const now = new Date().toISOString();

    for (const [symbol, pos] of this.positions) {
      const currentPrice = prices.get(symbol) ?? pos.currentPrice;
      const value = pos.quantity * currentPrice;
      positionValue += value;

      positionsObj[symbol] = {
        ...pos,
        currentPrice,
        marketValue: value,
        unrealizedPnL: (currentPrice - pos.averageCost) * pos.quantity,
        unrealizedPnLPercent: ((currentPrice - pos.averageCost) / pos.averageCost) * 100,
        openedAt: pos.openedAt ?? now,
        lastUpdated: now,
      };
    }

    const equity = this.cash + positionValue;
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }

    return {
      cash: this.cash,
      equity,
      peakEquity: this.peakEquity,
      positions: positionsObj,
      openOrders: {},
      trades: [],
      dailyPnL: 0, // Simplified for backtest
      weeklyPnL: 0,
      totalPnL: equity - this.initialCapital,
      lastUpdated: now,
    };
  }

  buy(symbol: string, quantity: number, price: number): AgentBacktestTrade | null {
    const cost = quantity * price;
    if (cost > this.cash) {
      return null;
    }

    this.cash -= cost;
    const now = new Date().toISOString();

    const existing = this.positions.get(symbol);
    if (existing) {
      const totalCost = existing.averageCost * existing.quantity + price * quantity;
      existing.quantity += quantity;
      existing.averageCost = totalCost / existing.quantity;
      existing.currentPrice = price;
      existing.lastUpdated = now;
    } else {
      this.positions.set(symbol, {
        symbol,
        quantity,
        averageCost: price,
        currentPrice: price,
        marketValue: cost,
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        openedAt: now,
        lastUpdated: now,
      });
    }

    return {
      date: "",
      symbol,
      side: "buy",
      quantity,
      price,
      value: cost,
    };
  }

  sell(symbol: string, quantity: number, price: number): AgentBacktestTrade | null {
    const position = this.positions.get(symbol);
    if (!position || position.quantity < quantity) {
      return null;
    }

    const value = quantity * price;
    const pnl = (price - position.averageCost) * quantity;
    this.cash += value;

    position.quantity -= quantity;
    if (position.quantity <= 0) {
      this.positions.delete(symbol);
    }

    return {
      date: "",
      symbol,
      side: "sell",
      quantity,
      price,
      value,
      pnl,
    };
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getEquity(prices: Map<string, number>): number {
    return this.getState(prices).equity;
  }
}

export class AgentBacktestEngine {
  private dataManager: DataManager;
  private config: AgentBacktestConfig;
  private historicalData: Map<string, OHLCV[]> = new Map();
  private pricesByDate: Map<string, Map<string, OHLCV>> = new Map();

  constructor(apiKey: string, dataManager: DataManager, config: AgentBacktestConfig) {
    this.dataManager = dataManager;
    this.config = config;
  }

  async run(
    onProgress?: (message: string) => void
  ): Promise<AgentBacktestResult> {
    onProgress?.("Fetching historical data...");

    // Fetch all historical data upfront
    for (const symbol of this.config.symbols) {
      const history = await this.dataManager.getHistory(
        symbol,
        "1d",
        this.config.startDate,
        this.config.endDate
      );
      this.historicalData.set(symbol, history);

      // Index by date for quick lookup
      for (const bar of history) {
        const dateStr = new Date(bar.timestamp).toISOString().split("T")[0]!;
        let dateMap = this.pricesByDate.get(dateStr);
        if (!dateMap) {
          dateMap = new Map();
          this.pricesByDate.set(dateStr, dateMap);
        }
        dateMap.set(symbol, bar);
      }
    }

    // Get sorted list of trading days
    const tradingDays = Array.from(this.pricesByDate.keys()).sort();
    onProgress?.(`Found ${tradingDays.length} trading days`);

    // Initialize simulation
    const portfolio = new SimulatedPortfolio(this.config.initialCapital);
    const riskMonitor = new RiskMonitor(this.config.riskLimits);

    const cycles: AgentBacktestCycle[] = [];
    const allTrades: AgentBacktestTrade[] = [];
    const equityCurve: Array<{ date: string; equity: number }> = [];
    let totalTokens = 0;
    let totalApiCost = 0;

    // Run simulation
    for (let i = 0; i < tradingDays.length; i += this.config.cycleFrequency) {
      const date = tradingDays[i]!;
      const prices = this.pricesByDate.get(date)!;
      const currentPrices = new Map<string, number>();
      for (const [symbol, bar] of prices) {
        currentPrices.set(symbol, bar.close);
      }

      // Record equity
      const equity = portfolio.getEquity(currentPrices);
      equityCurve.push({ date, equity });

      // Run agent cycle
      onProgress?.(`[${date}] Running cycle ${Math.floor(i / this.config.cycleFrequency) + 1}/${Math.ceil(tradingDays.length / this.config.cycleFrequency)}...`);

      try {
        const cycleResult = await this.runAgentCycle(
          date,
          portfolio,
          riskMonitor,
          prices,
          currentPrices
        );

        cycles.push(cycleResult);
        totalTokens += cycleResult.tokens;
        totalApiCost += cycleResult.cost;

        for (const trade of cycleResult.trades) {
          trade.date = date;
          allTrades.push(trade);
        }
      } catch (error) {
        onProgress?.(`[${date}] Cycle error: ${error}`);
        cycles.push({
          date,
          turns: 0,
          tokens: 0,
          cost: 0,
          trades: [],
          reasoning: `Error: ${error}`,
          portfolioValue: equity,
        });
      }
    }

    // Calculate final metrics
    const finalPrices = this.pricesByDate.get(tradingDays[tradingDays.length - 1]!)!;
    const finalPricesMap = new Map<string, number>();
    for (const [symbol, bar] of finalPrices) {
      finalPricesMap.set(symbol, bar.close);
    }

    return this.calculateResults(portfolio, finalPricesMap, cycles, allTrades, equityCurve, totalTokens, totalApiCost);
  }

  private async runAgentCycle(
    date: string,
    portfolio: SimulatedPortfolio,
    riskMonitor: RiskMonitor,
    prices: Map<string, OHLCV>,
    currentPrices: Map<string, number>
  ): Promise<AgentBacktestCycle> {
    const cycleTrades: AgentBacktestTrade[] = [];
    let turns = 0;
    let tokens = 0;
    let reasoning = "";

    // Backtest MCP tools implemented with the Agent SDK
    const GetRiskStatusSchema = z.object({});
    const GetMarketDataSchema = z.object({
      symbols: z.array(z.string()).min(1),
    });
    const GetPortfolioSchema = z.object({});
    const PlaceOrderSchema = z.object({
      symbol: z.string().min(1).max(10),
      side: z.enum(["buy", "sell"]),
      type: z.enum(["market"]).default("market"),
      quantity: z.number().int().positive(),
    });

    const sdkTools = [
      tool("get_risk_status", "Check if trading is allowed and view current risk metrics", GetRiskStatusSchema.shape, async () => {
        const snapshot: PortfolioSnapshot = {
          cash: portfolio.getState(currentPrices).cash,
          equity: portfolio.getEquity(currentPrices),
          positions: new Map(portfolio.getPositions().map(p => [p.symbol, {
            quantity: p.quantity,
            averageCost: p.averageCost,
            currentPrice: currentPrices.get(p.symbol) ?? p.currentPrice,
          }])),
          dailyPnL: 0,
          weeklyPnL: 0,
          peakEquity: portfolio.getState(currentPrices).peakEquity,
        };
        const status = riskMonitor.getStatus(snapshot);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, status }) }] };
      }),
      tool("get_market_data", "Get current prices for symbols", GetMarketDataSchema.shape, async (args) => {
        const data: Record<string, unknown> = {};
        for (const symbol of args.symbols) {
          const bar = prices.get(symbol);
          if (bar) {
            data[symbol] = {
              symbol,
              last: bar.close,
              bid: bar.close,
              ask: bar.close,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              volume: bar.volume,
            };
          }
        }
        return { content: [{ type: "text", text: JSON.stringify({ success: true, data, date }) }] };
      }),
      tool("get_portfolio", "Get current portfolio state", GetPortfolioSchema.shape, async () => {
        const state = portfolio.getState(currentPrices);
        const out = {
          success: true,
          portfolio: {
            cash: state.cash,
            equity: state.equity,
            positions: portfolio.getPositions(),
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      }),
      tool("place_order", "Place a trading order", PlaceOrderSchema.shape, async (args) => {
        const symbol = args.symbol.toUpperCase();
        const side = args.side;
        const quantity = args.quantity;
        const price = currentPrices.get(symbol);

        if (!price) {
          return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `No price for ${symbol}` }) }] };
        }
        let trade: AgentBacktestTrade | null = null;
        if (side === "buy") trade = portfolio.buy(symbol, quantity, price);
        else trade = portfolio.sell(symbol, quantity, price);

        if (trade) {
          cycleTrades.push(trade);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, trade }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Order failed" }) }] };
      }),
    ];

    const mcp = createSdkMcpServer({ name: "backtest", tools: sdkTools });

    const portfolioState = portfolio.getState(currentPrices);

    // Build a simplified risk status for the cycle prompt
    const snapshot: PortfolioSnapshot = {
      cash: portfolioState.cash,
      equity: portfolioState.equity,
      positions: new Map(portfolio.getPositions().map(p => [p.symbol, {
        quantity: p.quantity,
        averageCost: p.averageCost,
        currentPrice: currentPrices.get(p.symbol) ?? p.currentPrice,
      }])),
      dailyPnL: 0,
      weeklyPnL: 0,
      peakEquity: portfolioState.peakEquity,
    };
    const riskStatus = riskMonitor.getStatus(snapshot);
    const cyclePrompt = buildCyclePrompt(portfolioState, riskStatus);

    // Run conversation via Agent SDK
    const options: Options = {
      systemPrompt: `You are an autonomous trading agent. Analyze market data and make trading decisions for symbols: ${this.config.symbols.join(", ")}. ${this.config.allowShorts ? "Short selling is allowed." : "Short selling is NOT allowed."}`,
      model: this.config.model,
      maxTurns: this.config.maxTurnsPerCycle,
      mcpServers: { backtest: mcp },
      allowedTools: ["get_risk_status", "get_market_data", "get_portfolio", "place_order"],
      includePartialMessages: true,
    };

    for await (const message of query({ prompt: cyclePrompt, options })) {
      if (message.type === "stream_event") {
        const ev: any = (message as any).event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          const text = ev.delta.text as string;
          if (text) reasoning += text;
        }
      }
      if ((message as any).type === "result" && (message as any).subtype === "success") {
        const res: any = message;
        const usage = res.usage;
        if (usage) tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
        // Ensure reasoning captures final text output if present
        if (res.result && typeof res.result === "string") {
          reasoning = reasoning || String(res.result);
        }
        turns = res.num_turns ?? this.config.maxTurnsPerCycle;
      }
    }

    // Estimate cost (Sonnet pricing: ~$3/1M input, ~$15/1M output, assume 50/50)
    const cost = (tokens / 1_000_000) * 9;

    return {
      date,
      turns,
      tokens,
      cost,
      trades: cycleTrades,
      reasoning: reasoning.slice(0, 500),
      portfolioValue: portfolio.getEquity(currentPrices),
    };
  }

  private calculateResults(
    portfolio: SimulatedPortfolio,
    finalPrices: Map<string, number>,
    cycles: AgentBacktestCycle[],
    trades: AgentBacktestTrade[],
    equityCurve: Array<{ date: string; equity: number }>,
    totalTokens: number,
    totalApiCost: number
  ): AgentBacktestResult {
    const startEquity = this.config.initialCapital;
    const endEquity = portfolio.getEquity(finalPrices);
    const totalReturn = endEquity - startEquity;
    const totalReturnPercent = totalReturn / startEquity;

    const tradingDays = equityCurve.length;
    const yearsTraded = tradingDays / 252;
    const annualizedReturn = yearsTraded > 0
      ? Math.pow(endEquity / startEquity, 1 / yearsTraded) - 1
      : 0;

    // Max drawdown
    let maxDrawdown = 0;
    let maxDrawdownDate = "";
    let peak = startEquity;

    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = (peak - point.equity) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDate = point.date;
      }
    }

    // Sharpe ratio
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1]!.equity;
      const curr = equityCurve[i]!.equity;
      returns.push((curr - prev) / prev);
    }

    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 0
      ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Trade stats
    const closingTrades = trades.filter(t => t.pnl !== undefined);
    const winningTrades = closingTrades.filter(t => t.pnl! > 0);
    const losingTrades = closingTrades.filter(t => t.pnl! < 0);
    const winRate = closingTrades.length > 0 ? winningTrades.length / closingTrades.length : 0;

    const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl!, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl!, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    return {
      config: this.config,
      startEquity,
      endEquity,
      totalReturn,
      totalReturnPercent,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownDate,
      winRate,
      profitFactor,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      cycles,
      trades,
      equityCurve,
      totalApiCost,
      totalTokens,
    };
  }
}

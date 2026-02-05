import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import { DataManager, OHLCV, Quote } from "../data/index.js";
import { RiskMonitor, PortfolioSnapshot } from "../risk/monitor.js";
import { RiskLimits } from "../config/schema.js";
import { buildSystemPrompt, buildCyclePrompt } from "../agent/prompts.js";
import { PortfolioState, Position, Order, Trade } from "../portfolio/types.js";
import { getIndicatorSummary } from "./indicators.js";

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

// Convert Zod schema to JSON Schema for Anthropic tools
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
    };
    const def = field._def;
    if (!def) continue;

    let innerDef = def;
    let isOptional = def.type === "optional";
    if (isOptional && def.innerType?._def) {
      innerDef = def.innerType._def;
    }

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
      prop = { type: "array", items: { type: itemType === "number" ? "number" : "string" } };
    } else if (typeName === "enum") {
      prop = { type: "string", enum: innerDef.values };
    } else {
      prop = { type: "string" };
    }

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

export class AgentBacktestEngine {
  private client: Anthropic;
  private dataManager: DataManager;
  private config: AgentBacktestConfig;
  private historicalData: Map<string, OHLCV[]> = new Map();
  private pricesByDate: Map<string, Map<string, OHLCV>> = new Map();

  constructor(apiKey: string, dataManager: DataManager, config: AgentBacktestConfig) {
    this.client = new Anthropic({ apiKey });
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
          currentPrices,
          allTrades
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
    currentPrices: Map<string, number>,
    allTrades: AgentBacktestTrade[]
  ): Promise<AgentBacktestCycle> {
    const cycleTrades: AgentBacktestTrade[] = [];
    let turns = 0;
    let tokens = 0;
    let reasoning = "";

    // Build tools that return historical data
    const tools: Anthropic.Tool[] = [
      {
        name: "get_risk_status",
        description: "Check if trading is allowed and view current risk metrics",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "get_market_data",
        description: "Get current prices for symbols",
        input_schema: {
          type: "object",
          properties: {
            symbols: { type: "array", items: { type: "string" }, description: "List of symbols" },
          },
          required: ["symbols"],
        },
      },
      {
        name: "get_portfolio",
        description: "Get current portfolio state",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "place_order",
        description: "Place a trading order",
        input_schema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock symbol" },
            side: { type: "string", enum: ["buy", "sell"], description: "Order side" },
            type: { type: "string", enum: ["market"], description: "Order type" },
            quantity: { type: "number", description: "Number of shares" },
          },
          required: ["symbol", "side", "type", "quantity"],
        },
      },
      {
        name: "get_technical_indicators",
        description: "Get technical indicators (SMA, RSI, MACD) for a symbol with pre-computed signals",
        input_schema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Stock symbol" },
          },
          required: ["symbol"],
        },
      },
    ];

    // Capture for closure
    const historicalData = this.historicalData;

    // Tool handlers
    const handleTool = (name: string, input: Record<string, unknown>): unknown => {
      if (name === "get_risk_status") {
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
        return { success: true, status };
      }

      if (name === "get_market_data") {
        const symbols = input.symbols as string[];
        const data: Record<string, unknown> = {};
        for (const symbol of symbols) {
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
        return { success: true, data, date };
      }

      if (name === "get_portfolio") {
        const state = portfolio.getState(currentPrices);
        return {
          success: true,
          portfolio: {
            cash: state.cash,
            equity: state.equity,
            positions: portfolio.getPositions(),
          },
        };
      }

      if (name === "place_order") {
        const symbol = (input.symbol as string).toUpperCase();
        const side = input.side as "buy" | "sell";
        const quantity = input.quantity as number;
        const price = currentPrices.get(symbol);

        if (!price) {
          return { success: false, error: `No price for ${symbol}` };
        }

        let trade: AgentBacktestTrade | null = null;
        if (side === "buy") {
          trade = portfolio.buy(symbol, quantity, price);
        } else {
          trade = portfolio.sell(symbol, quantity, price);
        }

        if (trade) {
          cycleTrades.push(trade);
          return { success: true, trade };
        }
        return { success: false, error: "Order failed" };
      }

      if (name === "get_technical_indicators") {
        const symbol = (input.symbol as string).toUpperCase();
        const allBars = historicalData.get(symbol);
        if (!allBars) {
          return { success: false, error: `No data for ${symbol}` };
        }

        // Filter to bars up to and including the current date
        const currentDateMs = new Date(date + "T23:59:59Z").getTime();
        const barsToDate = allBars.filter((b) => b.timestamp <= currentDateMs);

        if (barsToDate.length < 2) {
          return { success: false, error: `Insufficient history for ${symbol}` };
        }

        const summary = getIndicatorSummary(barsToDate);
        return { success: true, symbol, date, indicators: summary };
      }

      return { error: "Unknown tool" };
    };

    // Build prompts
    const systemPrompt = buildSystemPrompt(this.config.symbols, this.config.allowShorts, this.config.riskLimits);
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
    const cyclePrompt = buildCyclePrompt(portfolioState, riskStatus, allTrades);

    // Run conversation
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: cyclePrompt },
    ];

    while (turns < this.config.maxTurnsPerCycle) {
      turns++;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages,
      });

      tokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

      // Collect tool uses
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === "text") {
          reasoning += block.text + "\n";
        } else if (block.type === "tool_use") {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      if (toolUses.length === 0) {
        break;
      }

      // Process tools and collect results
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

      for (const toolUse of toolUses) {
        const result = handleTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
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

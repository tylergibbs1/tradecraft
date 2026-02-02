import { DataManager, OHLCV } from "../data/index.js";
import {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  BacktestPosition,
  BacktestSnapshot,
  Strategy,
} from "./types.js";

export class BacktestEngine {
  private dataManager: DataManager;
  private config: BacktestConfig;
  private cash: number;
  private positions: Map<string, BacktestPosition>;
  private trades: BacktestTrade[];
  private equityCurve: BacktestSnapshot[];

  constructor(dataManager: DataManager, config: BacktestConfig) {
    this.dataManager = dataManager;
    this.config = config;
    this.cash = config.initialCapital;
    this.positions = new Map();
    this.trades = [];
    this.equityCurve = [];
  }

  private getEquity(prices: Map<string, number>): number {
    let positionValue = 0;
    for (const [symbol, position] of this.positions) {
      const price = prices.get(symbol) ?? position.currentPrice;
      positionValue += position.quantity * price;
    }
    return this.cash + positionValue;
  }

  private recordSnapshot(timestamp: number, prices: Map<string, number>): void {
    this.equityCurve.push({
      timestamp,
      equity: this.getEquity(prices),
      cash: this.cash,
      positions: Array.from(this.positions.values()).map((p) => ({
        ...p,
        currentPrice: prices.get(p.symbol) ?? p.currentPrice,
      })),
    });
  }

  private executeBuy(
    timestamp: number,
    symbol: string,
    quantity: number,
    price: number
  ): BacktestTrade | null {
    // Apply slippage
    const executionPrice = price * (1 + this.config.slippage / 100);
    const value = quantity * executionPrice;
    const totalCost = value + this.config.commission;

    if (totalCost > this.cash) {
      return null;
    }

    this.cash -= totalCost;

    // Update position
    const existing = this.positions.get(symbol);
    if (existing) {
      const totalCostBasis =
        existing.averageCost * existing.quantity + executionPrice * quantity;
      existing.quantity += quantity;
      existing.averageCost = totalCostBasis / existing.quantity;
      existing.currentPrice = executionPrice;
    } else {
      this.positions.set(symbol, {
        symbol,
        quantity,
        averageCost: executionPrice,
        currentPrice: executionPrice,
      });
    }

    const trade: BacktestTrade = {
      timestamp,
      symbol,
      side: "buy",
      quantity,
      price: executionPrice,
      value,
      commission: this.config.commission,
    };

    this.trades.push(trade);
    return trade;
  }

  private executeSell(
    timestamp: number,
    symbol: string,
    quantity: number,
    price: number
  ): BacktestTrade | null {
    const position = this.positions.get(symbol);
    if (!position || position.quantity < quantity) {
      return null;
    }

    // Apply slippage
    const executionPrice = price * (1 - this.config.slippage / 100);
    const value = quantity * executionPrice;
    const proceeds = value - this.config.commission;

    const pnl = (executionPrice - position.averageCost) * quantity - this.config.commission;

    this.cash += proceeds;

    // Update position
    position.quantity -= quantity;
    position.currentPrice = executionPrice;

    if (position.quantity <= 0) {
      this.positions.delete(symbol);
    }

    const trade: BacktestTrade = {
      timestamp,
      symbol,
      side: "sell",
      quantity,
      price: executionPrice,
      value,
      commission: this.config.commission,
      pnl,
    };

    this.trades.push(trade);
    return trade;
  }

  async run(strategy: Strategy): Promise<BacktestResult> {
    // Fetch historical data for all symbols
    const historyMap = new Map<string, OHLCV[]>();

    for (const symbol of this.config.symbols) {
      const history = await this.dataManager.getHistory(
        symbol,
        "1d",
        this.config.startDate,
        this.config.endDate
      );
      historyMap.set(symbol, history);
    }

    // Get union of all timestamps
    const allTimestamps = new Set<number>();
    for (const history of historyMap.values()) {
      for (const bar of history) {
        allTimestamps.add(bar.timestamp);
      }
    }

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Build price lookup by timestamp
    const priceByTimestamp = new Map<number, Map<string, OHLCV>>();
    for (const [symbol, history] of historyMap) {
      for (const bar of history) {
        let priceMap = priceByTimestamp.get(bar.timestamp);
        if (!priceMap) {
          priceMap = new Map();
          priceByTimestamp.set(bar.timestamp, priceMap);
        }
        priceMap.set(symbol, bar);
      }
    }

    // Run simulation
    for (const timestamp of sortedTimestamps) {
      const prices = priceByTimestamp.get(timestamp);
      if (!prices) continue;

      // Update position prices
      const currentPrices = new Map<string, number>();
      for (const [symbol, bar] of prices) {
        currentPrices.set(symbol, bar.close);
        const position = this.positions.get(symbol);
        if (position) {
          position.currentPrice = bar.close;
        }
      }

      // Generate signals and execute trades
      for (const symbol of this.config.symbols) {
        const history = historyMap.get(symbol);
        if (!history) continue;

        // Get history up to current timestamp
        const historySoFar = history.filter((b) => b.timestamp <= timestamp);
        if (historySoFar.length === 0) continue;

        const currentBar = prices.get(symbol);
        if (!currentBar) continue;

        const position = this.positions.get(symbol) ?? null;
        const signal = strategy.generateSignals(symbol, historySoFar, position);

        if (signal.type === "buy" && !position) {
          // Size position based on signal strength and available capital
          const equity = this.getEquity(currentPrices);
          const maxPositionValue = equity * 0.1; // 10% max position
          const targetValue = maxPositionValue * signal.strength;
          const quantity = Math.floor(targetValue / currentBar.close);

          if (quantity > 0) {
            this.executeBuy(timestamp, symbol, quantity, currentBar.close);
          }
        } else if (signal.type === "sell" && position) {
          this.executeSell(timestamp, symbol, position.quantity, currentBar.close);
        }
      }

      // Record equity curve
      this.recordSnapshot(timestamp, currentPrices);
    }

    // Calculate results
    return this.calculateResults();
  }

  private calculateResults(): BacktestResult {
    const startEquity = this.config.initialCapital;
    const endEquity = this.equityCurve[this.equityCurve.length - 1]?.equity ?? startEquity;

    const totalReturn = endEquity - startEquity;
    const totalReturnPercent = totalReturn / startEquity;

    // Calculate trading days and annualized return
    const tradingDays = this.equityCurve.length;
    const yearsTraded = tradingDays / 252;
    const annualizedReturn =
      yearsTraded > 0 ? Math.pow(endEquity / startEquity, 1 / yearsTraded) - 1 : 0;

    // Calculate max drawdown
    let maxDrawdown = 0;
    let maxDrawdownDate = "";
    let peak = startEquity;

    for (const snapshot of this.equityCurve) {
      if (snapshot.equity > peak) {
        peak = snapshot.equity;
      }
      const drawdown = (peak - snapshot.equity) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDate = new Date(snapshot.timestamp).toISOString().split("T")[0]!;
      }
    }

    // Calculate Sharpe ratio
    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prevEquity = this.equityCurve[i - 1]!.equity;
      const currEquity = this.equityCurve[i]!.equity;
      returns.push((currEquity - prevEquity) / prevEquity);
    }

    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance =
      returns.length > 0
        ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Calculate trade statistics
    const closingTrades = this.trades.filter((t) => t.pnl !== undefined);
    const winningTrades = closingTrades.filter((t) => t.pnl! > 0);
    const losingTrades = closingTrades.filter((t) => t.pnl! < 0);

    const winRate = closingTrades.length > 0 ? winningTrades.length / closingTrades.length : 0;

    const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl!, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl!, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    const averageWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const averageLoss =
      losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.pnl!)) : 0;
    const largestLoss =
      losingTrades.length > 0 ? Math.abs(Math.min(...losingTrades.map((t) => t.pnl!))) : 0;

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
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      tradingDays,
      trades: this.trades,
      equityCurve: this.equityCurve,
    };
  }
}

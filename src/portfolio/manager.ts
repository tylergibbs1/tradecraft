import * as fs from "node:fs";
import * as path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Quote } from "../data/types.js";
import type { OrderSide, OrderType } from "../risk/types.js";
import type { DailySnapshot, Order, PortfolioState, Position, Trade } from "./types.js";

const DATA_DIR = path.join(process.cwd(), "data");
const PORTFOLIO_FILE = path.join(DATA_DIR, "portfolio.json");
const SNAPSHOTS_FILE = path.join(DATA_DIR, "snapshots.json");

export class PortfolioManager {
  private state: PortfolioState;
  private snapshots: DailySnapshot[] = [];
  private commission: number = 0; // Commission per trade

  constructor(initialCapital: number) {
    this.state = this.loadState() ?? this.createInitialState(initialCapital);
    this.snapshots = this.loadSnapshots();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private createInitialState(initialCapital: number): PortfolioState {
    return {
      cash: initialCapital,
      positions: {},
      openOrders: {},
      trades: [],
      equity: initialCapital,
      peakEquity: initialCapital,
      dailyPnL: 0,
      weeklyPnL: 0,
      totalPnL: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  private loadState(): PortfolioState | null {
    try {
      if (fs.existsSync(PORTFOLIO_FILE)) {
        const data = fs.readFileSync(PORTFOLIO_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      // Invalid state file
    }
    return null;
  }

  private loadSnapshots(): DailySnapshot[] {
    try {
      if (fs.existsSync(SNAPSHOTS_FILE)) {
        const data = fs.readFileSync(SNAPSHOTS_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      // Invalid snapshots file
    }
    return [];
  }

  private saveState(): void {
    this.ensureDataDir();
    this.state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(this.state, null, 2));
  }

  private saveSnapshots(): void {
    this.ensureDataDir();
    fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(this.snapshots, null, 2));
  }

  /**
   * Update positions with current market prices
   */
  updatePrices(quotes: Map<string, Quote>): void {
    for (const [symbol, position] of Object.entries(this.state.positions)) {
      const quote = quotes.get(symbol);
      if (quote) {
        position.currentPrice = quote.last;
        position.marketValue = position.quantity * quote.last;
        position.unrealizedPnL = (quote.last - position.averageCost) * position.quantity;
        position.unrealizedPnLPercent = (quote.last - position.averageCost) / position.averageCost;
        position.lastUpdated = new Date().toISOString();
      }
    }

    this.recalculateEquity();
    this.saveState();
  }

  private recalculateEquity(): void {
    const positionValue = Object.values(this.state.positions).reduce((sum, p) => sum + p.marketValue, 0);
    this.state.equity = this.state.cash + positionValue;

    if (this.state.equity > this.state.peakEquity) {
      this.state.peakEquity = this.state.equity;
    }
  }

  /**
   * Create a new order
   */
  createOrder(
    symbol: string,
    side: OrderSide,
    type: OrderType,
    quantity: number,
    price?: number,
    stopPrice?: number,
  ): Order {
    const order: Order = {
      id: uuidv4(),
      symbol,
      side,
      type,
      quantity,
      filledQuantity: 0,
      price,
      stopPrice,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.state.openOrders[order.id] = order;
    this.saveState();
    return order;
  }

  /**
   * Submit an order (simulated)
   */
  submitOrder(orderId: string): Order | null {
    const order = this.state.openOrders[orderId];
    if (!order) return null;

    order.status = "submitted";
    order.updatedAt = new Date().toISOString();
    this.saveState();
    return order;
  }

  /**
   * Fill an order (for paper trading / simulation)
   */
  fillOrder(orderId: string, fillPrice: number, fillQuantity?: number): { order: Order; trade: Trade } | null {
    const order = this.state.openOrders[orderId];
    if (!order) return null;

    const qty = fillQuantity ?? order.quantity - order.filledQuantity;
    const value = qty * fillPrice;

    // Calculate realized PnL for sell orders
    let pnl: number | undefined;
    const position = this.state.positions[order.symbol];

    if (order.side === "buy") {
      // Check if we have enough cash
      if (value + this.commission > this.state.cash) {
        this.rejectOrder(orderId, "Insufficient cash");
        return null;
      }
      this.state.cash -= value + this.commission;
    } else {
      // Sell
      if (!position || position.quantity < qty) {
        this.rejectOrder(orderId, "Insufficient shares");
        return null;
      }
      pnl = (fillPrice - position.averageCost) * qty;
      this.state.cash += value - this.commission;
      this.state.totalPnL += pnl;
      this.state.dailyPnL += pnl;
      this.state.weeklyPnL += pnl;
    }

    // Create trade record
    const trade: Trade = {
      id: uuidv4(),
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: qty,
      price: fillPrice,
      value,
      commission: this.commission,
      executedAt: new Date().toISOString(),
      pnl,
    };
    this.state.trades.push(trade);

    // Update order
    order.filledQuantity += qty;
    order.averageFillPrice = order.averageFillPrice
      ? (order.averageFillPrice * (order.filledQuantity - qty) + fillPrice * qty) / order.filledQuantity
      : fillPrice;
    order.updatedAt = new Date().toISOString();

    if (order.filledQuantity >= order.quantity) {
      order.status = "filled";
      order.filledAt = new Date().toISOString();
      delete this.state.openOrders[orderId];
    } else {
      order.status = "partial";
    }

    // Update position
    this.updatePosition(order.symbol, order.side, qty, fillPrice);

    this.recalculateEquity();
    this.saveState();

    return { order, trade };
  }

  private updatePosition(symbol: string, side: OrderSide, quantity: number, price: number): void {
    let position = this.state.positions[symbol];

    if (side === "buy") {
      if (position) {
        // Add to existing position
        const totalCost = position.averageCost * position.quantity + price * quantity;
        position.quantity += quantity;
        position.averageCost = totalCost / position.quantity;
      } else {
        // Create new position
        position = {
          symbol,
          quantity,
          averageCost: price,
          currentPrice: price,
          marketValue: quantity * price,
          unrealizedPnL: 0,
          unrealizedPnLPercent: 0,
          openedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        };
        this.state.positions[symbol] = position;
      }
    } else {
      // Sell
      if (position) {
        position.quantity -= quantity;
        if (position.quantity <= 0) {
          delete this.state.positions[symbol];
        }
      }
    }
  }

  /**
   * Reject an order
   */
  rejectOrder(orderId: string, reason: string): Order | null {
    const order = this.state.openOrders[orderId];
    if (!order) return null;

    order.status = "rejected";
    order.rejectionReason = reason;
    order.updatedAt = new Date().toISOString();
    delete this.state.openOrders[orderId];
    this.saveState();
    return order;
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string): Order | null {
    const order = this.state.openOrders[orderId];
    if (!order) return null;

    if (order.status === "filled") {
      return null; // Can't cancel filled order
    }

    order.status = "cancelled";
    order.updatedAt = new Date().toISOString();
    delete this.state.openOrders[orderId];
    this.saveState();
    return order;
  }

  /**
   * Get current portfolio state
   */
  getState(): PortfolioState {
    return { ...this.state };
  }

  /**
   * Get position for a symbol
   */
  getPosition(symbol: string): Position | null {
    return this.state.positions[symbol] ?? null;
  }

  /**
   * Get all positions
   */
  getPositions(): Position[] {
    return Object.values(this.state.positions);
  }

  /**
   * Get open orders
   */
  getOpenOrders(): Order[] {
    return Object.values(this.state.openOrders);
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): Order | null {
    return this.state.openOrders[orderId] ?? null;
  }

  /**
   * Get recent trades
   */
  getTrades(limit?: number): Trade[] {
    const trades = [...this.state.trades].reverse();
    return limit ? trades.slice(0, limit) : trades;
  }

  /**
   * Take daily snapshot and reset daily P&L
   */
  takeDailySnapshot(): void {
    const today = new Date().toISOString().split("T")[0]!;

    // Check if we already have a snapshot for today
    const existingIndex = this.snapshots.findIndex((s) => s.date === today);
    const snapshot: DailySnapshot = {
      date: today,
      equity: this.state.equity,
      cash: this.state.cash,
      positions: Object.fromEntries(
        Object.entries(this.state.positions).map(([sym, pos]) => [
          sym,
          { quantity: pos.quantity, averageCost: pos.averageCost },
        ]),
      ),
      dailyPnL: this.state.dailyPnL,
    };

    if (existingIndex >= 0) {
      this.snapshots[existingIndex] = snapshot;
    } else {
      this.snapshots.push(snapshot);
    }

    this.saveSnapshots();
  }

  /**
   * Reset daily P&L (call at market open)
   */
  resetDailyPnL(): void {
    this.state.dailyPnL = 0;
    this.saveState();
  }

  /**
   * Reset weekly P&L (call at week start)
   */
  resetWeeklyPnL(): void {
    this.state.weeklyPnL = 0;
    this.saveState();
  }

  /**
   * Get equity history from snapshots
   */
  getEquityHistory(): { date: string; equity: number }[] {
    return this.snapshots.map((s) => ({ date: s.date, equity: s.equity }));
  }

  /**
   * Reset portfolio to initial state
   */
  reset(initialCapital: number): void {
    this.state = this.createInitialState(initialCapital);
    this.snapshots = [];
    this.saveState();
    this.saveSnapshots();
  }
}

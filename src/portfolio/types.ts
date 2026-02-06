import type { OrderSide, OrderType } from "../risk/types.js";

export type OrderStatus = "pending" | "submitted" | "partial" | "filled" | "rejected" | "cancelled";

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  filledQuantity: number;
  price?: number; // Limit price
  stopPrice?: number; // Stop price
  averageFillPrice?: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  filledAt?: string;
  rejectionReason?: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  openedAt: string;
  lastUpdated: string;
}

export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  value: number;
  commission: number;
  executedAt: string;
  pnl?: number; // Only for closing trades
}

export interface PortfolioState {
  cash: number;
  positions: Record<string, Position>;
  openOrders: Record<string, Order>;
  trades: Trade[];
  equity: number;
  peakEquity: number;
  dailyPnL: number;
  weeklyPnL: number;
  totalPnL: number;
  lastUpdated: string;
}

export interface DailySnapshot {
  date: string;
  equity: number;
  cash: number;
  positions: Record<string, { quantity: number; averageCost: number }>;
  dailyPnL: number;
}

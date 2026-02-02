import { z } from "zod";

export const OrderSideSchema = z.enum(["buy", "sell"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(["market", "limit", "stop", "stop_limit"]);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number; // Required for limit orders
  stopPrice?: number; // Required for stop orders
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  riskMetrics?: {
    positionValue: number;
    positionPercent: number;
    currentDailyLoss: number;
    currentWeeklyLoss: number;
    currentDrawdown: number;
  };
}

export type CircuitBreakerState = "open" | "closed" | "half_open";

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  reason?: string;
  triggeredAt?: string;
  cooldownEndsAt?: string;
}

export interface RiskStatus {
  circuitBreaker: CircuitBreakerStatus;
  dailyPnL: number;
  weeklyPnL: number;
  currentDrawdown: number;
  peakEquity: number;
  positionCount: number;
  maxPositionCount: number;
  canTrade: boolean;
}

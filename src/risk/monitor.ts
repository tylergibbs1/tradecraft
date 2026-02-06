import type { RiskLimits } from "../config/schema.js";
import { CircuitBreaker } from "./circuit.js";
import type { OrderRequest, RiskStatus, ValidationResult } from "./types.js";

export interface PortfolioSnapshot {
  cash: number;
  equity: number;
  positions: Map<string, { quantity: number; averageCost: number; currentPrice: number }>;
  dailyPnL: number;
  weeklyPnL: number;
  peakEquity: number;
}

export class RiskMonitor {
  private limits: RiskLimits;
  private circuitBreaker: CircuitBreaker;

  constructor(limits: RiskLimits) {
    this.limits = limits;
    this.circuitBreaker = new CircuitBreaker();
  }

  /**
   * Validate an order against risk limits
   */
  preValidate(order: OrderRequest, portfolio: PortfolioSnapshot, currentPrice: number): ValidationResult {
    // Check circuit breaker first
    if (!this.circuitBreaker.canTrade()) {
      return {
        valid: false,
        reason: `Circuit breaker is ${this.circuitBreaker.getState()}: ${this.circuitBreaker.getStatus().reason}`,
      };
    }

    const orderValue = order.quantity * currentPrice;
    const positionValue = order.side === "buy" ? orderValue : -orderValue;

    // Calculate what position size would be after this order
    const existingPosition = portfolio.positions.get(order.symbol);
    const existingValue = existingPosition ? existingPosition.quantity * existingPosition.currentPrice : 0;
    const newPositionValue = existingValue + positionValue;
    const positionPercent = Math.abs(newPositionValue) / portfolio.equity;

    // Risk metrics for response
    const riskMetrics = {
      positionValue: Math.abs(newPositionValue),
      positionPercent,
      currentDailyLoss: portfolio.dailyPnL < 0 ? Math.abs(portfolio.dailyPnL) / portfolio.equity : 0,
      currentWeeklyLoss: portfolio.weeklyPnL < 0 ? Math.abs(portfolio.weeklyPnL) / portfolio.equity : 0,
      currentDrawdown: (portfolio.peakEquity - portfolio.equity) / portfolio.peakEquity,
    };

    // Check max order value
    if (orderValue > this.limits.maxOrderValue) {
      return {
        valid: false,
        reason: `Order value $${orderValue.toFixed(2)} exceeds max order value $${this.limits.maxOrderValue}`,
        riskMetrics,
      };
    }

    // Check position size limit
    if (positionPercent > this.limits.maxPositionSize) {
      return {
        valid: false,
        reason: `Position would be ${(positionPercent * 100).toFixed(1)}% of portfolio, exceeds max ${(this.limits.maxPositionSize * 100).toFixed(0)}%`,
        riskMetrics,
      };
    }

    // Check position count limit (for new positions)
    if (!existingPosition && order.side === "buy") {
      if (portfolio.positions.size >= this.limits.maxPositionCount) {
        return {
          valid: false,
          reason: `Already at max position count of ${this.limits.maxPositionCount}`,
          riskMetrics,
        };
      }
    }

    // Check sufficient cash for buy orders
    if (order.side === "buy" && orderValue > portfolio.cash) {
      return {
        valid: false,
        reason: `Insufficient cash: need $${orderValue.toFixed(2)}, have $${portfolio.cash.toFixed(2)}`,
        riskMetrics,
      };
    }

    // Check sufficient shares for sell orders
    if (order.side === "sell") {
      const currentQty = existingPosition?.quantity ?? 0;
      if (order.quantity > currentQty) {
        return {
          valid: false,
          reason: `Insufficient shares: trying to sell ${order.quantity}, have ${currentQty}`,
          riskMetrics,
        };
      }
    }

    return {
      valid: true,
      riskMetrics,
    };
  }

  /**
   * Check portfolio-level risk limits and potentially trip circuit breaker
   */
  checkPortfolioRisk(portfolio: PortfolioSnapshot): ValidationResult {
    const dailyLossPercent = portfolio.dailyPnL < 0 ? Math.abs(portfolio.dailyPnL) / portfolio.equity : 0;
    const weeklyLossPercent = portfolio.weeklyPnL < 0 ? Math.abs(portfolio.weeklyPnL) / portfolio.equity : 0;
    const drawdown = (portfolio.peakEquity - portfolio.equity) / portfolio.peakEquity;

    // Check daily loss limit
    if (dailyLossPercent > this.limits.dailyLossLimit) {
      const reason = `Daily loss of ${(dailyLossPercent * 100).toFixed(1)}% exceeds limit of ${(this.limits.dailyLossLimit * 100).toFixed(0)}%`;
      this.circuitBreaker.trip(reason);
      return { valid: false, reason };
    }

    // Check weekly loss limit
    if (weeklyLossPercent > this.limits.weeklyLossLimit) {
      const reason = `Weekly loss of ${(weeklyLossPercent * 100).toFixed(1)}% exceeds limit of ${(this.limits.weeklyLossLimit * 100).toFixed(0)}%`;
      this.circuitBreaker.trip(reason);
      return { valid: false, reason };
    }

    // Check max drawdown
    if (drawdown > this.limits.maxDrawdown) {
      const reason = `Drawdown of ${(drawdown * 100).toFixed(1)}% exceeds max of ${(this.limits.maxDrawdown * 100).toFixed(0)}%`;
      this.circuitBreaker.trip(reason);
      return { valid: false, reason };
    }

    return { valid: true };
  }

  /**
   * Record a successful trade (for circuit breaker half-open state)
   */
  recordTradeSuccess(): void {
    this.circuitBreaker.recordSuccess();
  }

  /**
   * Record a trade failure
   */
  recordTradeFailure(reason: string): void {
    this.circuitBreaker.recordFailure(reason);
  }

  /**
   * Get full risk status
   */
  getStatus(portfolio: PortfolioSnapshot): RiskStatus {
    const dailyPnL = portfolio.dailyPnL;
    const weeklyPnL = portfolio.weeklyPnL;
    const currentDrawdown = (portfolio.peakEquity - portfolio.equity) / portfolio.peakEquity;

    return {
      circuitBreaker: this.circuitBreaker.getStatus(),
      dailyPnL,
      weeklyPnL,
      currentDrawdown,
      peakEquity: portfolio.peakEquity,
      positionCount: portfolio.positions.size,
      maxPositionCount: this.limits.maxPositionCount,
      canTrade: this.circuitBreaker.canTrade(),
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Update risk limits
   */
  updateLimits(limits: RiskLimits): void {
    this.limits = limits;
  }

  /**
   * Get current limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }
}

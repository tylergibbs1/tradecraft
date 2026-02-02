import { Strategy, Signal, BacktestPosition } from "./types.js";

interface Bar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Simple Moving Average Crossover Strategy
 */
export const smaCrossover: Strategy = {
  name: "SMA Crossover",
  description: "Buy when short SMA crosses above long SMA, sell when it crosses below",

  generateSignals(symbol: string, history: Bar[], position: BacktestPosition | null): Signal {
    if (history.length < 50) {
      return { symbol, type: "hold", strength: 0 };
    }

    // Calculate SMAs
    const shortPeriod = 10;
    const longPeriod = 50;

    const recentBars = history.slice(-longPeriod);
    const closes = recentBars.map((b) => b.close);

    const shortSMA = closes.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
    const longSMA = closes.reduce((a, b) => a + b, 0) / longPeriod;

    // Previous values for crossover detection
    const prevCloses = history.slice(-longPeriod - 1, -1).map((b) => b.close);
    const prevShortSMA = prevCloses.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
    const prevLongSMA = prevCloses.reduce((a, b) => a + b, 0) / longPeriod;

    // Detect crossover
    const bullishCrossover = prevShortSMA <= prevLongSMA && shortSMA > longSMA;
    const bearishCrossover = prevShortSMA >= prevLongSMA && shortSMA < longSMA;

    if (bullishCrossover && !position) {
      return {
        symbol,
        type: "buy",
        strength: Math.abs(shortSMA - longSMA) / longSMA,
        reason: "Bullish SMA crossover",
      };
    }

    if (bearishCrossover && position) {
      return {
        symbol,
        type: "sell",
        strength: Math.abs(shortSMA - longSMA) / longSMA,
        reason: "Bearish SMA crossover",
      };
    }

    return { symbol, type: "hold", strength: 0 };
  },
};

/**
 * RSI Mean Reversion Strategy
 */
export const rsiMeanReversion: Strategy = {
  name: "RSI Mean Reversion",
  description: "Buy when RSI is oversold (<30), sell when overbought (>70)",

  generateSignals(symbol: string, history: Bar[], position: BacktestPosition | null): Signal {
    if (history.length < 15) {
      return { symbol, type: "hold", strength: 0 };
    }

    // Calculate RSI
    const period = 14;
    const recentBars = history.slice(-period - 1);
    const changes = [];

    for (let i = 1; i < recentBars.length; i++) {
      changes.push(recentBars[i]!.close - recentBars[i - 1]!.close);
    }

    const gains = changes.filter((c) => c > 0);
    const losses = changes.filter((c) => c < 0).map((c) => Math.abs(c));

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    if (rsi < 30 && !position) {
      return {
        symbol,
        type: "buy",
        strength: (30 - rsi) / 30,
        reason: `RSI oversold at ${rsi.toFixed(1)}`,
      };
    }

    if (rsi > 70 && position) {
      return {
        symbol,
        type: "sell",
        strength: (rsi - 70) / 30,
        reason: `RSI overbought at ${rsi.toFixed(1)}`,
      };
    }

    return { symbol, type: "hold", strength: 0 };
  },
};

/**
 * Momentum Strategy
 */
export const momentum: Strategy = {
  name: "Momentum",
  description: "Buy on positive momentum, sell on negative momentum with trailing stop",

  generateSignals(symbol: string, history: Bar[], position: BacktestPosition | null): Signal {
    if (history.length < 20) {
      return { symbol, type: "hold", strength: 0 };
    }

    const recentBars = history.slice(-20);
    const currentPrice = recentBars[recentBars.length - 1]!.close;
    const priceWeekAgo = recentBars[recentBars.length - 5]!.close;
    const priceTwoWeeksAgo = recentBars[recentBars.length - 10]!.close;

    const weekMomentum = (currentPrice - priceWeekAgo) / priceWeekAgo;
    const twoWeekMomentum = (currentPrice - priceTwoWeeksAgo) / priceTwoWeeksAgo;

    // Buy signal: positive and accelerating momentum
    if (weekMomentum > 0.02 && weekMomentum > twoWeekMomentum / 2 && !position) {
      return {
        symbol,
        type: "buy",
        strength: weekMomentum,
        reason: `Strong momentum: ${(weekMomentum * 100).toFixed(1)}%`,
      };
    }

    // Sell signal: negative momentum or trailing stop
    if (position) {
      const unrealizedReturn = (currentPrice - position.averageCost) / position.averageCost;

      // Trailing stop: sell if down 5% from entry
      if (unrealizedReturn < -0.05) {
        return {
          symbol,
          type: "sell",
          strength: Math.abs(unrealizedReturn),
          reason: `Trailing stop hit: ${(unrealizedReturn * 100).toFixed(1)}%`,
        };
      }

      // Take profit: sell if momentum reverses with profit
      if (weekMomentum < -0.01 && unrealizedReturn > 0.03) {
        return {
          symbol,
          type: "sell",
          strength: unrealizedReturn,
          reason: `Taking profit: ${(unrealizedReturn * 100).toFixed(1)}%`,
        };
      }
    }

    return { symbol, type: "hold", strength: 0 };
  },
};

// Strategy registry
export const strategies: Record<string, Strategy> = {
  "sma-crossover": smaCrossover,
  "rsi-mean-reversion": rsiMeanReversion,
  momentum: momentum,
};

export function getStrategy(name: string): Strategy | undefined {
  return strategies[name];
}

export function listStrategies(): string[] {
  return Object.keys(strategies);
}

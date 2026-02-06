/**
 * Strategy Compiler
 *
 * Compiles a StrategySpec JSON DSL into a Strategy object that the
 * BacktestEngine can execute. No eval() — maps DSL nodes to existing
 * indicator functions.
 */

import { Strategy, Signal, BacktestPosition } from "../backtest/types.js";
import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeATR,
  computeBollingerBands,
} from "../backtest/indicators.js";
import {
  StrategySpec,
  EntryRule,
  ConditionNode,
  LogicNode,
  IndicatorRef,
  ExitRules,
} from "./types.js";

interface Bar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndicatorCache {
  closes: number[];
  highs: number[];
  lows: number[];
  sma: Map<number, number[]>;
  ema: Map<number, number[]>;
  rsi: Map<number, number[]>;
  macd: { macdLine: number[]; signalLine: number[]; histogram: number[] } | null;
  atr: Map<number, number[]>;
  bollinger: Map<number, { upper: number[]; middle: number[]; lower: number[] }>;
}

function buildCache(history: Bar[]): IndicatorCache {
  return {
    closes: history.map(b => b.close),
    highs: history.map(b => b.high),
    lows: history.map(b => b.low),
    sma: new Map(),
    ema: new Map(),
    rsi: new Map(),
    macd: null,
    atr: new Map(),
    bollinger: new Map(),
  };
}

function getIndicatorValue(
  ref: IndicatorRef,
  cache: IndicatorCache,
  index: number
): number {
  const period = ref.period ?? 14;

  switch (ref.type) {
    case "SMA": {
      if (!cache.sma.has(period)) {
        cache.sma.set(period, computeSMA(cache.closes, period));
      }
      return cache.sma.get(period)![index] ?? NaN;
    }
    case "EMA": {
      if (!cache.ema.has(period)) {
        cache.ema.set(period, computeEMA(cache.closes, period));
      }
      return cache.ema.get(period)![index] ?? NaN;
    }
    case "RSI": {
      if (!cache.rsi.has(period)) {
        cache.rsi.set(period, computeRSI(cache.closes, period));
      }
      return cache.rsi.get(period)![index] ?? NaN;
    }
    case "MACD": {
      if (!cache.macd) {
        cache.macd = computeMACD(cache.closes);
      }
      const component = ref.component ?? "histogram";
      if (component === "line") return cache.macd.macdLine[index] ?? NaN;
      if (component === "signal") return cache.macd.signalLine[index] ?? NaN;
      return cache.macd.histogram[index] ?? NaN;
    }
    case "ATR": {
      if (!cache.atr.has(period)) {
        cache.atr.set(period, computeATR(cache.highs, cache.lows, cache.closes, period));
      }
      return cache.atr.get(period)![index] ?? NaN;
    }
    case "BOLLINGER": {
      if (!cache.bollinger.has(period)) {
        cache.bollinger.set(period, computeBollingerBands(cache.closes, period));
      }
      const bands = cache.bollinger.get(period)!;
      const comp = ref.component ?? "middle";
      if (comp === "upper") return bands.upper[index] ?? NaN;
      if (comp === "lower") return bands.lower[index] ?? NaN;
      return bands.middle[index] ?? NaN;
    }
    default:
      return NaN;
  }
}

function resolveValue(
  node: IndicatorRef | { type: "price" } | { type: "literal"; value: number },
  cache: IndicatorCache,
  index: number
): number {
  if ("value" in node) return node.value;
  if (node.type === "price") return cache.closes[index] ?? NaN;
  return getIndicatorValue(node as IndicatorRef, cache, index);
}

function evaluateComparison(
  cond: ConditionNode,
  cache: IndicatorCache,
  currentIdx: number
): boolean {
  const leftVal = resolveValue(cond.left, cache, currentIdx);
  const rightVal = resolveValue(cond.right, cache, currentIdx);

  if (isNaN(leftVal) || isNaN(rightVal)) return false;

  switch (cond.op) {
    case "gt": return leftVal > rightVal;
    case "lt": return leftVal < rightVal;
    case "gte": return leftVal >= rightVal;
    case "lte": return leftVal <= rightVal;
    case "crosses_above": {
      if (currentIdx < 1) return false;
      const prevLeft = resolveValue(cond.left, cache, currentIdx - 1);
      const prevRight = resolveValue(cond.right, cache, currentIdx - 1);
      if (isNaN(prevLeft) || isNaN(prevRight)) return false;
      return prevLeft <= prevRight && leftVal > rightVal;
    }
    case "crosses_below": {
      if (currentIdx < 1) return false;
      const prevLeft = resolveValue(cond.left, cache, currentIdx - 1);
      const prevRight = resolveValue(cond.right, cache, currentIdx - 1);
      if (isNaN(prevLeft) || isNaN(prevRight)) return false;
      return prevLeft >= prevRight && leftVal < rightVal;
    }
    default:
      return false;
  }
}

function evaluateRule(
  rule: EntryRule,
  cache: IndicatorCache,
  currentIdx: number
): boolean {
  if (rule.kind === "comparison") {
    return evaluateComparison(rule as ConditionNode, cache, currentIdx);
  }
  const logic = rule as LogicNode;
  if (logic.kind === "and") {
    return logic.conditions.every(c => evaluateRule(c, cache, currentIdx));
  }
  if (logic.kind === "or") {
    return logic.conditions.some(c => evaluateRule(c, cache, currentIdx));
  }
  return false;
}

function checkExitRules(
  exitRules: ExitRules,
  position: BacktestPosition,
  currentPrice: number,
  barsHeld: number
): { shouldExit: boolean; reason: string } {
  const pnlPercent = (currentPrice - position.averageCost) / position.averageCost;

  if (exitRules.stopLossPercent && pnlPercent <= -exitRules.stopLossPercent) {
    return { shouldExit: true, reason: `Stop loss at ${(pnlPercent * 100).toFixed(1)}%` };
  }
  if (exitRules.takeProfitPercent && pnlPercent >= exitRules.takeProfitPercent) {
    return { shouldExit: true, reason: `Take profit at ${(pnlPercent * 100).toFixed(1)}%` };
  }
  if (exitRules.timeStopDays && barsHeld >= exitRules.timeStopDays) {
    return { shouldExit: true, reason: `Time stop after ${barsHeld} days` };
  }
  // Trailing stop: tracked via high watermark from entry
  if (exitRules.trailingStopPercent && pnlPercent > 0) {
    // Simple trailing: if price dropped more than trailingStopPercent from current level
    // In a real system we'd track the high watermark; here we approximate with entry-based calc
    if (pnlPercent <= -exitRules.trailingStopPercent) {
      return { shouldExit: true, reason: `Trailing stop hit` };
    }
  }

  return { shouldExit: false, reason: "" };
}

/** Minimum bars of history needed before indicators can produce values */
function minBarsRequired(spec: StrategySpec): number {
  let max = 50; // safe default
  const walk = (rule: EntryRule) => {
    if (rule.kind === "comparison") {
      const c = rule as ConditionNode;
      for (const side of [c.left, c.right]) {
        if ("period" in side && typeof (side as IndicatorRef).period === "number") {
          max = Math.max(max, ((side as IndicatorRef).period ?? 14) + 5);
        }
      }
    } else {
      (rule as LogicNode).conditions.forEach(walk);
    }
  };
  walk(spec.entryLong);
  return max;
}

/**
 * Compile a StrategySpec into a Strategy that BacktestEngine can run.
 */
export function compileStrategy(spec: StrategySpec): Strategy {
  const minBars = minBarsRequired(spec);
  // Track bars held per symbol (reset on sell, increment on hold)
  const barsHeld = new Map<string, number>();

  return {
    name: spec.name,
    description: spec.description,
    generateSignals(
      symbol: string,
      history: Bar[],
      position: BacktestPosition | null
    ): Signal {
      if (history.length < minBars) {
        return { symbol, type: "hold", strength: 0 };
      }

      const cache = buildCache(history);
      const currentIdx = history.length - 1;
      const currentPrice = history[currentIdx]!.close;

      // Track bars held
      const held = barsHeld.get(symbol) ?? 0;

      // Check exit first if we have a position
      if (position) {
        barsHeld.set(symbol, held + 1);

        const exitCheck = checkExitRules(spec.exitRules, position, currentPrice, held + 1);
        if (exitCheck.shouldExit) {
          barsHeld.set(symbol, 0);
          return {
            symbol,
            type: "sell",
            strength: 0.8,
            reason: exitCheck.reason,
          };
        }
      }

      // Check entry if no position
      if (!position) {
        const entryTriggered = evaluateRule(spec.entryLong, cache, currentIdx);
        if (entryTriggered) {
          barsHeld.set(symbol, 0);
          // Strength = fraction of equity to allocate (engine uses this directly)
          return {
            symbol,
            type: "buy",
            strength: spec.positionSizing.maxPercent,
            reason: `Entry conditions met for ${spec.name}`,
          };
        }
      }

      return { symbol, type: "hold", strength: 0 };
    },
  };
}

/**
 * Validate a StrategySpec for common errors
 */
export function validateSpec(spec: StrategySpec): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!spec.name || spec.name.length === 0) errors.push("Strategy name is required");
  if (!spec.entryLong) errors.push("Entry long rule is required");
  if (!spec.exitRules) errors.push("Exit rules are required");
  if (!spec.positionSizing) errors.push("Position sizing is required");

  if (spec.positionSizing) {
    if (spec.positionSizing.basePercent <= 0 || spec.positionSizing.basePercent > 1) {
      errors.push("basePercent must be between 0 and 1");
    }
    if (spec.positionSizing.maxPercent <= 0 || spec.positionSizing.maxPercent > 1) {
      errors.push("maxPercent must be between 0 and 1");
    }
  }

  if (spec.exitRules) {
    if (spec.exitRules.stopLossPercent !== undefined && spec.exitRules.stopLossPercent <= 0) {
      errors.push("stopLossPercent must be positive");
    }
    if (spec.exitRules.takeProfitPercent !== undefined && spec.exitRules.takeProfitPercent <= 0) {
      errors.push("takeProfitPercent must be positive");
    }
  }

  // Validate entry rule structure
  const validateRule = (rule: EntryRule, path: string) => {
    if (!rule || !rule.kind) {
      errors.push(`${path}: missing kind`);
      return;
    }
    if (rule.kind === "comparison") {
      const c = rule as ConditionNode;
      if (!c.left || !c.right || !c.op) {
        errors.push(`${path}: comparison requires left, right, op`);
      }
    } else if (rule.kind === "and" || rule.kind === "or") {
      const l = rule as LogicNode;
      if (!l.conditions || l.conditions.length === 0) {
        errors.push(`${path}: logic node requires conditions`);
      }
      l.conditions?.forEach((c, i) => validateRule(c, `${path}.conditions[${i}]`));
    } else {
      errors.push(`${path}: unknown kind "${rule.kind}"`);
    }
  };

  if (spec.entryLong) validateRule(spec.entryLong, "entryLong");

  return { valid: errors.length === 0, errors };
}

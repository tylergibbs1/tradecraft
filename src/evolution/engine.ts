/**
 * Evolution Engine
 *
 * Pipeline: mutate parents -> backtest children -> score -> select survivors.
 */

import { v4 as uuidv4 } from "uuid";
import { BacktestEngine } from "../backtest/engine.js";
import type { BacktestConfig } from "../backtest/types.js";
import type { DataManager } from "../data/index.js";
import { compileStrategy, validateSpec } from "./compiler.js";
import { scoreBacktestResult, summarizeBacktest } from "./scoring.js";
import type { StrategyStore } from "./store.js";
import type {
  ConditionNode,
  EntryRule,
  IndicatorRef,
  LogicNode,
  MutationType,
  StrategyRecord,
  StrategySpec,
} from "./types.js";

export interface EvolutionConfig {
  populationSize: number; // Children per generation
  survivorCount: number; // Keep top N per generation
  backtestConfig: Omit<BacktestConfig, "symbols"> & { symbols?: string[] };
  seed?: number; // Optional PRNG seed for deterministic mutations
}

/**
 * Mulberry32 — a fast, seedable 32-bit PRNG.
 * Returns a function that produces values in [0, 1) like Math.random().
 */
export function createRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  populationSize: 5,
  survivorCount: 3,
  backtestConfig: {
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
    endDate: new Date(),
    initialCapital: 100000,
    commission: 1,
    slippage: 0.05,
  },
};

/**
 * Mutate a StrategySpec to produce a child variant.
 */
export function mutateStrategy(
  spec: StrategySpec,
  mutationType?: MutationType,
  seed?: number,
): { spec: StrategySpec; mutation: MutationType } {
  const rng = createRng(seed);
  const types: MutationType[] = ["adjust_period", "adjust_threshold", "swap_indicator", "adjust_exit", "adjust_sizing"];
  const chosen = mutationType ?? types[Math.floor(rng() * types.length)]!;
  const child = JSON.parse(JSON.stringify(spec)) as StrategySpec;
  child.name = `${spec.name} (mutated)`;

  switch (chosen) {
    case "adjust_period":
      adjustPeriods(child.entryLong, rng);
      break;
    case "adjust_threshold":
      adjustThresholds(child.entryLong, rng);
      break;
    case "swap_indicator":
      swapIndicators(child.entryLong);
      break;
    case "adjust_exit":
      adjustExits(child, rng);
      break;
    case "adjust_sizing":
      adjustSizing(child, rng);
      break;
    case "combine_strategies":
      // Handled separately (needs two parents)
      break;
  }

  return { spec: child, mutation: chosen };
}

function adjustPeriods(rule: EntryRule, rng: () => number): void {
  const walk = (r: EntryRule) => {
    if (r.kind === "comparison") {
      const c = r as ConditionNode;
      for (const side of [c.left, c.right]) {
        if ("period" in side) {
          const ref = side as IndicatorRef;
          if (ref.period) {
            const delta = Math.max(1, Math.round(ref.period * 0.2));
            ref.period += rng() > 0.5 ? delta : -delta;
            ref.period = Math.max(2, ref.period);
          }
        }
      }
    } else {
      (r as LogicNode).conditions.forEach(walk);
    }
  };
  walk(rule);
}

function adjustThresholds(rule: EntryRule, rng: () => number): void {
  const walk = (r: EntryRule) => {
    if (r.kind === "comparison") {
      const c = r as ConditionNode;
      for (const side of [c.left, c.right]) {
        if ("value" in side && typeof (side as { type: string; value: number }).value === "number") {
          const lit = side as { type: string; value: number };
          const delta = Math.abs(lit.value) * 0.15;
          lit.value += rng() > 0.5 ? delta : -delta;
        }
      }
    } else {
      (r as LogicNode).conditions.forEach(walk);
    }
  };
  walk(rule);
}

function swapIndicators(rule: EntryRule): void {
  const walk = (r: EntryRule) => {
    if (r.kind === "comparison") {
      const c = r as ConditionNode;
      for (const side of [c.left, c.right]) {
        if ("type" in side && (side as IndicatorRef).type) {
          const ref = side as IndicatorRef;
          if (ref.type === "SMA") ref.type = "EMA";
          else if (ref.type === "EMA") ref.type = "SMA";
        }
      }
    } else {
      (r as LogicNode).conditions.forEach(walk);
    }
  };
  walk(rule);
}

function adjustExits(spec: StrategySpec, rng: () => number): void {
  const exits = spec.exitRules;
  if (exits.stopLossPercent) {
    exits.stopLossPercent *= 0.8 + rng() * 0.4; // +/- 20%
    exits.stopLossPercent = Math.max(0.01, Math.min(0.2, exits.stopLossPercent));
  }
  if (exits.takeProfitPercent) {
    exits.takeProfitPercent *= 0.8 + rng() * 0.4;
    exits.takeProfitPercent = Math.max(0.02, Math.min(0.5, exits.takeProfitPercent));
  }
  if (exits.trailingStopPercent) {
    exits.trailingStopPercent *= 0.8 + rng() * 0.4;
    exits.trailingStopPercent = Math.max(0.01, Math.min(0.15, exits.trailingStopPercent));
  }
}

function adjustSizing(spec: StrategySpec, rng: () => number): void {
  const sizing = spec.positionSizing;
  sizing.basePercent *= 0.8 + rng() * 0.4;
  sizing.basePercent = Math.max(0.01, Math.min(sizing.maxPercent, sizing.basePercent));
}

/**
 * Combine two parent strategies into a child with AND logic
 */
export function combineStrategies(parent1: StrategySpec, parent2: StrategySpec): StrategySpec {
  return {
    name: `${parent1.name} + ${parent2.name}`,
    description: `Combined strategy: ${parent1.description} AND ${parent2.description}`,
    entryLong: {
      kind: "and",
      conditions: [parent1.entryLong, parent2.entryLong],
    },
    exitRules: {
      stopLossPercent: Math.min(parent1.exitRules.stopLossPercent ?? 0.05, parent2.exitRules.stopLossPercent ?? 0.05),
      takeProfitPercent: Math.max(
        parent1.exitRules.takeProfitPercent ?? 0.1,
        parent2.exitRules.takeProfitPercent ?? 0.1,
      ),
      trailingStopPercent: parent1.exitRules.trailingStopPercent ?? parent2.exitRules.trailingStopPercent,
      timeStopDays: parent1.exitRules.timeStopDays ?? parent2.exitRules.timeStopDays,
    },
    positionSizing: {
      method: parent1.positionSizing.method,
      basePercent: (parent1.positionSizing.basePercent + parent2.positionSizing.basePercent) / 2,
      maxPercent: Math.min(parent1.positionSizing.maxPercent, parent2.positionSizing.maxPercent),
    },
  };
}

export class EvolutionEngine {
  private store: StrategyStore;
  private dataManager: DataManager;
  private evolutionConfig: EvolutionConfig;

  constructor(store: StrategyStore, dataManager: DataManager, config?: Partial<EvolutionConfig>) {
    this.store = store;
    this.dataManager = dataManager;
    this.evolutionConfig = { ...DEFAULT_EVOLUTION_CONFIG, ...config };
  }

  /**
   * Register a new strategy proposed by an agent
   */
  proposeStrategy(spec: StrategySpec): StrategyRecord {
    const validation = validateSpec(spec);
    if (!validation.valid) {
      throw new Error(`Invalid strategy: ${validation.errors.join(", ")}`);
    }

    const record: StrategyRecord = {
      id: uuidv4(),
      spec,
      parentIds: [],
      generation: 0,
      mutations: [],
      status: "proposed",
      createdAt: new Date().toISOString(),
    };

    this.store.add(record);
    return record;
  }

  /**
   * Backtest a strategy and update its record with results
   */
  async backtestStrategy(strategyId: string, symbols: string[]): Promise<StrategyRecord | null> {
    const record = this.store.get(strategyId);
    if (!record) return null;

    const strategy = compileStrategy(record.spec);
    const btConfig: BacktestConfig = {
      ...this.evolutionConfig.backtestConfig,
      symbols,
    };

    const engine = new BacktestEngine(this.dataManager, btConfig);
    const result = await engine.run(strategy);

    const score = scoreBacktestResult(result);
    const summary = summarizeBacktest(result);

    return this.store.update(strategyId, {
      score,
      backtestResult: summary,
      status: "backtested",
    });
  }

  /**
   * Evolve a strategy: create mutated children, backtest, keep best
   */
  async evolveStrategy(parentId: string, symbols: string[], generations: number = 1): Promise<StrategyRecord[]> {
    const parent = this.store.get(parentId);
    if (!parent) throw new Error(`Strategy ${parentId} not found`);

    let currentParents = [parent];
    const allChildren: StrategyRecord[] = [];

    for (let gen = 0; gen < generations; gen++) {
      const children: StrategyRecord[] = [];

      for (const p of currentParents) {
        // Create mutations
        for (let i = 0; i < this.evolutionConfig.populationSize; i++) {
          const { spec: childSpec, mutation } = mutateStrategy(p.spec);
          childSpec.name = `${p.spec.name} G${p.generation + 1}-${i + 1}`;

          const childRecord: StrategyRecord = {
            id: uuidv4(),
            spec: childSpec,
            parentIds: [p.id],
            generation: p.generation + 1,
            mutations: [mutation],
            status: "proposed",
            createdAt: new Date().toISOString(),
          };

          this.store.add(childRecord);

          // Backtest the child
          const strategy = compileStrategy(childSpec);
          const btConfig: BacktestConfig = {
            ...this.evolutionConfig.backtestConfig,
            symbols,
          };

          try {
            const engine = new BacktestEngine(this.dataManager, btConfig);
            const result = await engine.run(strategy);
            const score = scoreBacktestResult(result);
            const summary = summarizeBacktest(result);

            this.store.update(childRecord.id, {
              score,
              backtestResult: summary,
              status: "backtested",
            });

            children.push(this.store.get(childRecord.id)!);
          } catch (_error) {
            // Skip failed backtests
            this.store.update(childRecord.id, { status: "retired" });
          }
        }
      }

      // Select survivors
      const ranked = children
        .filter((c) => c.score !== undefined)
        .sort((a, b) => (b.score?.composite ?? 0) - (a.score?.composite ?? 0));

      currentParents = ranked.slice(0, this.evolutionConfig.survivorCount);
      allChildren.push(...children);
    }

    return allChildren;
  }

  /**
   * Deploy a strategy (mark it as active for live trading)
   */
  deployStrategy(strategyId: string): StrategyRecord | null {
    const record = this.store.get(strategyId);
    if (!record || record.status !== "backtested") return null;

    return this.store.update(strategyId, {
      status: "deployed",
      deployedAt: new Date().toISOString(),
    });
  }

  /**
   * Get evolution results summary
   */
  getResults(): {
    topStrategies: StrategyRecord[];
    deployed: StrategyRecord[];
    stats: ReturnType<StrategyStore["getStats"]>;
  } {
    return {
      topStrategies: this.store.getTopN(10),
      deployed: this.store.getDeployed(),
      stats: this.store.getStats(),
    };
  }
}

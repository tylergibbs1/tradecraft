#!/usr/bin/env bun

/**
 * End-to-end benchmark: Evolution pipeline with real market data
 *
 * Usage:
 *   bun run scripts/benchmark.ts           # normal run
 *   bun run scripts/benchmark.ts --clean   # delete data files first
 *
 * 1. Fetches AAPL, GOOGL, MSFT history via Yahoo
 * 2. Compiles 3 different StrategySpec DSLs
 * 3. Backtests each against real data
 * 4. Evolves the best performer for 2 generations
 * 5. Reports all results with actual P&L numbers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AttributionEngine } from "../src/attribution/engine.js";
import { BacktestEngine } from "../src/backtest/engine.js";
import type { BacktestConfig, BacktestResult } from "../src/backtest/types.js";
import { DataManager } from "../src/data/index.js";
import { compileStrategy, validateSpec } from "../src/evolution/compiler.js";
import { combineStrategies, mutateStrategy } from "../src/evolution/engine.js";
import { scoreBacktestResult, summarizeBacktest } from "../src/evolution/scoring.js";
import { StrategyStore } from "../src/evolution/store.js";
import type { StrategySpec } from "../src/evolution/types.js";
import { MemoryStore } from "../src/memory/store.js";

// --clean flag: delete data files so benchmark starts from scratch
if (process.argv.includes("--clean")) {
  const dataDir = path.join(process.cwd(), "data");
  const filesToDelete = [
    path.join(dataDir, "memory.json"),
    path.join(dataDir, "attribution.json"),
    path.join(dataDir, "agent_performance.json"),
    path.join(dataDir, "strategies", "index.json"),
  ];
  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log(`  Cleaned: ${path.relative(process.cwd(), f)}`);
    }
  }
  console.log();
}

const SYMBOLS = ["AAPL", "GOOGL", "MSFT"];
const START = new Date("2024-01-01");
const END = new Date("2024-12-31");
const CAPITAL = 100000;

const btConfig: BacktestConfig = {
  startDate: START,
  endDate: END,
  initialCapital: CAPITAL,
  symbols: SYMBOLS,
  commission: 1,
  slippage: 0.05,
};

// ─── Strategy Specs ──────────────────────────────────────

const smaCrossover: StrategySpec = {
  name: "SMA 10/50 Crossover",
  description: "Buy when SMA10 crosses above SMA50",
  entryLong: {
    kind: "comparison",
    left: { type: "SMA", period: 10 },
    op: "crosses_above",
    right: { type: "SMA", period: 50 },
  },
  exitRules: {
    stopLossPercent: 0.05,
    takeProfitPercent: 0.12,
    timeStopDays: 30,
  },
  positionSizing: { method: "fixed_percent", basePercent: 0.15, maxPercent: 0.2 },
};

const rsiOversold: StrategySpec = {
  name: "RSI Oversold Bounce",
  description: "Buy when RSI14 drops below 30, sell when above 70",
  entryLong: {
    kind: "comparison",
    left: { type: "RSI", period: 14 },
    op: "lt",
    right: { type: "literal", value: 30 },
  },
  exitRules: {
    stopLossPercent: 0.04,
    takeProfitPercent: 0.08,
    timeStopDays: 20,
  },
  positionSizing: { method: "fixed_percent", basePercent: 0.12, maxPercent: 0.18 },
};

const emaMomentum: StrategySpec = {
  name: "EMA 12/26 Momentum",
  description: "Buy when EMA12 crosses above EMA26 and RSI > 50",
  entryLong: {
    kind: "and",
    conditions: [
      {
        kind: "comparison",
        left: { type: "EMA", period: 12 },
        op: "crosses_above",
        right: { type: "EMA", period: 26 },
      },
      {
        kind: "comparison",
        left: { type: "RSI", period: 14 },
        op: "gt",
        right: { type: "literal", value: 50 },
      },
    ],
  },
  exitRules: {
    stopLossPercent: 0.06,
    takeProfitPercent: 0.15,
    trailingStopPercent: 0.04,
    timeStopDays: 45,
  },
  positionSizing: { method: "fixed_percent", basePercent: 0.15, maxPercent: 0.2 },
};

// ─── Helpers ─────────────────────────────────────────────

function printResult(name: string, r: BacktestResult) {
  const score = scoreBacktestResult(r);
  const pnlColor = r.totalReturn >= 0 ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";

  console.log(`  ${name}`);
  console.log(
    `    Return:       ${pnlColor}${r.totalReturn >= 0 ? "+" : ""}$${r.totalReturn.toFixed(2)} (${(r.totalReturnPercent * 100).toFixed(2)}%)${reset}`,
  );
  console.log(`    Sharpe:       ${r.sharpeRatio.toFixed(3)}`);
  console.log(`    Max Drawdown: ${(r.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`    Win Rate:     ${(r.winRate * 100).toFixed(1)}% (${r.winningTrades}W/${r.losingTrades}L)`);
  console.log(`    Trades:       ${r.totalTrades}`);
  console.log(`    Profit Fctr:  ${r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)}`);
  console.log(`    Avg Win/Loss: $${r.averageWin.toFixed(2)} / $${r.averageLoss.toFixed(2)}`);
  console.log(`    Composite:    ${score.composite.toFixed(4)}`);
  console.log();
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         TRADECRAFT E2E BENCHMARK                        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`Symbols: ${SYMBOLS.join(", ")}`);
  console.log(`Period:  ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}`);
  console.log(`Capital: $${CAPITAL.toLocaleString()}\n`);

  // 1. Fetch data
  console.log("─── Fetching Market Data ───────────────────────────────────\n");
  const polygonKey = process.env.POLYGON_API_KEY;
  const provider = polygonKey ? "polygon" : "yahoo";
  const dm = new DataManager(provider as any, polygonKey);
  console.log(`  Provider: ${provider}\n`);
  for (const sym of SYMBOLS) {
    const bars = await dm.getHistory(sym, "1d", START, END);
    console.log(`  ${sym}: ${bars.length} daily bars`);
  }
  console.log();

  // 2. Validate & compile
  console.log("─── Strategy Validation ───────────────────────────────────\n");
  const specs = [smaCrossover, rsiOversold, emaMomentum];
  for (const spec of specs) {
    const v = validateSpec(spec);
    console.log(`  ${v.valid ? "✓" : "✗"} ${spec.name}`);
    if (!v.valid) console.log(`    Errors: ${v.errors.join(", ")}`);
  }
  console.log();

  // 3. Backtest all strategies
  console.log("─── Backtest Results (Generation 0) ───────────────────────\n");
  const results: { spec: StrategySpec; result: BacktestResult }[] = [];

  for (const spec of specs) {
    const strategy = compileStrategy(spec);
    const engine = new BacktestEngine(dm, btConfig);
    const result = await engine.run(strategy);
    results.push({ spec, result });
    printResult(spec.name, result);
  }

  // Rank by composite score
  results.sort((a, b) => scoreBacktestResult(b.result).composite - scoreBacktestResult(a.result).composite);
  const bestParent = results[0]!;
  const secondBest = results[1]!;
  console.log(
    `  Best: ${bestParent.spec.name} (composite: ${scoreBacktestResult(bestParent.result).composite.toFixed(4)})\n`,
  );

  // 4. Evolve: 2 generations of 5 mutations each
  console.log("─── Evolution (2 Generations × 5 Mutations) ───────────────\n");

  let currentBest = bestParent;
  for (let gen = 1; gen <= 2; gen++) {
    console.log(`  Generation ${gen}:`);
    const children: { spec: StrategySpec; result: BacktestResult; mutation: string }[] = [];

    // 4 point mutations + 1 combination
    const mutTypes = ["adjust_period", "adjust_threshold", "swap_indicator", "adjust_exit", "adjust_sizing"] as const;
    for (let i = 0; i < 5; i++) {
      const { spec: childSpec, mutation } = mutateStrategy(currentBest.spec, mutTypes[i]);
      childSpec.name = `${currentBest.spec.name} G${gen}M${i + 1}`;

      const strategy = compileStrategy(childSpec);
      const engine = new BacktestEngine(dm, btConfig);
      const result = await engine.run(strategy);
      const score = scoreBacktestResult(result);

      children.push({ spec: childSpec, result, mutation });
      console.log(
        `    ${mutation.padEnd(20)} → return: ${(result.totalReturnPercent * 100).toFixed(2)}%, sharpe: ${result.sharpeRatio.toFixed(3)}, composite: ${score.composite.toFixed(4)}`,
      );
    }

    // Also try combining top 2
    const combined = combineStrategies(currentBest.spec, secondBest.spec);
    combined.name = `Combined G${gen}`;
    const combStrategy = compileStrategy(combined);
    const combEngine = new BacktestEngine(dm, btConfig);
    const combResult = await combEngine.run(combStrategy);
    const combScore = scoreBacktestResult(combResult);
    console.log(
      `    ${"combine".padEnd(20)} → return: ${(combResult.totalReturnPercent * 100).toFixed(2)}%, sharpe: ${combResult.sharpeRatio.toFixed(3)}, composite: ${combScore.composite.toFixed(4)}`,
    );
    children.push({ spec: combined, result: combResult, mutation: "combine" });

    // Select best child
    children.sort((a, b) => scoreBacktestResult(b.result).composite - scoreBacktestResult(a.result).composite);
    const genBest = children[0]!;
    const genBestScore = scoreBacktestResult(genBest.result).composite;
    const parentScore = scoreBacktestResult(currentBest.result).composite;

    if (genBestScore > parentScore) {
      console.log(`    Winner: ${genBest.spec.name} (${genBestScore.toFixed(4)} > parent ${parentScore.toFixed(4)})`);
      currentBest = { spec: genBest.spec, result: genBest.result };
    } else {
      console.log(`    No improvement (best child ${genBestScore.toFixed(4)} ≤ parent ${parentScore.toFixed(4)})`);
    }
    console.log();
  }

  // 5. Final champion
  console.log("─── Champion Strategy ─────────────────────────────────────\n");
  printResult(currentBest.spec.name, currentBest.result);

  // 6. Memory — record real observations from real backtest data
  console.log("─── Memory (real observations from backtest) ──────────────\n");
  const memoryStore = new MemoryStore();

  // Record per-strategy real performance observations
  for (const r of results) {
    const closingTrades = r.result.trades.filter((t) => t.pnl !== undefined);
    const bySymbol = new Map<string, { wins: number; losses: number; pnl: number }>();
    for (const t of closingTrades) {
      const entry = bySymbol.get(t.symbol) ?? { wins: 0, losses: 0, pnl: 0 };
      if (t.pnl! > 0) entry.wins++;
      else entry.losses++;
      entry.pnl += t.pnl!;
      bySymbol.set(t.symbol, entry);
    }

    // One memory entry per symbol with real data
    for (const [sym, data] of bySymbol) {
      memoryStore.add({
        type: "trade_lesson",
        content: `${r.spec.name} on ${sym}: ${data.wins}W/${data.losses}L, P&L $${data.pnl.toFixed(2)}`,
        symbols: [sym],
        tags: ["backtest", r.spec.name.toLowerCase().replace(/\s+/g, "-")],
        confidence: r.result.winRate,
        source: "backtest",
      });
    }

    // Strategy-level observation
    memoryStore.add({
      type: "strategy_learning",
      content: `${r.spec.name}: ${(r.result.totalReturnPercent * 100).toFixed(2)}% return, Sharpe ${r.result.sharpeRatio.toFixed(2)}, ${r.result.totalTrades} trades, ${(r.result.winRate * 100).toFixed(0)}% win rate over ${r.result.tradingDays} days`,
      symbols: SYMBOLS,
      tags: ["backtest", "performance"],
      confidence: r.result.winRate,
      source: "backtest",
    });
  }

  // Champion observation
  memoryStore.add({
    type: "strategy_learning",
    content: `Evolution champion ${currentBest.spec.name}: ${(currentBest.result.totalReturnPercent * 100).toFixed(2)}% return, Sharpe ${currentBest.result.sharpeRatio.toFixed(2)}, max DD ${(currentBest.result.maxDrawdown * 100).toFixed(2)}%`,
    symbols: SYMBOLS,
    tags: ["evolution", "champion"],
    confidence: currentBest.result.winRate,
    source: "backtest",
  });

  const ctx = memoryStore.buildMemoryContext(SYMBOLS);
  console.log(`  Memory entries:  ${memoryStore.getCount()}`);
  console.log(`  Context length:  ${ctx.length} chars`);
  console.log(
    `  Sample context:\n${ctx
      .split("\n")
      .slice(0, 6)
      .map((l) => `    ${l}`)
      .join("\n")}`,
  );

  // 7. Attribution — each strategy is an agent, each real trade is a real signal
  console.log("\n─── Attribution (real trades → real P&L) ──────────────────\n");
  const attribution = new AttributionEngine();

  // Map strategy name to agent role
  const strategyAgentMap: Record<string, string> = {
    "SMA 10/50 Crossover": "sma-crossover-agent",
    "RSI Oversold Bounce": "rsi-reversal-agent",
    "EMA 12/26 Momentum": "ema-momentum-agent",
  };

  // Equal initial weights since we have no prior
  const numStrategies = results.length;
  const equalWeight = 1 / numStrategies;

  for (const r of results) {
    const agentRole = strategyAgentMap[r.spec.name] ?? r.spec.name;
    const closingTrades = r.result.trades.filter((t) => t.pnl !== undefined);

    for (const trade of closingTrades) {
      // Real trade ID, real symbol, real side, real P&L
      const tradeId = `${agentRole}-${trade.symbol}-${trade.timestamp}`;
      attribution.recordAttribution(tradeId, trade.symbol, trade.side, trade.pnl!, [
        {
          signalId: tradeId,
          agentRole,
          signal: trade.side.toUpperCase(),
          confidence: r.result.winRate, // strategy's actual win rate as confidence
          weight: equalWeight,
        },
      ]);
    }
  }

  const perfs = attribution.getPerformance();
  console.log(`  Strategies tracked: ${perfs.length}`);
  for (const p of perfs) {
    console.log(
      `    ${p.agentRole.padEnd(22)} ${p.totalSignals} trades, accuracy ${(p.accuracy * 100).toFixed(0)}%, P&L $${p.totalAttributedPnl.toFixed(2)}`,
    );
  }

  // Weight adjustments from real performance data
  const currentWeights: Record<string, number> = {};
  for (const p of perfs) {
    currentWeights[p.agentRole] = equalWeight;
  }
  const adjustments = attribution.calculateWeightAdjustments(currentWeights);
  if (adjustments.length > 0) {
    console.log("\n  Weight adjustments (from real accuracy + P&L):");
    for (const adj of adjustments) {
      console.log(
        `    ${adj.agentRole.padEnd(22)} ${(adj.previousWeight * 100).toFixed(1)}% → ${(adj.newWeight * 100).toFixed(1)}% (${adj.reason})`,
      );
    }
  } else {
    console.log("\n  No weight adjustments (need ≥5 signals per agent)");
  }

  // 7. Strategy store persistence
  console.log("\n─── Strategy Store ────────────────────────────────────────\n");
  const store = new StrategyStore();
  const storedRecord = {
    id: crypto.randomUUID(),
    spec: currentBest.spec,
    parentIds: [],
    generation: 2,
    mutations: [],
    status: "backtested" as const,
    createdAt: new Date().toISOString(),
    score: scoreBacktestResult(currentBest.result),
    backtestResult: summarizeBacktest(currentBest.result),
  };
  store.add(storedRecord);
  const stats = store.getStats();
  console.log(`  Stored strategies: ${stats.total}`);
  console.log(`  Best composite:    ${stats.bestScore.toFixed(4)}`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Benchmark complete. All systems operational.");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Benchmark failed:", e);
  process.exit(1);
});

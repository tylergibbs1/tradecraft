#!/usr/bin/env bun

/**
 * Multi-Model Tournament
 *
 * Runs the same agent backtest across multiple Claude models to answer:
 * "Do LLMs as a class outperform active allocators?"
 *
 * Usage:
 *   bun run scripts/tournament.ts                    # default: 3 months weekly
 *   bun run scripts/tournament.ts --months 6         # 6 months
 *   bun run scripts/tournament.ts --frequency 1      # daily cycles (expensive)
 *
 * Cost estimate: ~$5-20 depending on models and duration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
// @ts-expect-error -- asciichart has no type declarations
import asciichart from "asciichart";
import {
  type AgentBacktestConfig,
  AgentBacktestEngine,
  type AgentBacktestResult,
} from "../src/backtest/agent-engine.js";
import { STATIC_BENCHMARKS } from "../src/backtest/benchmarks.js";
import { type ModelResult, TOURNAMENT_MODELS, type TournamentResult } from "../src/backtest/tournament-types.js";
import type { DataProvider } from "../src/config/schema.js";
import { DataManager } from "../src/data/index.js";

// ─── Config ─────────────────────────────────────────────

const SYMBOLS = ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA"];
const CAPITAL = 100000;
const DEFAULT_RISK_LIMITS = {
  maxPositionSize: 0.1,
  maxPositionCount: 10,
  dailyLossLimit: 0.02,
  weeklyLossLimit: 0.05,
  maxDrawdown: 0.1,
  maxOrderValue: 10000,
};

// Parse CLI args
const monthsArg = process.argv.find((a) => a.startsWith("--months="));
const freqArg = process.argv.find((a) => a.startsWith("--frequency="));
const months = monthsArg ? Number.parseInt(monthsArg.split("=")[1]!, 10) : 3;
const frequency = freqArg ? Number.parseInt(freqArg.split("=")[1]!, 10) : 5; // weekly default

const END = new Date("2024-12-31");
const START = new Date(END);
START.setMonth(START.getMonth() - months);

// ─── Helpers ────────────────────────────────────────────

function estimateCost(model: (typeof TOURNAMENT_MODELS)[number], result: AgentBacktestResult): number {
  // Rough 60/40 input/output split
  const inputTokens = Math.round(result.totalTokens * 0.6);
  const outputTokens = result.totalTokens - inputTokens;
  return inputTokens * model.costPerInputToken + outputTokens * model.costPerOutputToken;
}

function modelResultFromBacktest(model: (typeof TOURNAMENT_MODELS)[number], result: AgentBacktestResult): ModelResult {
  const inputTokens = Math.round(result.totalTokens * 0.6);
  const outputTokens = result.totalTokens - inputTokens;

  return {
    modelId: model.id,
    modelName: model.name,
    totalReturn: result.totalReturn,
    totalReturnPercent: result.totalReturnPercent,
    sharpeRatio: result.sharpeRatio,
    maxDrawdown: result.maxDrawdown,
    winRate: result.winRate,
    totalTrades: result.totalTrades,
    inputTokens,
    outputTokens,
    estimatedCost: estimateCost(model, result),
    equityCurve: result.equityCurve.map((p) => ({
      timestamp: new Date(p.date).getTime(),
      equity: p.equity,
    })),
  };
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         MULTI-MODEL TOURNAMENT                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`Symbols:    ${SYMBOLS.join(", ")}`);
  console.log(`Period:     ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}`);
  console.log(`Capital:    $${CAPITAL.toLocaleString()}`);
  console.log(`Frequency:  Every ${frequency} trading day(s)`);
  console.log(`Models:     ${TOURNAMENT_MODELS.map((m) => m.name).join(", ")}`);
  console.log();

  // Initialize data manager
  const polygonKey = process.env.POLYGON_API_KEY;
  const provider = polygonKey ? "polygon" : "yahoo";
  const dm = new DataManager(provider as DataProvider, polygonKey);
  console.log(`Data provider: ${provider}\n`);

  const modelResults: ModelResult[] = [];

  // Run each model sequentially (to avoid rate limits)
  for (const model of TOURNAMENT_MODELS) {
    console.log(`─── ${model.name} (${model.id}) ${"─".repeat(40)}\n`);

    const config: AgentBacktestConfig = {
      startDate: START,
      endDate: END,
      initialCapital: CAPITAL,
      symbols: SYMBOLS,
      model: model.id,
      maxTurnsPerCycle: 8,
      allowShorts: false,
      riskLimits: DEFAULT_RISK_LIMITS,
      cycleFrequency: frequency,
    };

    try {
      const engine = new AgentBacktestEngine(apiKey, dm, config);
      const result = await engine.run((msg) => console.log(`  ${msg}`));

      const mr = modelResultFromBacktest(model, result);
      modelResults.push(mr);

      const returnColor = mr.totalReturnPercent >= 0 ? "\x1b[32m" : "\x1b[31m";
      const reset = "\x1b[0m";

      console.log();
      console.log(`  Return:   ${returnColor}${(mr.totalReturnPercent * 100).toFixed(2)}%${reset}`);
      console.log(`  Sharpe:   ${mr.sharpeRatio.toFixed(3)}`);
      console.log(`  Max DD:   ${(mr.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`  Win Rate: ${(mr.winRate * 100).toFixed(1)}%`);
      console.log(`  Trades:   ${mr.totalTrades}`);
      console.log(`  Cost:     $${mr.estimatedCost.toFixed(2)}`);
      console.log();
    } catch (error) {
      console.log(`  Error: ${error}\n`);
    }
  }

  if (modelResults.length === 0) {
    console.log("No models completed successfully.");
    process.exit(1);
  }

  // ─── Results Table ──────────────────────────────────────

  console.log("─── Tournament Results ────────────────────────────────────\n");
  console.log(
    `  ${"Model".padEnd(20)} ${"Return".padStart(10)} ${"Sharpe".padStart(8)} ${"Max DD".padStart(8)} ${"Win Rate".padStart(10)} ${"Trades".padStart(8)} ${"Cost".padStart(10)}`,
  );
  console.log(`  ${"─".repeat(76)}`);

  const ranked = [...modelResults].sort((a, b) => b.totalReturnPercent - a.totalReturnPercent);

  for (const mr of ranked) {
    const returnColor = mr.totalReturnPercent >= 0 ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(
      `  ${mr.modelName.padEnd(20)} ${returnColor}${(`${(mr.totalReturnPercent * 100).toFixed(2)}%`).padStart(10)}${reset} ${mr.sharpeRatio.toFixed(2).padStart(8)} ${(`${(mr.maxDrawdown * 100).toFixed(2)}%`).padStart(8)} ${(`${(mr.winRate * 100).toFixed(1)}%`).padStart(10)} ${String(mr.totalTrades).padStart(8)} ${(`$${mr.estimatedCost.toFixed(2)}`).padStart(10)}`,
    );
  }
  console.log();

  // ─── LLMs as a Class ───────────────────────────────────

  console.log("─── LLMs as a Class ──────────────────────────────────────\n");

  const avgReturn = modelResults.reduce((s, m) => s + m.totalReturnPercent, 0) / modelResults.length;
  const avgSharpe = modelResults.reduce((s, m) => s + m.sharpeRatio, 0) / modelResults.length;
  const avgDD = modelResults.reduce((s, m) => s + m.maxDrawdown, 0) / modelResults.length;
  const avgWinRate = modelResults.reduce((s, m) => s + m.winRate, 0) / modelResults.length;

  console.log(`  Avg Return:   ${(avgReturn * 100).toFixed(2)}%`);
  console.log(`  Avg Sharpe:   ${avgSharpe.toFixed(3)}`);
  console.log(`  Avg Max DD:   ${(avgDD * 100).toFixed(2)}%`);
  console.log(`  Avg Win Rate: ${(avgWinRate * 100).toFixed(1)}%`);
  console.log();

  // Compare vs active benchmarks
  const tradingDays = modelResults[0]!.equityCurve.length;
  const years = tradingDays / 252;

  const vsActive: TournamentResult["vsActiveBenchmarks"] = [];
  for (const [_key, bm] of Object.entries(STATIC_BENCHMARKS)) {
    const bmReturn = (1 + bm.annualizedReturn) ** years - 1;
    const classBeat = avgReturn > bmReturn;
    vsActive.push({
      benchmarkName: bm.name,
      benchmarkReturn: bmReturn,
      classReturn: avgReturn,
      classBeatsBenchmark: classBeat,
    });
    const icon = classBeat ? "✓" : "✗";
    console.log(
      `  ${icon} vs ${bm.name}: LLM class ${(avgReturn * 100).toFixed(2)}% vs benchmark ${(bmReturn * 100).toFixed(2)}%`,
    );
  }
  console.log();

  // ─── Equity Curve Overlay ─────────────────────────────

  console.log("─── Equity Curves ────────────────────────────────────────\n");
  try {
    const series = modelResults.map((mr) => mr.equityCurve.map((p) => p.equity));
    const colors = [asciichart.green, asciichart.blue, asciichart.red, asciichart.yellow, asciichart.cyan];

    if (series.length > 0 && series[0]!.length > 0) {
      const chart = asciichart.plot(series, {
        height: 12,
        padding: "    ",
        colors: colors.slice(0, series.length),
      });
      console.log(chart);
      console.log();

      // Legend
      for (let i = 0; i < modelResults.length; i++) {
        const colorNames = ["green", "blue", "red", "yellow", "cyan"];
        console.log(`  ${colorNames[i] ?? "—"}: ${modelResults[i]!.modelName}`);
      }
      console.log();
    }
  } catch {
    console.log("  (Chart rendering failed — see data/tournament_results.json for raw data)\n");
  }

  // ─── Save Results ─────────────────────────────────────

  const tournamentResult: TournamentResult = {
    models: modelResults,
    bestModel: ranked[0]!.modelName,
    classPerformance: {
      avgReturn,
      avgSharpe,
      avgMaxDrawdown: avgDD,
      avgWinRate,
    },
    vsActiveBenchmarks: vsActive,
    rankedModels: ranked.map((m) => m.modelName),
    config: {
      symbols: SYMBOLS,
      startDate: START.toISOString().slice(0, 10),
      endDate: END.toISOString().slice(0, 10),
      initialCapital: CAPITAL,
    },
    completedAt: new Date().toISOString(),
  };

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(path.join(dataDir, "tournament_results.json"), JSON.stringify(tournamentResult, null, 2));
  console.log("Results saved to data/tournament_results.json\n");

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Best model: ${ranked[0]!.modelName} (${(ranked[0]!.totalReturnPercent * 100).toFixed(2)}%)`);
  console.log(`  LLM class avg: ${(avgReturn * 100).toFixed(2)}% return, ${avgSharpe.toFixed(2)} Sharpe`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Tournament failed:", e);
  process.exit(1);
});

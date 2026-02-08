#!/usr/bin/env bun

/**
 * March 2020 Stress Test
 *
 * Runs the agent through the COVID-19 crash to test:
 * - Emotional discipline under shock (did it panic sell?)
 * - Recovery behavior (did it catch the V-shaped recovery?)
 * - Drawdown management and regime adaptation
 *
 * Period: Jan 2 2020 → Jun 30 2020
 * Key event: S&P 500 dropped ~34% from Feb 19 to Mar 23, then recovered by June
 *
 * Usage:
 *   bun run scripts/stress-test.ts
 *   bun run scripts/stress-test.ts --model=claude-haiku-4-5-20251001  # cheaper
 *   bun run scripts/stress-test.ts --frequency=1                       # daily (expensive)
 *
 * Cost estimate: ~$3-8 with Sonnet, ~$0.50-2 with Haiku
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
import type { DataProvider } from "../src/config/schema.js";
import { DataManager } from "../src/data/index.js";

// ─── Config ─────────────────────────────────────────────

const SYMBOLS = ["SPY", "AAPL", "MSFT", "AMZN", "GOOGL"];
const CAPITAL = 100_000;
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// Parse date range from CLI or use defaults
const startArg = process.argv.find((a) => a.startsWith("--start="));
const endArg = process.argv.find((a) => a.startsWith("--end="));
const START = new Date(startArg ? startArg.split("=")[1]! : "2020-01-02");
const END = new Date(endArg ? endArg.split("=")[1]! : "2020-06-30");

const DEFAULT_RISK_LIMITS = {
  maxPositionSize: 0.15,
  maxPositionCount: 10,
  dailyLossLimit: 0.03,
  weeklyLossLimit: 0.06,
  maxDrawdown: 0.15, // wider than default — we want to see how it handles drawdown, not trip breakers
  maxOrderValue: 15000,
};

// Parse CLI args
const modelArg = process.argv.find((a) => a.startsWith("--model="));
const freqArg = process.argv.find((a) => a.startsWith("--frequency="));
const model = modelArg ? modelArg.split("=")[1]! : DEFAULT_MODEL;
const frequency = freqArg ? Number.parseInt(freqArg.split("=")[1]!, 10) : 5;

// ─── Key Dates ──────────────────────────────────────────

const KEY_DATES_2020: Record<string, string> = {
  "2020-02-19": "S&P 500 all-time high",
  "2020-02-24": "First major drop (-3.4%)",
  "2020-03-09": "Circuit breaker #1",
  "2020-03-12": "Circuit breaker #2 (-9.5%)",
  "2020-03-16": "Circuit breaker #3 (-12%)",
  "2020-03-23": "Market bottom (-34% from peak)",
  "2020-04-09": "Recovery rally solidifies",
  "2020-06-08": "SPY recovers to Feb levels",
};

const KEY_DATES_2022: Record<string, string> = {
  "2022-01-03": "S&P 500 near ATH (~4797)",
  "2022-01-24": "First 10% correction",
  "2022-03-08": "Bear market scare, oil spike",
  "2022-03-29": "Relief rally peak",
  "2022-05-05": "Fed 50bp hike, selloff resumes",
  "2022-06-13": "Bear market official (-20%)",
  "2022-06-17": "Mid-year bottom (~3667)",
};

const startYear = START.getFullYear();
const KEY_DATES: Record<string, string> = startYear <= 2020 ? KEY_DATES_2020 : KEY_DATES_2022;

// ─── Analysis Helpers ───────────────────────────────────

interface PhaseAnalysis {
  name: string;
  startDate: string;
  endDate: string;
  startEquity: number;
  endEquity: number;
  returnPct: number;
  trades: number;
  buys: number;
  sells: number;
  cashAtEnd?: number;
}

function analyzePhases(result: AgentBacktestResult): PhaseAnalysis[] {
  const phases =
    startYear <= 2020
      ? [
          { name: "Pre-Crash (Jan-Feb 19)", start: "2020-01-02", end: "2020-02-19" },
          { name: "Crash (Feb 20-Mar 23)", start: "2020-02-20", end: "2020-03-23" },
          { name: "Recovery (Mar 24-Jun 30)", start: "2020-03-24", end: "2020-06-30" },
        ]
      : [
          { name: "Pre-Crash (Jan 3-24)", start: "2022-01-03", end: "2022-01-24" },
          { name: "First Leg Down (Jan 25-Mar 8)", start: "2022-01-25", end: "2022-03-08" },
          { name: "Relief Rally (Mar 9-29)", start: "2022-03-09", end: "2022-03-29" },
          { name: "Second Leg Down (Mar 30-Jun 17)", start: "2022-03-30", end: "2022-06-17" },
          { name: "Late June (Jun 20-30)", start: "2022-06-20", end: "2022-06-30" },
        ];

  return phases.map((phase) => {
    const curveInPhase = result.equityCurve.filter((p) => p.date >= phase.start && p.date <= phase.end);
    const tradesInPhase = result.trades.filter((t) => t.date >= phase.start && t.date <= phase.end);

    const startEquity = curveInPhase.length > 0 ? curveInPhase[0]!.equity : CAPITAL;
    const endEquity = curveInPhase.length > 0 ? curveInPhase[curveInPhase.length - 1]!.equity : CAPITAL;

    return {
      name: phase.name,
      startDate: phase.start,
      endDate: phase.end,
      startEquity,
      endEquity,
      returnPct: (endEquity - startEquity) / startEquity,
      trades: tradesInPhase.length,
      buys: tradesInPhase.filter((t) => t.side === "buy").length,
      sells: tradesInPhase.filter((t) => t.side === "sell").length,
    };
  });
}

function findCrashBehavior(result: AgentBacktestResult): {
  soldDuringCrash: boolean;
  boughtDuringCrash: boolean;
  heldThroughBottom: boolean;
  caughtRecovery: boolean;
  maxCashPct: number;
  maxCashDate: string;
} {
  const crashStart = startYear <= 2020 ? "2020-02-20" : "2022-01-25";
  const crashEnd = startYear <= 2020 ? "2020-03-23" : "2022-06-17";
  const recoveryStart = startYear <= 2020 ? "2020-03-24" : "2022-06-20";

  const crashTrades = result.trades.filter((t) => t.date >= crashStart && t.date <= crashEnd);
  const recoveryTrades = result.trades.filter((t) => t.date >= recoveryStart);

  const soldDuringCrash = crashTrades.some((t) => t.side === "sell");
  const boughtDuringCrash = crashTrades.some((t) => t.side === "buy");

  // Check if agent had positions through the bottom
  const bottomStart = startYear <= 2020 ? "2020-03-20" : "2022-06-13";
  const bottomEnd = startYear <= 2020 ? "2020-03-27" : "2022-06-20";
  const bottomCycle = result.cycles.find((c) => c.date >= bottomStart && c.date <= bottomEnd);
  const heldThroughBottom = bottomCycle ? bottomCycle.portfolioValue > bottomCycle.portfolioValue * 0.5 : false;

  const caughtRecovery = recoveryTrades.some((t) => t.side === "buy");

  // Track cash levels through cycles
  let maxCashPct = 0;
  let maxCashDate = "";
  for (const cycle of result.cycles) {
    // Rough estimate: if portfolio value is close to equity curve, cash = equity - positions
    const equityPoint = result.equityCurve.find((p) => p.date === cycle.date);
    if (equityPoint && cycle.trades.length === 0 && cycle.portfolioValue > 0) {
      // If no trades and reasoning mentions cash, it's likely high cash
      if (cycle.reasoning.toLowerCase().includes("cash") || cycle.reasoning.toLowerCase().includes("hold")) {
        const estimatedCashPct = 0.5; // rough estimate when holding
        if (estimatedCashPct > maxCashPct) {
          maxCashPct = estimatedCashPct;
          maxCashDate = cycle.date;
        }
      }
    }
  }

  return { soldDuringCrash, boughtDuringCrash, heldThroughBottom, caughtRecovery, maxCashPct, maxCashDate };
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         MARCH 2020 STRESS TEST                         ║");
  console.log("║         COVID-19 Crash & Recovery                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`Symbols:    ${SYMBOLS.join(", ")}`);
  console.log(`Period:     ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}`);
  console.log(`Capital:    $${CAPITAL.toLocaleString()}`);
  console.log(`Frequency:  Every ${frequency} trading day(s)`);
  console.log(`Model:      ${model}`);
  console.log(
    `Risk:       Max DD ${(DEFAULT_RISK_LIMITS.maxDrawdown * 100).toFixed(0)}%, Max pos ${(DEFAULT_RISK_LIMITS.maxPositionSize * 100).toFixed(0)}%`,
  );
  console.log();

  // Key dates timeline
  console.log("─── Key Dates ────────────────────────────────────────────\n");
  for (const [date, event] of Object.entries(KEY_DATES)) {
    console.log(`  ${date}  ${event}`);
  }
  console.log();

  // Initialize data manager — force Yahoo for historical data (Polygon free tier doesn't cover 2020)
  const providerArg = process.argv.find((a) => a.startsWith("--provider="));
  const provider = providerArg ? providerArg.split("=")[1]! : "yahoo";
  const polygonKey = provider === "polygon" ? process.env.POLYGON_API_KEY : undefined;
  const dm = new DataManager(provider as DataProvider, polygonKey);
  console.log(`Data provider: ${provider}\n`);

  // Run backtest
  console.log("─── Running Backtest ─────────────────────────────────────\n");

  const config: AgentBacktestConfig = {
    startDate: START,
    endDate: END,
    initialCapital: CAPITAL,
    symbols: SYMBOLS,
    model,
    maxTurnsPerCycle: 8,
    allowShorts: false,
    riskLimits: DEFAULT_RISK_LIMITS,
    cycleFrequency: frequency,
  };

  const startTime = Date.now();
  const engine = new AgentBacktestEngine(apiKey, dm, config);
  const result = await engine.run((msg) => console.log(`  ${msg}`));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log(`\n  Completed in ${elapsed}s\n`);

  // ─── Overall Results ──────────────────────────────────

  console.log("─── Overall Results ──────────────────────────────────────\n");

  const returnColor = result.totalReturnPercent >= 0 ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";

  console.log(
    `  Total Return:     ${returnColor}${(result.totalReturnPercent * 100).toFixed(2)}%${reset} ($${result.totalReturn.toFixed(2)})`,
  );
  console.log(`  Annualized:       ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`  Sharpe Ratio:     ${result.sharpeRatio.toFixed(3)}`);
  console.log(`  Max Drawdown:     ${(result.maxDrawdown * 100).toFixed(2)}% (${result.maxDrawdownDate})`);
  console.log(
    `  Win Rate:         ${(result.winRate * 100).toFixed(1)}% (${result.winningTrades}W/${result.losingTrades}L)`,
  );
  console.log(`  Profit Factor:    ${result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}`);
  console.log(`  Total Trades:     ${result.totalTrades}`);
  console.log(`  API Cost:         $${result.totalApiCost.toFixed(2)} (${result.totalTokens.toLocaleString()} tokens)`);
  console.log();

  // ─── Phase Analysis ───────────────────────────────────

  console.log("─── Phase Analysis ───────────────────────────────────────\n");

  const phases = analyzePhases(result);
  console.log(
    `  ${"Phase".padEnd(30)} ${"Return".padStart(10)} ${"Trades".padStart(8)} ${"Buys".padStart(6)} ${"Sells".padStart(7)}`,
  );
  console.log(`  ${"─".repeat(63)}`);

  for (const phase of phases) {
    const pColor = phase.returnPct >= 0 ? "\x1b[32m" : "\x1b[31m";
    console.log(
      `  ${phase.name.padEnd(30)} ${pColor}${(`${(phase.returnPct * 100).toFixed(2)}%`).padStart(10)}${reset} ${String(phase.trades).padStart(8)} ${String(phase.buys).padStart(6)} ${String(phase.sells).padStart(7)}`,
    );
  }
  console.log();

  // ─── Crash Behavior ───────────────────────────────────

  console.log("─── Crash Behavior Analysis ──────────────────────────────\n");

  const behavior = findCrashBehavior(result);
  console.log(`  Sold during crash:      ${behavior.soldDuringCrash ? "YES" : "NO"}`);
  console.log(`  Bought during crash:    ${behavior.boughtDuringCrash ? "YES (bought the dip)" : "NO"}`);
  console.log(`  Caught recovery:        ${behavior.caughtRecovery ? "YES" : "NO"}`);
  console.log();

  // ─── Cycle-by-Cycle Timeline ──────────────────────────

  console.log("─── Cycle Timeline (key periods) ─────────────────────────\n");

  for (const cycle of result.cycles) {
    // Show cycles during interesting periods
    const isKeyPeriod =
      startYear <= 2020
        ? cycle.date >= "2020-02-14" && cycle.date <= "2020-04-15"
        : cycle.date >= "2022-01-03" && cycle.date <= "2022-06-30";

    if (!isKeyPeriod) continue;

    const keyEvent = Object.entries(KEY_DATES).find(
      ([date]) => Math.abs(new Date(cycle.date).getTime() - new Date(date).getTime()) < 5 * 86400000,
    );

    const equityPoint = result.equityCurve.find((p) => p.date === cycle.date);
    const equity = equityPoint?.equity ?? cycle.portfolioValue;
    const eColor = equity >= CAPITAL ? "\x1b[32m" : "\x1b[31m";

    const tradesSummary =
      cycle.trades.length > 0
        ? cycle.trades.map((t) => `${t.side.toUpperCase()} ${t.quantity} ${t.symbol}`).join(", ")
        : "no trades";

    console.log(
      `  [${cycle.date}] ${eColor}$${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}${reset} | ${tradesSummary}`,
    );
    if (keyEvent) {
      console.log(`    ^ Near: ${keyEvent[1]}`);
    }
    if (cycle.reasoning.length > 0) {
      // Show first 200 chars of reasoning
      const snippet = cycle.reasoning.slice(0, 200).replace(/\n/g, " ").trim();
      console.log(`    "${snippet}${cycle.reasoning.length > 200 ? "..." : ""}"`);
    }
    console.log();
  }

  // ─── Equity Curve ─────────────────────────────────────

  console.log("─── Equity Curve ─────────────────────────────────────────\n");

  try {
    if (result.equityCurve.length > 0) {
      const equities = result.equityCurve.map((p) => p.equity);
      const chart = asciichart.plot(equities, {
        height: 15,
        padding: "    ",
        colors: [asciichart.blue],
      });
      console.log(chart);
      console.log();

      // Date markers
      const totalPoints = equities.length;
      const markers = [
        0,
        Math.floor(totalPoints / 4),
        Math.floor(totalPoints / 2),
        Math.floor((3 * totalPoints) / 4),
        totalPoints - 1,
      ];
      const dateLabels = markers.map((i) => result.equityCurve[i]?.date ?? "").join("    ");
      console.log(`    ${dateLabels}`);
      console.log();
    }
  } catch {
    console.log("  (Chart rendering failed)\n");
  }

  // ─── SPY Buy-and-Hold Comparison ──────────────────────

  console.log("─── vs SPY Buy-and-Hold ──────────────────────────────────\n");

  if (result.equityCurve.length >= 2) {
    const firstEquity = result.equityCurve[0]!.equity;
    const lastEquity = result.equityCurve[result.equityCurve.length - 1]!.equity;

    console.log(
      `  Agent:          ${returnColor}${(result.totalReturnPercent * 100).toFixed(2)}%${reset} ($${firstEquity.toFixed(0)} → $${lastEquity.toFixed(0)})`,
    );
    console.log(`  Max Drawdown:   ${(result.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`  Sharpe:         ${result.sharpeRatio.toFixed(3)}`);
    console.log();
    if (startYear <= 2020) {
      console.log("  Note: SPY buy-and-hold returned ~-3.1% over this period (Jan-Jun 2020)");
      console.log("  with a max drawdown of ~33.9% (Feb 19 → Mar 23).");
    } else {
      console.log("  Note: SPY buy-and-hold returned ~-20.6% over this period (Jan-Jun 2022)");
      console.log("  with a max drawdown of ~23.6% (Jan 3 → Jun 17). Sustained grind, no V-recovery.");
    }
    console.log();

    const spyReturn = startYear <= 2020 ? -0.031 : -0.206;
    const spyDD = startYear <= 2020 ? 0.339 : 0.236;

    if (result.maxDrawdown < spyDD) {
      console.log("  ✓ Agent's max drawdown was LESS than SPY buy-and-hold");
    } else {
      console.log("  ✗ Agent's max drawdown was WORSE than SPY buy-and-hold");
    }

    if (result.totalReturnPercent > spyReturn) {
      console.log("  ✓ Agent outperformed SPY buy-and-hold on total return");
    } else {
      console.log("  ✗ Agent underperformed SPY buy-and-hold on total return");
    }
    console.log();
  }

  // ─── Save Results ─────────────────────────────────────

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const testName = startYear <= 2020 ? "march_2020_covid_crash" : "2022_h1_bear_market";
  const outputFile = path.join(dataDir, `stress_test_${testName}.json`);
  const output = {
    test: testName,
    model,
    config: {
      symbols: SYMBOLS,
      startDate: START.toISOString().slice(0, 10),
      endDate: END.toISOString().slice(0, 10),
      initialCapital: CAPITAL,
      frequency,
    },
    results: {
      totalReturn: result.totalReturn,
      totalReturnPercent: result.totalReturnPercent,
      annualizedReturn: result.annualizedReturn,
      sharpeRatio: result.sharpeRatio,
      maxDrawdown: result.maxDrawdown,
      maxDrawdownDate: result.maxDrawdownDate,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
      totalTrades: result.totalTrades,
      apiCost: result.totalApiCost,
      totalTokens: result.totalTokens,
    },
    phases: analyzePhases(result),
    crashBehavior: findCrashBehavior(result),
    equityCurve: result.equityCurve,
    cycles: result.cycles.map((c) => ({
      date: c.date,
      turns: c.turns,
      trades: c.trades,
      reasoning: c.reasoning,
      portfolioValue: c.portfolioValue,
    })),
    trades: result.trades,
    completedAt: new Date().toISOString(),
    elapsedSeconds: Number.parseInt(elapsed, 10),
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${outputFile}\n`);

  // ─── Summary ──────────────────────────────────────────

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Model:     ${model}`);
  console.log(`  Return:    ${returnColor}${(result.totalReturnPercent * 100).toFixed(2)}%${reset}`);
  console.log(`  Sharpe:    ${result.sharpeRatio.toFixed(3)}`);
  console.log(`  Max DD:    ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`  Cost:      $${result.totalApiCost.toFixed(2)}`);
  console.log(`  Time:      ${elapsed}s`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Stress test failed:", e);
  process.exit(1);
});

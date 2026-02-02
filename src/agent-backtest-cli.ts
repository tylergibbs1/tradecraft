#!/usr/bin/env bun
import { DataManager } from "./data/index.js";
import { AgentBacktestEngine, AgentBacktestConfig, AgentBacktestResult } from "./backtest/agent-engine.js";
import { loadConfig, configExists } from "./config/index.js";
import * as asciichart from "asciichart";

function printUsage(): void {
  console.log(`
Usage: bun run agent-backtest [options]

Backtest the Claude trading agent on historical data.

Options:
  --start <date>      Start date (YYYY-MM-DD), default: 3 months ago
  --end <date>        End date (YYYY-MM-DD), default: today
  --capital <num>     Initial capital, default: from config
  --symbols <list>    Comma-separated symbols, default: from config
  --frequency <num>   Cycle every N trading days (1=daily, 5=weekly), default: 5
  --model <name>      Model to use, default: from config

Example:
  bun run agent-backtest --start 2024-10-01 --frequency 5 --symbols AAPL,GOOGL,MSFT

⚠️  WARNING: This will make API calls to Claude. Estimated cost:
  - Weekly cycles (--frequency 5): ~$0.10-0.20 per week
  - Daily cycles (--frequency 1): ~$0.10-0.20 per day
  - 3 months weekly: ~$1-3 total
  - 1 year daily: ~$25-50 total
`);
}

function formatCurrency(value: number): string {
  return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + (value * 100).toFixed(2) + "%";
}

function printResults(result: AgentBacktestResult): void {
  console.log("\n" + "═".repeat(60));
  console.log("              AGENT BACKTEST RESULTS");
  console.log("═".repeat(60));

  console.log("\nPERFORMANCE SUMMARY");
  console.log("─".repeat(40));
  console.log(`Start Equity:      ${formatCurrency(result.startEquity)}`);
  console.log(`End Equity:        ${formatCurrency(result.endEquity)}`);
  console.log(`Total Return:      ${formatCurrency(result.totalReturn)} (${formatPercent(result.totalReturnPercent)})`);
  console.log(`Annualized Return: ${formatPercent(result.annualizedReturn)}`);

  console.log("\nRISK METRICS");
  console.log("─".repeat(40));
  console.log(`Sharpe Ratio:      ${result.sharpeRatio.toFixed(2)}`);
  console.log(`Max Drawdown:      ${formatPercent(result.maxDrawdown)}${result.maxDrawdownDate ? ` (${result.maxDrawdownDate})` : ""}`);

  console.log("\nTRADE STATISTICS");
  console.log("─".repeat(40));
  console.log(`Total Trades:      ${result.totalTrades}`);
  console.log(`Winning Trades:    ${result.winningTrades} (${(result.winRate * 100).toFixed(1)}%)`);
  console.log(`Losing Trades:     ${result.losingTrades}`);
  console.log(`Profit Factor:     ${result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}`);

  console.log("\nAGENT STATISTICS");
  console.log("─".repeat(40));
  console.log(`Total Cycles:      ${result.cycles.length}`);
  console.log(`Total Tokens:      ${result.totalTokens.toLocaleString()}`);
  console.log(`Total API Cost:    ${formatCurrency(result.totalApiCost)}`);
  console.log(`Avg Tokens/Cycle:  ${Math.round(result.totalTokens / result.cycles.length).toLocaleString()}`);
  console.log(`Avg Cost/Cycle:    ${formatCurrency(result.totalApiCost / result.cycles.length)}`);

  console.log("\nBACKTEST INFO");
  console.log("─".repeat(40));
  console.log(`Model:             ${result.config.model}`);
  console.log(`Cycle Frequency:   Every ${result.config.cycleFrequency} trading day(s)`);
  console.log(`Trading Days:      ${result.equityCurve.length}`);
  console.log(`Symbols:           ${result.config.symbols.join(", ")}`);
  console.log(`Period:            ${result.config.startDate.toISOString().split("T")[0]} to ${result.config.endDate.toISOString().split("T")[0]}`);

  // Print equity curve
  if (result.equityCurve.length > 5) {
    console.log("\nEQUITY CURVE");
    console.log("─".repeat(40));
    const equityValues = result.equityCurve.map(s => s.equity);
    const sampledValues = equityValues.length > 80
      ? equityValues.filter((_, i) => i % Math.ceil(equityValues.length / 80) === 0)
      : equityValues;

    try {
      console.log(asciichart.plot(sampledValues, {
        height: 10,
        format: (x: number) => formatCurrency(x).padStart(12),
      }));
    } catch {
      console.log("(Unable to render chart)");
    }
  }

  // Print recent trades
  if (result.trades.length > 0) {
    console.log("\nRECENT TRADES");
    console.log("─".repeat(40));
    const recentTrades = result.trades.slice(-10);
    for (const trade of recentTrades) {
      const pnlStr = trade.pnl !== undefined
        ? ` P&L: ${trade.pnl >= 0 ? "+" : ""}${formatCurrency(trade.pnl)}`
        : "";
      console.log(`  ${trade.date} ${trade.side.toUpperCase().padEnd(4)} ${trade.symbol.padEnd(5)} ${trade.quantity} @ ${formatCurrency(trade.price)}${pnlStr}`);
    }
    if (result.trades.length > 10) {
      console.log(`  ... and ${result.trades.length - 10} more trades`);
    }
  }

  console.log("\n" + "═".repeat(60));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  // Check for config
  if (!configExists()) {
    console.error("No configuration found. Run 'bun run setup' first.");
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.anthropicApiKey) {
    console.error("No Anthropic API key configured. Run 'bun run setup' first.");
    process.exit(1);
  }

  // Parse options
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  // Defaults
  let symbols = config.tradingUniverse.symbols;
  let initialCapital = config.capital.initialCapital;
  let model = config.agentParams.model;
  let cycleFrequency = 5; // Weekly by default

  // Override from command line
  const symbolsArg = getArg("symbols");
  if (symbolsArg) {
    symbols = symbolsArg.split(",").map(s => s.trim().toUpperCase());
  }

  const capitalArg = getArg("capital");
  if (capitalArg) {
    initialCapital = parseFloat(capitalArg);
  }

  const modelArg = getArg("model");
  if (modelArg) {
    model = modelArg as typeof model;
  }

  const frequencyArg = getArg("frequency");
  if (frequencyArg) {
    cycleFrequency = parseInt(frequencyArg);
  }

  const startArg = getArg("start");
  const endArg = getArg("end");

  const endDate = endArg ? new Date(endArg) : new Date();
  const startDate = startArg
    ? new Date(startArg)
    : new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000); // 3 months ago

  // Estimate cost
  const estimatedDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  const estimatedCycles = Math.ceil(estimatedDays / cycleFrequency / 1.4); // ~1.4 for weekends
  const estimatedCost = estimatedCycles * 0.15; // ~$0.15 per cycle

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║              CLAUDE AGENT BACKTESTER                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Model:           ${model}`);
  console.log(`Symbols:         ${symbols.join(", ")}`);
  console.log(`Period:          ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);
  console.log(`Initial Capital: ${formatCurrency(initialCapital)}`);
  console.log(`Cycle Frequency: Every ${cycleFrequency} trading day(s)`);
  console.log();
  console.log(`Estimated cycles: ~${estimatedCycles}`);
  console.log(`Estimated cost:   ~${formatCurrency(estimatedCost)}`);
  console.log();

  // Confirm
  if (!args.includes("--yes") && !args.includes("-y")) {
    console.log("Press Enter to continue or Ctrl+C to cancel...");
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });
  }

  const backtestConfig: AgentBacktestConfig = {
    startDate,
    endDate,
    initialCapital,
    symbols,
    model,
    maxTurnsPerCycle: 5,
    allowShorts: config.tradingUniverse.allowShorts,
    riskLimits: config.riskLimits,
    cycleFrequency,
  };

  const dataManager = new DataManager("yahoo");
  const engine = new AgentBacktestEngine(config.anthropicApiKey, dataManager, backtestConfig);

  try {
    const result = await engine.run((message) => console.log(message));
    printResults(result);
  } catch (error) {
    console.error("\nBacktest failed:", error);
    process.exit(1);
  }
}

main();

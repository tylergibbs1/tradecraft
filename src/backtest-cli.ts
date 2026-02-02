#!/usr/bin/env bun
import { DataManager } from "./data/index.js";
import { BacktestEngine, BacktestConfig, BacktestResult, getStrategy, listStrategies } from "./backtest/index.js";
import { loadConfig, configExists } from "./config/index.js";
import * as asciichart from "asciichart";

function printUsage(): void {
  console.log(`
Usage: bun run backtest <strategy> [options]

Available strategies:
${listStrategies().map(s => `  - ${s}`).join('\n')}

Options:
  --start <date>    Start date (YYYY-MM-DD), default: 1 year ago
  --end <date>      End date (YYYY-MM-DD), default: today
  --capital <num>   Initial capital, default: from config
  --symbols <list>  Comma-separated symbols, default: from config

Example:
  bun run backtest sma-crossover --start 2024-01-01 --symbols AAPL,GOOGL
`);
}

function formatCurrency(value: number): string {
  return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + (value * 100).toFixed(2) + "%";
}

function printResults(result: BacktestResult): void {
  console.log("\n" + "═".repeat(60));
  console.log("                    BACKTEST RESULTS");
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
  console.log(`Max Drawdown:      ${formatPercent(result.maxDrawdown)} (${result.maxDrawdownDate})`);

  console.log("\nTRADE STATISTICS");
  console.log("─".repeat(40));
  console.log(`Total Trades:      ${result.totalTrades}`);
  console.log(`Winning Trades:    ${result.winningTrades} (${(result.winRate * 100).toFixed(1)}%)`);
  console.log(`Losing Trades:     ${result.losingTrades}`);
  console.log(`Profit Factor:     ${result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}`);
  console.log(`Average Win:       ${formatCurrency(result.averageWin)}`);
  console.log(`Average Loss:      ${formatCurrency(result.averageLoss)}`);
  console.log(`Largest Win:       ${formatCurrency(result.largestWin)}`);
  console.log(`Largest Loss:      ${formatCurrency(result.largestLoss)}`);

  console.log("\nBACKTEST INFO");
  console.log("─".repeat(40));
  console.log(`Trading Days:      ${result.tradingDays}`);
  console.log(`Symbols:           ${result.config.symbols.join(", ")}`);
  console.log(`Period:            ${result.config.startDate.toISOString().split("T")[0]} to ${result.config.endDate.toISOString().split("T")[0]}`);

  // Print equity curve
  if (result.equityCurve.length > 10) {
    console.log("\nEQUITY CURVE");
    console.log("─".repeat(40));
    const equityValues = result.equityCurve.map(s => s.equity);
    // Sample if too many points
    const sampledValues = equityValues.length > 100
      ? equityValues.filter((_, i) => i % Math.ceil(equityValues.length / 100) === 0)
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

  console.log("\n" + "═".repeat(60));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const strategyName = args[0]!;
  const strategy = getStrategy(strategyName);

  if (!strategy) {
    console.error(`Unknown strategy: ${strategyName}`);
    console.error(`Available strategies: ${listStrategies().join(", ")}`);
    process.exit(1);
  }

  // Parse options
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  // Load config if exists
  let symbols: string[] = ["AAPL", "GOOGL", "MSFT"];
  let initialCapital = 100000;

  if (configExists()) {
    const config = loadConfig();
    symbols = config.tradingUniverse.symbols;
    initialCapital = config.capital.initialCapital;
  }

  // Override from command line
  const symbolsArg = getArg("symbols");
  if (symbolsArg) {
    symbols = symbolsArg.split(",").map(s => s.trim().toUpperCase());
  }

  const capitalArg = getArg("capital");
  if (capitalArg) {
    initialCapital = parseFloat(capitalArg);
  }

  const startArg = getArg("start");
  const endArg = getArg("end");

  const endDate = endArg ? new Date(endArg) : new Date();
  const startDate = startArg
    ? new Date(startArg)
    : new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 year ago

  console.log(`Running backtest: ${strategy.name}`);
  console.log(`Description: ${strategy.description}`);
  console.log(`Symbols: ${symbols.join(", ")}`);
  console.log(`Period: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);
  console.log(`Initial Capital: ${formatCurrency(initialCapital)}`);
  console.log("\nFetching historical data...");

  const dataManager = new DataManager("yahoo");

  const config: BacktestConfig = {
    startDate,
    endDate,
    initialCapital,
    symbols,
    commission: 0, // Paper trading
    slippage: 0.01, // 0.01% slippage
  };

  const engine = new BacktestEngine(dataManager, config);

  try {
    const result = await engine.run(strategy);
    printResults(result);
  } catch (error) {
    console.error("Backtest failed:", error);
    process.exit(1);
  }
}

main();

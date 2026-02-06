#!/usr/bin/env bun
/**
 * CLI interface for Tradecraft - works without TTY
 * Usage: bun run cli <command> [options]
 */
import { loadConfig, configExists } from "./config/index.js";
import { PortfolioManager } from "./portfolio/manager.js";
import { RiskMonitor } from "./risk/monitor.js";
import { DataManager } from "./data/index.js";
import { TradingAgent } from "./agent/index.js";
import { ITradingAgent } from "./agent/types.js";
import { SwarmTradingAgent } from "./agent/swarm-adapter.js";

const HELP = `
Tradecraft CLI - Autonomous Trading System

Usage: bun run cli <command> [options]

Commands:
  status          Show portfolio status and positions
  quotes [syms]   Get market quotes (default: trading universe)
  risk            Show risk status and limits
  cycle           Run a single trading cycle with the agent
  start           Start the agent (runs continuously)
  order <args>    Place an order manually
  history         Show trade history
  reset           Reset portfolio to initial capital
  help            Show this help message

Examples:
  bun run cli status
  bun run cli quotes AAPL,GOOGL,MSFT
  bun run cli cycle
  bun run cli order buy AAPL 10
  bun run cli order sell MSFT 5
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (!configExists()) {
    console.error("No configuration found. Run 'bun run setup' first.");
    process.exit(1);
  }

  const config = loadConfig();

  if (!config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    console.error("Anthropic API key not configured.");
    process.exit(1);
  }

  // Initialize managers
  const portfolioManager = new PortfolioManager(config.capital.initialCapital);
  const riskMonitor = new RiskMonitor(config.riskLimits);
  const dataManager = new DataManager(config.dataProvider, config.dataProviderApiKey);

  switch (command) {
    case "status":
      await showStatus(portfolioManager, dataManager);
      break;

    case "quotes":
      const symbols = args[1]?.split(",") || config.tradingUniverse.symbols;
      await showQuotes(dataManager, symbols);
      break;

    case "risk":
      await showRiskStatus(portfolioManager, riskMonitor, dataManager);
      break;

    case "cycle":
      await runCycle(config, portfolioManager, riskMonitor, dataManager);
      break;

    case "start":
      await startAgent(config, portfolioManager, riskMonitor, dataManager);
      break;

    case "order":
      const side = args[1]?.toLowerCase() as "buy" | "sell";
      const symbol = args[2]?.toUpperCase();
      const quantity = parseInt(args[3] || "0", 10);
      if (!side || !symbol || !quantity) {
        console.error("Usage: bun run cli order <buy|sell> <symbol> <quantity>");
        process.exit(1);
      }
      await placeOrder(portfolioManager, riskMonitor, dataManager, config, side, symbol, quantity);
      break;

    case "history":
      showHistory(portfolioManager);
      break;

    case "reset":
      portfolioManager.reset(config.capital.initialCapital);
      console.log(`Portfolio reset to $${config.capital.initialCapital.toLocaleString()}`);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

function formatCurrency(value: number): string {
  const sign = value >= 0 ? "" : "-";
  return sign + "$" + Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return sign + (value * 100).toFixed(2) + "%";
}

async function showStatus(portfolioManager: PortfolioManager, dataManager: DataManager) {
  const state = portfolioManager.getState();
  const positions = portfolioManager.getPositions();

  // Update prices
  if (positions.length > 0) {
    const quotes = await dataManager.getQuotes(positions.map(p => p.symbol));
    portfolioManager.updatePrices(quotes);
  }

  const updated = portfolioManager.getState();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    PORTFOLIO STATUS                        ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("Summary:");
  console.log("─".repeat(50));
  console.log(`  Cash:        ${formatCurrency(updated.cash)}`);
  console.log(`  Equity:      ${formatCurrency(updated.equity)}`);
  console.log(`  Peak Equity: ${formatCurrency(updated.peakEquity)}`);
  console.log(`  Daily P&L:   ${formatCurrency(updated.dailyPnL)}`);
  console.log(`  Weekly P&L:  ${formatCurrency(updated.weeklyPnL)}`);
  console.log(`  Total P&L:   ${formatCurrency(updated.totalPnL)}`);

  console.log("\nPositions:");
  console.log("─".repeat(50));

  if (positions.length === 0) {
    console.log("  No open positions");
  } else {
    console.log("  Symbol   Qty      Avg Cost    Current     Value        P&L");
    for (const pos of portfolioManager.getPositions()) {
      console.log(
        `  ${pos.symbol.padEnd(8)} ${pos.quantity.toString().padStart(4)}  ` +
        `${formatCurrency(pos.averageCost).padStart(10)}  ` +
        `${formatCurrency(pos.currentPrice).padStart(10)}  ` +
        `${formatCurrency(pos.marketValue).padStart(10)}  ` +
        `${formatCurrency(pos.unrealizedPnL).padStart(10)}`
      );
    }
  }

  const openOrders = portfolioManager.getOpenOrders();
  if (openOrders.length > 0) {
    console.log("\nOpen Orders:");
    console.log("─".repeat(50));
    for (const order of openOrders) {
      console.log(`  ${order.side.toUpperCase()} ${order.quantity} ${order.symbol} @ ${order.price || 'MKT'} [${order.status}]`);
    }
  }

  console.log("");
}

async function showQuotes(dataManager: DataManager, symbols: string[]) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    MARKET QUOTES                           ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("Symbol     Last         Volume        Time");
  console.log("─".repeat(50));

  const quotes = await dataManager.getQuotes(symbols);
  for (const [symbol, quote] of quotes) {
    const time = new Date(quote.timestamp).toLocaleTimeString();
    console.log(
      `${symbol.padEnd(10)} ` +
      `${formatCurrency(quote.last).padStart(10)}  ` +
      `${quote.volume.toLocaleString().padStart(12)}  ` +
      `${time}`
    );
  }
  console.log("");
}

async function showRiskStatus(
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager
) {
  const positions = portfolioManager.getPositions();
  const quotes = positions.length > 0
    ? await dataManager.getQuotes(positions.map(p => p.symbol))
    : new Map();

  // Build snapshot
  const state = portfolioManager.getState();
  const positionsMap = new Map<string, { quantity: number; averageCost: number; currentPrice: number }>();
  for (const pos of positions) {
    const q = quotes.get(pos.symbol);
    positionsMap.set(pos.symbol, {
      quantity: pos.quantity,
      averageCost: pos.averageCost,
      currentPrice: q?.last ?? pos.currentPrice,
    });
  }

  const snapshot = {
    cash: state.cash,
    equity: state.equity,
    positions: positionsMap,
    dailyPnL: state.dailyPnL,
    weeklyPnL: state.weeklyPnL,
    peakEquity: state.peakEquity,
  };

  const status = riskMonitor.getStatus(snapshot);
  const limits = riskMonitor.getLimits();

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    RISK STATUS                             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Can Trade: ${status.canTrade ? "✓ YES" : "✗ NO"}`);
  console.log(`Circuit Breaker: ${status.circuitBreaker.state.toUpperCase()}`);
  if (status.circuitBreaker.reason) {
    console.log(`  Reason: ${status.circuitBreaker.reason}`);
  }

  console.log("\nCurrent Metrics:");
  console.log("─".repeat(50));
  console.log(`  Daily P&L:      ${formatCurrency(status.dailyPnL)} (${formatPercent(state.equity > 0 ? status.dailyPnL / state.equity : 0)})`);
  console.log(`  Weekly P&L:     ${formatCurrency(status.weeklyPnL)} (${formatPercent(state.equity > 0 ? status.weeklyPnL / state.equity : 0)})`);
  console.log(`  Drawdown:       ${formatPercent(status.currentDrawdown)}`);
  console.log(`  Positions:      ${status.positionCount}/${status.maxPositionCount}`);

  console.log("\nLimits:");
  console.log("─".repeat(50));
  console.log(`  Max Position Size:  ${formatPercent(limits.maxPositionSize)}`);
  console.log(`  Max Positions:      ${limits.maxPositionCount}`);
  console.log(`  Daily Loss Limit:   ${formatPercent(limits.dailyLossLimit)}`);
  console.log(`  Weekly Loss Limit:  ${formatPercent(limits.weeklyLossLimit)}`);
  console.log(`  Max Drawdown:       ${formatPercent(limits.maxDrawdown)}`);
  console.log(`  Max Order Value:    ${formatCurrency(limits.maxOrderValue)}`);
  console.log("");
}

function createAgent(
  config: ReturnType<typeof loadConfig>,
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager,
  callbacks: {
    onStateChange?: (state: import("./agent/types.js").AgentState) => void;
    onMessage?: (message: import("./agent/types.js").AgentMessage) => void;
    onCycleComplete?: (result: import("./agent/types.js").AgentCycleResult) => void;
  }
): ITradingAgent {
  const deps = { config, portfolioManager, riskMonitor, dataManager };
  if (config.agentMode === "swarm") {
    return new SwarmTradingAgent(deps, callbacks);
  }
  return new TradingAgent(deps, callbacks);
}

async function runCycle(
  config: ReturnType<typeof loadConfig>,
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager
) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                 RUNNING TRADING CYCLE                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Mode: ${config.agentMode.toUpperCase()}\n`);

  const agent = createAgent(config, portfolioManager, riskMonitor, dataManager, {
    onMessage: (msg) => {
      const prefix = {
        system: "[SYS]",
        assistant: "[AGT]",
        tool_use: "[TUL]",
        tool_result: "[RES]",
        error: "[ERR]",
        user: "[USR]",
      }[msg.type] || "[???]";

      const content = msg.content.length > 120 ? msg.content.slice(0, 120) + "..." : msg.content;
      console.log(`${prefix} ${content}`);
    },
  });

  console.log("Starting cycle...\n");
  const result = await agent.runSingleCycle();

  console.log("\n" + "─".repeat(50));
  console.log("Cycle Complete:");
  console.log(`  Turns:   ${result.turnsUsed}`);
  console.log(`  Tokens:  ${result.tokensUsed}`);
  console.log(`  Cost:    $${result.costUsd.toFixed(4)}`);
  console.log(`  Orders:  ${result.ordersPlaced} placed, ${result.ordersCancelled} cancelled`);
  if (result.error) {
    console.log(`  Error:   ${result.error}`);
  }
  console.log("");

  // Show updated status
  await showStatus(portfolioManager, dataManager);
}

async function startAgent(
  config: ReturnType<typeof loadConfig>,
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager
) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║              STARTING AUTONOMOUS AGENT                     ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log(`Mode: ${config.agentMode.toUpperCase()}`);
  console.log(`Model: ${config.agentParams.model}`);
  console.log(`Cycle Interval: ${config.agentParams.cycleIntervalMs / 1000}s`);
  console.log(`Max Turns: ${config.agentParams.maxTurns}`);
  console.log(`Max Budget: $${config.agentParams.maxBudgetUsd}/cycle`);
  console.log("\nPress Ctrl+C to stop\n");
  console.log("─".repeat(60));

  const agent = createAgent(config, portfolioManager, riskMonitor, dataManager, {
    onStateChange: (state) => {
      console.log(`\n[STATE] Agent state: ${state.toUpperCase()}`);
    },
    onMessage: (msg) => {
      const prefix = {
        system: "[SYS]",
        assistant: "[AGT]",
        tool_use: "[TUL]",
        tool_result: "[RES]",
        error: "[ERR]",
        user: "[USR]",
      }[msg.type] || "[???]";

      const content = msg.content.length > 100 ? msg.content.slice(0, 100) + "..." : msg.content;
      console.log(`${prefix} ${content}`);
    },
    onCycleComplete: (result) => {
      console.log(`\n[CYCLE] Complete: ${result.turnsUsed} turns, ${result.ordersPlaced} orders, $${result.costUsd.toFixed(4)}`);
      console.log("─".repeat(60));
    },
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n\nStopping agent...");
    agent.stop();
    process.exit(0);
  });

  agent.start();

  // Keep process alive
  await new Promise(() => {});
}

async function placeOrder(
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager,
  config: ReturnType<typeof loadConfig>,
  side: "buy" | "sell",
  symbol: string,
  quantity: number
) {
  // Check if symbol is in trading universe
  if (!config.tradingUniverse.symbols.includes(symbol)) {
    console.error(`Symbol ${symbol} not in trading universe.`);
    console.log(`Allowed: ${config.tradingUniverse.symbols.join(", ")}`);
    process.exit(1);
  }

  // Get quote
  const quote = await dataManager.getQuote(symbol);
  console.log(`\n${symbol} current price: ${formatCurrency(quote.last)}`);

  // Validate against risk
  const positions = portfolioManager.getPositions();
  const quotes = await dataManager.getQuotes(positions.map(p => p.symbol));
  portfolioManager.updatePrices(quotes);

  const state = portfolioManager.getState();
  const positionsMap = new Map<string, { quantity: number; averageCost: number; currentPrice: number }>();
  for (const pos of positions) {
    const q = quotes.get(pos.symbol);
    positionsMap.set(pos.symbol, {
      quantity: pos.quantity,
      averageCost: pos.averageCost,
      currentPrice: q?.last ?? pos.currentPrice,
    });
  }

  const snapshot = {
    cash: state.cash,
    equity: state.equity,
    positions: positionsMap,
    dailyPnL: state.dailyPnL,
    weeklyPnL: state.weeklyPnL,
    peakEquity: state.peakEquity,
  };

  const validation = riskMonitor.preValidate(
    { symbol, side, type: "market", quantity },
    snapshot,
    quote.last
  );

  if (!validation.valid) {
    console.error(`\n✗ Order rejected: ${validation.reason}`);
    process.exit(1);
  }

  // Place order
  const order = portfolioManager.createOrder(symbol, side, "market", quantity);
  portfolioManager.submitOrder(order.id);

  // Fill immediately (paper trading)
  const fillPrice = side === "buy" ? (quote.ask ?? quote.last) : (quote.bid ?? quote.last);
  const result = portfolioManager.fillOrder(order.id, fillPrice);

  if (result) {
    console.log(`\n✓ Order filled:`);
    console.log(`  ${side.toUpperCase()} ${quantity} ${symbol} @ ${formatCurrency(fillPrice)}`);
    console.log(`  Value: ${formatCurrency(result.trade.value)}`);
    if (result.trade.pnl !== undefined) {
      console.log(`  P&L: ${formatCurrency(result.trade.pnl)}`);
    }
  } else {
    console.error(`\n✗ Order failed to fill`);
  }

  console.log("");
}

function showHistory(portfolioManager: PortfolioManager) {
  const trades = portfolioManager.getTrades(20);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    TRADE HISTORY                           ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  if (trades.length === 0) {
    console.log("No trades yet.\n");
    return;
  }

  console.log("Time         Side   Symbol   Qty      Price        Value         P&L");
  console.log("─".repeat(75));

  for (const trade of trades) {
    const time = new Date(trade.executedAt).toLocaleTimeString();
    const pnl = trade.pnl !== undefined ? formatCurrency(trade.pnl) : "N/A";
    console.log(
      `${time.padEnd(12)} ` +
      `${trade.side.toUpperCase().padEnd(6)} ` +
      `${trade.symbol.padEnd(8)} ` +
      `${trade.quantity.toString().padStart(4)}  ` +
      `${formatCurrency(trade.price).padStart(10)}  ` +
      `${formatCurrency(trade.value).padStart(10)}  ` +
      `${pnl.padStart(10)}`
    );
  }
  console.log("");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

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
import {
  createSwarm,
  getSharedSignalBus,
  type AgentCycleContext,
  type PriceBar,
  type SwarmCallbacks,
  type SpecialistUIState,
  type ConsensusResult,
} from "./agents/index.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Helper to write swarm state to file
function writeSwarmState(dataDir: string, state: any) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "swarm_state.json"), JSON.stringify(state, null, 2));
}

const HELP = `
Tradecraft CLI - Autonomous Trading System

Usage: bun run cli <command> [options]

Commands:
  status          Show portfolio status and positions
  quotes [syms]   Get market quotes (default: trading universe)
  risk            Show risk status and limits
  cycle           Run a single trading cycle with the agent
  start           Start the agent (runs continuously)
  swarm           Start the multi-agent swarm (runs continuously)
  swarm-cycle     Run a single swarm cycle
  dashboard       Start the performance dashboard (web UI)
  order <args>    Place an order manually
  history         Show trade history
  reset           Reset portfolio to initial capital
  help            Show this help message

Examples:
  bun run cli status
  bun run cli quotes AAPL,GOOGL,MSFT
  bun run cli cycle
  bun run cli swarm
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

    case "swarm":
      await startSwarm(config, portfolioManager, riskMonitor, dataManager);
      break;

    case "swarm-cycle":
      await runSwarmCycle(config, portfolioManager, riskMonitor, dataManager);
      break;

    case "dashboard":
      console.log("Starting dashboard server...");
      console.log("Run: bun run dashboard");
      console.log("Or directly: bun run src/dashboard/server.ts");
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

async function runCycle(
  config: ReturnType<typeof loadConfig>,
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager
) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                 RUNNING TRADING CYCLE                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const agent = new TradingAgent(
    { config, portfolioManager, riskMonitor, dataManager },
    {
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
    }
  );

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

  console.log(`Model: ${config.agentParams.model}`);
  console.log(`Cycle Interval: ${config.agentParams.cycleIntervalMs / 1000}s`);
  console.log(`Max Turns: ${config.agentParams.maxTurns}`);
  console.log(`Max Budget: $${config.agentParams.maxBudgetUsd}/cycle`);
  console.log("\nPress Ctrl+C to stop\n");
  console.log("─".repeat(60));

  const agent = new TradingAgent(
    { config, portfolioManager, riskMonitor, dataManager },
    {
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
    }
  );

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
  const fillPrice = side === "buy" ? quote.ask : quote.bid;
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

async function runSwarmCycle(
  config: ReturnType<typeof loadConfig>,
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager
) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║              RUNNING SWARM CYCLE                           ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Anthropic API key not configured.");
    process.exit(1);
  }

  // Create price data fetcher
  const priceDataFetcher = async (symbol: string, days: number): Promise<PriceBar[]> => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const history = await dataManager.getHistory(symbol, "1d", startDate, endDate);
    return history.map(bar => ({
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  };

  // Create swarm
  const swarm = createSwarm({
    apiKey,
    tradingUniverse: config.tradingUniverse.symbols,
    model: config.agentParams.model,
    priceDataFetcher,
    exaApiKey: process.env.EXA_API_KEY,
  });

  console.log("🐝 Swarm initialized with specialists:");
  for (const specialist of swarm.getSpecialists()) {
    console.log(`   - ${specialist.role}`);
  }
  console.log(`\n📊 Trading Universe: ${config.tradingUniverse.symbols.join(", ")}\n`);

  // Build cycle context
  const state = portfolioManager.getState();
  const positions = portfolioManager.getPositions();
  const positionsMap = new Map<string, { quantity: number; currentPrice: number }>();
  for (const pos of positions) {
    positionsMap.set(pos.symbol, { quantity: pos.quantity, currentPrice: pos.currentPrice });
  }

  const cycleContext: AgentCycleContext = {
    cycleId: `cli-${Date.now()}`,
    timestamp: new Date().toISOString(),
    tradingUniverse: config.tradingUniverse.symbols,
    portfolioSnapshot: {
      cash: state.cash,
      equity: state.equity,
      positions: positionsMap,
    },
    riskStatus: {
      canTrade: true,
      circuitBreaker: "closed",
      currentDrawdown: state.peakEquity > 0 ? (state.peakEquity - state.equity) / state.peakEquity : 0,
    },
  };

  console.log("🔄 Running swarm cycle (all specialists in parallel)...\n");

  const result = await swarm.runSwarmCycle(cycleContext, {
    parallelSpecialists: true,
  });

  // Display results
  console.log("\n" + "─".repeat(60));
  console.log("📈 Swarm Cycle Results:");
  console.log(`   Cycle ID: ${result.cycleId.slice(0, 8)}`);
  console.log(`   Symbols:  ${result.symbolsAnalyzed.join(", ")}`);
  console.log(`   Tokens:   ${result.totalTokensUsed.toLocaleString()}`);
  console.log(`   Cost:     $${result.totalCostUsd.toFixed(4)}`);
  if (result.error) {
    console.log(`   Error:    ${result.error}`);
  }

  console.log("\n🔬 Specialist Results:");
  for (const spec of result.specialistResults) {
    const status = spec.error ? "❌" : "✅";
    console.log(`   ${status} ${spec.role}: ${spec.signalsPublished} signals, ${spec.tokensUsed.toLocaleString()} tokens`);
  }

  // Show consensus
  console.log("\n📊 Consensus by Symbol:");
  const allConsensus = swarm.getAllConsensus();
  for (const [symbol, consensus] of allConsensus) {
    console.log(`   ${symbol}: ${consensus.recommendation} (score: ${consensus.weightedScore.toFixed(2)}, signals: ${consensus.signalCount})`);
  }

  // Show trade decisions
  if (result.tradeDecisions.length > 0) {
    console.log("\n💰 Trade Decisions:");
    for (const decision of result.tradeDecisions) {
      console.log(`   ${decision.symbol}: ${decision.action} ${decision.quantity || ""} (${(decision.confidence * 100).toFixed(0)}% confidence)`);
      console.log(`      ${decision.reason.slice(0, 100)}...`);

      // Execute trade if actionable
      if (decision.action !== "HOLD" && decision.quantity) {
        const side = decision.action.toLowerCase() as "buy" | "sell";
        try {
          const quote = await dataManager.getQuote(decision.symbol);
          const order = portfolioManager.createOrder(decision.symbol, side, "market", decision.quantity);
          portfolioManager.submitOrder(order.id);
          const fillPrice = side === "buy" ? (quote.ask ?? quote.last) : (quote.bid ?? quote.last);
          const fillResult = portfolioManager.fillOrder(order.id, fillPrice);
          if (fillResult) {
            console.log(`      ✓ Executed: ${side.toUpperCase()} ${decision.quantity} @ ${formatCurrency(fillPrice)}`);
          }
        } catch (err) {
          console.log(`      ✗ Failed to execute: ${err}`);
        }
      }
    }
  } else {
    console.log("\n💤 No trade decisions (insufficient consensus)");
  }

  // Show signals
  console.log("\n📡 Signal Bus:");
  const signalBus = getSharedSignalBus();
  const allSignals = signalBus.getAllSignals();
  console.log(`   Total signals: ${allSignals.length}`);
  for (const signal of allSignals.slice(-5)) {
    console.log(`   - ${signal.symbol} | ${signal.agentRole} | ${signal.signal} | ${(signal.confidence * 100).toFixed(0)}%`);
  }

  console.log("");
}

async function startSwarm(
  config: ReturnType<typeof loadConfig>,
  portfolioManager: PortfolioManager,
  riskMonitor: RiskMonitor,
  dataManager: DataManager
) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║            STARTING MULTI-AGENT SWARM                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Anthropic API key not configured.");
    process.exit(1);
  }

  const dataDir = join(process.cwd(), "data");

  // Create price data fetcher
  const priceDataFetcher = async (symbol: string, days: number): Promise<PriceBar[]> => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const history = await dataManager.getHistory(symbol, "1d", startDate, endDate);
    return history.map(bar => ({
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  };

  // Track UI state for real-time updates
  let currentCycleId = "";
  let cycleCount = 0;
  const specialistStates: Record<string, SpecialistUIState> = {};
  const consensusMap: Record<string, ConsensusResult> = {};
  const activeTools: Record<string, { agentId: string; toolName: string; startedAt: string }> = {};

  // Throttle state writes during streaming (max every 100ms)
  let lastStreamWrite = 0;
  const STREAM_WRITE_INTERVAL = 100; // ms

  const throttledWriteState = () => {
    const now = Date.now();
    if (now - lastStreamWrite >= STREAM_WRITE_INTERVAL) {
      lastStreamWrite = now;
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    }
  };

  // Create callbacks for real-time UI updates
  const callbacks: SwarmCallbacks = {
    onCycleStart: (cycleId) => {
      currentCycleId = cycleId;
      // Clear previous cycle state
      Object.keys(activeTools).forEach(k => delete activeTools[k]);
      Object.keys(consensusMap).forEach(k => delete consensusMap[k]);
      // Reset specialist states
      for (const agentId of Object.keys(specialistStates)) {
        specialistStates[agentId].status = "idle";
        specialistStates[agentId].streamingText = "";
        specialistStates[agentId].currentSymbol = undefined;
      }
      writeSwarmState(dataDir, {
        status: "running",
        cycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onAgentStart: (agentId, role, symbol) => {
      specialistStates[agentId] = {
        agentId,
        role,
        status: "analyzing",
        currentSymbol: symbol,
        signalsPublished: 0,
        streamingText: "",
        lastActivity: new Date().toISOString(),
      };
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onToolStart: (agentId, toolName) => {
      const toolKey = `${agentId}-${toolName}`;
      activeTools[toolKey] = { agentId, toolName, startedAt: new Date().toISOString() };
      if (specialistStates[agentId]) {
        specialistStates[agentId].lastMessage = `Using ${toolName}...`;
        specialistStates[agentId].lastActivity = new Date().toISOString();
      }
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onToolComplete: (agentId, toolName, durationMs) => {
      const toolKey = `${agentId}-${toolName}`;
      delete activeTools[toolKey];
      if (specialistStates[agentId]) {
        specialistStates[agentId].lastMessage = `${toolName} completed (${durationMs}ms)`;
        specialistStates[agentId].lastActivity = new Date().toISOString();
      }
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onTextDelta: (agentId, text) => {
      if (specialistStates[agentId]) {
        specialistStates[agentId].streamingText = (specialistStates[agentId].streamingText || "") + text;
        specialistStates[agentId].lastActivity = new Date().toISOString();
      }
      // Throttled write for real-time UI streaming
      throttledWriteState();
    },
    onSignalPublished: (signal) => {
      if (specialistStates[signal.agentId]) {
        specialistStates[signal.agentId].signalsPublished++;
        specialistStates[signal.agentId].status = "publishing";
        specialistStates[signal.agentId].lastMessage = `Published ${signal.signal} for ${signal.symbol}`;
        specialistStates[signal.agentId].lastActivity = new Date().toISOString();
      }
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onConsensusUpdate: (symbol, consensus) => {
      consensusMap[symbol] = consensus;
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onAgentComplete: (agentId, result) => {
      if (specialistStates[agentId]) {
        specialistStates[agentId].status = result.error ? "error" : "done";
        specialistStates[agentId].lastMessage = result.error || `Completed analysis`;
        specialistStates[agentId].error = result.error;
        specialistStates[agentId].lastActivity = new Date().toISOString();
      }
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
      });
    },
    onCycleComplete: (result) => {
      // Mark all specialists as done
      for (const agentId of Object.keys(specialistStates)) {
        if (specialistStates[agentId].status === "analyzing") {
          specialistStates[agentId].status = "done";
        }
      }
      writeSwarmState(dataDir, {
        status: "running",
        cycleId: currentCycleId,
        cycle: cycleCount,
        lastUpdate: new Date().toISOString(),
        specialists: specialistStates,
        symbols: config.tradingUniverse.symbols,
        activeTools,
        consensusMap,
        latestCycle: {
          timestamp: new Date().toISOString(),
          cycle: cycleCount,
          tokens: result.totalTokensUsed,
          cost: result.totalCostUsd,
          signals: result.specialistResults.map(s => ({
            agent: s.role,
            count: s.signalsPublished,
          })),
          consensus: Object.entries(consensusMap).map(([symbol, c]) => ({
            symbol,
            action: c.recommendation,
            score: c.weightedScore,
          })),
        },
      });
    },
  };

  // Create swarm with callbacks
  const swarm = createSwarm({
    apiKey,
    tradingUniverse: config.tradingUniverse.symbols,
    model: config.agentParams.model,
    priceDataFetcher,
    exaApiKey: process.env.EXA_API_KEY,
    callbacks,
  });

  console.log("🐝 Swarm Specialists:");
  for (const specialist of swarm.getSpecialists()) {
    console.log(`   - ${specialist.role}`);
  }
  console.log(`\n📊 Trading Universe: ${config.tradingUniverse.symbols.join(", ")}`);
  console.log(`🔄 Cycle Interval: ${config.agentParams.cycleIntervalMs / 1000}s`);
  console.log(`📈 Model: ${config.agentParams.model}`);
  console.log("\nPress Ctrl+C to stop\n");
  console.log("═".repeat(60));

  let running = true;

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n\nStopping swarm...");
    running = false;
  });

  while (running) {
    cycleCount++;
    console.log(`\n[CYCLE ${cycleCount}] Starting at ${new Date().toLocaleTimeString()}`);

    // Update prices
    const positions = portfolioManager.getPositions();
    if (positions.length > 0) {
      const quotes = await dataManager.getQuotes(positions.map(p => p.symbol));
      portfolioManager.updatePrices(quotes);
    }

    // Build cycle context
    const state = portfolioManager.getState();
    const positionsMap = new Map<string, { quantity: number; currentPrice: number }>();
    for (const pos of portfolioManager.getPositions()) {
      positionsMap.set(pos.symbol, { quantity: pos.quantity, currentPrice: pos.currentPrice });
    }

    const snapshot = {
      cash: state.cash,
      equity: state.equity,
      positions: positionsMap,
      dailyPnL: state.dailyPnL,
      weeklyPnL: state.weeklyPnL,
      peakEquity: state.peakEquity,
    };

    const riskStatus = riskMonitor.getStatus(snapshot);

    const cycleContext: AgentCycleContext = {
      cycleId: `swarm-${cycleCount}`,
      timestamp: new Date().toISOString(),
      tradingUniverse: config.tradingUniverse.symbols,
      portfolioSnapshot: {
        cash: state.cash,
        equity: state.equity,
        positions: positionsMap,
      },
      riskStatus: {
        canTrade: riskStatus.canTrade,
        circuitBreaker: riskStatus.circuitBreaker.state,
        currentDrawdown: riskStatus.currentDrawdown,
      },
    };

    if (!riskStatus.canTrade) {
      console.log(`[CYCLE ${cycleCount}] ⚠️  Trading disabled: ${riskStatus.circuitBreaker.reason || "Risk limits"}`);
    } else {
      try {
        // Clear old signals
        swarm.clearSignals();

        const result = await swarm.runSwarmCycle(cycleContext, {
          parallelSpecialists: true,
        });

        // Log results
        console.log(`[CYCLE ${cycleCount}] ✅ Complete: ${result.totalTokensUsed.toLocaleString()} tokens, $${result.totalCostUsd.toFixed(4)}`);

        for (const spec of result.specialistResults) {
          const status = spec.error ? "❌" : "✅";
          console.log(`   ${status} ${spec.role}: ${spec.signalsPublished} signals`);
        }

        // Show consensus
        const allConsensus = swarm.getAllConsensus();
        for (const [symbol, consensus] of allConsensus) {
          if (consensus.signalCount > 0) {
            console.log(`   📊 ${symbol}: ${consensus.recommendation} (${consensus.weightedScore.toFixed(2)})`);
          }
        }

        // Execute trades
        if (result.tradeDecisions.length > 0) {
          console.log(`   💰 Trade decisions: ${result.tradeDecisions.length}`);
          for (const decision of result.tradeDecisions) {
            if (decision.action !== "HOLD" && decision.quantity) {
              const side = decision.action.toLowerCase() as "buy" | "sell";
              try {
                const quote = await dataManager.getQuote(decision.symbol);
                const validation = riskMonitor.preValidate(
                  { symbol: decision.symbol, side, type: "market", quantity: decision.quantity },
                  snapshot,
                  quote.last
                );

                if (validation.valid) {
                  const order = portfolioManager.createOrder(decision.symbol, side, "market", decision.quantity);
                  portfolioManager.submitOrder(order.id);
                  const fillPrice = side === "buy" ? (quote.ask ?? quote.last) : (quote.bid ?? quote.last);
                  const fillResult = portfolioManager.fillOrder(order.id, fillPrice);
                  if (fillResult) {
                    console.log(`      ✓ ${side.toUpperCase()} ${decision.quantity} ${decision.symbol} @ ${formatCurrency(fillPrice)}`);
                    riskMonitor.recordTradeSuccess();
                  }
                } else {
                  console.log(`      ✗ ${decision.symbol}: ${validation.reason}`);
                }
              } catch (err) {
                console.log(`      ✗ ${decision.symbol}: ${err}`);
              }
            }
          }
        }

        if (result.error) {
          console.log(`[CYCLE ${cycleCount}] ⚠️  Error: ${result.error}`);
        }

        // State is already written via callbacks - no need to write again

      } catch (error) {
        console.log(`[CYCLE ${cycleCount}] ❌ Error: ${error}`);
        // Write error state
        writeSwarmState(dataDir, {
          status: "error",
          cycleId: currentCycleId,
          cycle: cycleCount,
          lastUpdate: new Date().toISOString(),
          specialists: specialistStates,
          symbols: config.tradingUniverse.symbols,
          activeTools: {},
          consensusMap,
          error: String(error),
        });
      }
    }

    // Wait for next cycle
    if (running) {
      console.log(`[CYCLE ${cycleCount}] Waiting ${config.agentParams.cycleIntervalMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, config.agentParams.cycleIntervalMs));
    }
  }

  console.log("\n✅ Swarm stopped");
  process.exit(0);
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

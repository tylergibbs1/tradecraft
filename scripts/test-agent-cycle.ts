#!/usr/bin/env bun

/**
 * Test a single agent cycle with Polygon tools
 */

import { TradingAgent } from "../src/agent/index.js";
import { loadConfig } from "../src/config/index.js";
import { DataManager } from "../src/data/index.js";
import { PortfolioManager } from "../src/portfolio/manager.js";
import { RiskMonitor } from "../src/risk/monitor.js";

async function main() {
  console.log("🤖 Testing Agent Cycle with Polygon Integration\n");

  // Load config
  const config = await loadConfig();
  console.log(`Data Provider: ${config.dataProvider}`);
  console.log(`Polygon API Key: ${config.dataProviderApiKey ? "✅ Set" : "❌ Missing"}`);
  console.log(`Trading Universe: ${config.tradingUniverse.symbols.join(", ")}\n`);

  // Initialize dependencies
  const dataManager = new DataManager(config.dataProvider, config.dataProviderApiKey);
  const portfolioManager = new PortfolioManager(config.capital.initialCapital);
  const riskMonitor = new RiskMonitor(config.riskLimits);

  // Load existing portfolio state if any
  portfolioManager.loadState();

  console.log(`Portfolio Equity: $${portfolioManager.getState().equity.toFixed(2)}`);
  console.log(`Positions: ${portfolioManager.getPositions().length}\n`);

  // Create agent with message logging
  const agent = new TradingAgent(
    { config, portfolioManager, riskMonitor, dataManager },
    {
      onMessage: (msg) => {
        const prefix =
          {
            system: "🔧",
            assistant: "🤖",
            tool_call: "🔨",
            tool_result: "📊",
            error: "❌",
          }[msg.type] || "📝";
        console.log(`${prefix} [${msg.type}] ${msg.content.slice(0, 150)}${msg.content.length > 150 ? "..." : ""}`);
      },
      onCycleComplete: (result) => {
        console.log("\n📋 Cycle Complete:");
        console.log(`   Turns: ${result.turnsUsed}`);
        console.log(`   Tokens: ${result.tokensUsed}`);
        console.log(`   Cost: $${result.costUsd.toFixed(4)}`);
        console.log(`   Orders: ${result.ordersPlaced} placed, ${result.ordersCancelled} cancelled`);
        if (result.error) {
          console.log(`   Error: ${result.error}`);
        }
      },
    },
  );

  // Run a single cycle
  console.log("Starting agent cycle...\n");
  const result = await agent.runSingleCycle();

  console.log("\n✅ Test complete");
  process.exit(result.error ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

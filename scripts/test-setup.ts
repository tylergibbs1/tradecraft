#!/usr/bin/env bun
/**
 * Non-interactive test of the setup and config system
 * This simulates what the setup wizard does
 */
import { saveConfig, loadConfig, configExists, getConfigPath, defaultConfig, Config } from "../src/config/index.js";

console.log("Testing Tradecraft Setup System\n");
console.log("================================\n");

// Test 1: Check config path
console.log("1. Config Path:");
console.log(`   ${getConfigPath()}\n`);

// Test 2: Check if config exists
console.log("2. Config Exists:", configExists() ? "Yes" : "No");

// Test 3: Create a test configuration
const testConfig: Config = {
  dataProvider: "yahoo",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  riskLimits: {
    maxPositionSize: 0.1,
    maxPositionCount: 10,
    dailyLossLimit: 0.02,
    weeklyLossLimit: 0.05,
    maxDrawdown: 0.1,
    maxOrderValue: 10000,
  },
  tradingUniverse: {
    symbols: ["AAPL", "GOOGL", "MSFT", "AMZN", "NVDA"],
    sectors: [],
    excludeSymbols: [],
    allowShorts: false,
    allowOptions: false,
  },
  agentParams: {
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 10,
    maxBudgetUsd: 0.5,
    cycleIntervalMs: 60000,
  },
  agentMode: "single",
  swarmParams: {
    specialistModel: "claude-sonnet-4-5-20250929",
    weights: {
      "fundamental-analyst": 0.25,
      "earnings-analyst": 0.20,
      "technical-analyst": 0.15,
      "sentiment-analyst": 0.10,
      "macro-analyst": 0.15,
      "catalyst-analyst": 0.10,
      "hypothesis-generator": 0.05,
    },
    parallelSpecialists: true,
    minConsensusConfidence: 0.5,
  },
  capital: {
    initialCapital: 100000,
    currency: "USD",
    paperTrading: true,
  },
};

console.log("\n3. Saving test configuration...");
saveConfig(testConfig);
console.log("   Configuration saved!\n");

// Test 4: Load and verify
console.log("4. Loading configuration...");
const loaded = loadConfig();
console.log("   Configuration loaded!\n");

// Test 5: Display configuration
console.log("5. Configuration Summary:");
console.log("   ─────────────────────────────────────");
console.log(`   Data Provider:     ${loaded.dataProvider}`);
console.log(`   API Key Set:       ${loaded.anthropicApiKey ? "Yes" : "No (use ANTHROPIC_API_KEY env)"}`);
console.log(`   Trading Symbols:   ${loaded.tradingUniverse.symbols.join(", ")}`);
console.log(`   Initial Capital:   $${loaded.capital.initialCapital.toLocaleString()}`);
console.log(`   Paper Trading:     ${loaded.capital.paperTrading ? "Yes" : "No"}`);
console.log(`   Max Position Size: ${(loaded.riskLimits.maxPositionSize * 100).toFixed(0)}%`);
console.log(`   Daily Loss Limit:  ${(loaded.riskLimits.dailyLossLimit * 100).toFixed(0)}%`);
console.log(`   Max Drawdown:      ${(loaded.riskLimits.maxDrawdown * 100).toFixed(0)}%`);
console.log(`   Agent Model:       ${loaded.agentParams.model}`);
console.log(`   Max Turns:         ${loaded.agentParams.maxTurns}`);
console.log("   ─────────────────────────────────────\n");

// Test 6: Verify values match
console.log("6. Verification:");
const checks = [
  ["dataProvider", loaded.dataProvider === testConfig.dataProvider],
  ["symbols", JSON.stringify(loaded.tradingUniverse.symbols) === JSON.stringify(testConfig.tradingUniverse.symbols)],
  ["initialCapital", loaded.capital.initialCapital === testConfig.capital.initialCapital],
  ["maxPositionSize", loaded.riskLimits.maxPositionSize === testConfig.riskLimits.maxPositionSize],
  ["model", loaded.agentParams.model === testConfig.agentParams.model],
];

let allPassed = true;
for (const [name, passed] of checks) {
  console.log(`   ${passed ? "✓" : "✗"} ${name}`);
  if (!passed) allPassed = false;
}

console.log("\n================================");
console.log(allPassed ? "All tests passed!" : "Some tests failed!");
console.log(`\nConfig file location: ${getConfigPath()}`);
console.log("\nTo run the trading TUI:");
console.log("  ANTHROPIC_API_KEY=your-key bun run start");

#!/usr/bin/env bun
import Anthropic from "@anthropic-ai/sdk";
/**
 * Test API connections
 */
import { loadConfig } from "../src/config/index.js";
import { DataManager } from "../src/data/index.js";

async function main() {
  console.log("Testing API Connections\n");
  console.log("========================\n");

  const config = loadConfig();

  // Test 1: Config loaded
  console.log("1. Configuration:");
  console.log(`   Data Provider: ${config.dataProvider}`);
  console.log(`   Model: ${config.agentParams.model}`);
  console.log(`   Anthropic Key: ${config.anthropicApiKey ? "✓ Set" : "✗ Missing"}`);

  // Test 2: Yahoo Finance via DataManager
  console.log("\n2. Testing Yahoo Finance API...");
  const dataManager = new DataManager(config.dataProvider, config.dataProviderApiKey);

  try {
    const quote = await dataManager.getQuote("AAPL");
    console.log(`   ✓ AAPL Quote: $${quote.last.toFixed(2)}`);
    console.log(`   Timestamp: ${new Date(quote.timestamp).toLocaleString()}`);
  } catch (error) {
    console.log(`   ✗ Yahoo Error: ${error}`);
  }

  // Test multiple quotes
  console.log("\n   Testing multiple symbols...");
  try {
    const quotes = await dataManager.getQuotes(["AAPL", "GOOGL", "MSFT"]);
    for (const [symbol, quote] of quotes) {
      console.log(`   ✓ ${symbol}: $${quote.last.toFixed(2)}`);
    }
  } catch (error) {
    console.log(`   ✗ Error: ${error}`);
  }

  // Test 3: Anthropic API
  console.log("\n3. Testing Anthropic API...");
  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: config.agentParams.model,
      max_tokens: 100,
      messages: [
        { role: "user", content: "You are a trading assistant. Say 'Trading system online!' and nothing else." },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    console.log(`   ✓ Response: ${text}`);
    console.log(`   Tokens: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`);
  } catch (error: any) {
    console.log(`   ✗ Error: ${error.message || error}`);
  }

  console.log("\n========================");
  console.log("All APIs working! Ready to trade.");
  console.log("\nTo start the trading TUI:");
  console.log("  bun run start");
}

main().catch(console.error);

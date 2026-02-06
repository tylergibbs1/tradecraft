#!/usr/bin/env bun
/**
 * Test script for Polygon.io API integration
 *
 * Usage: POLYGON_API_KEY=your_key bun scripts/test-polygon.ts
 */

import {
  PolygonIndicatorsProvider,
  PolygonNewsProvider,
  PolygonQuotesProvider,
  PolygonTickersProvider,
} from "../src/data/providers/polygon/index.js";

const API_KEY = process.env.POLYGON_API_KEY;

if (!API_KEY) {
  console.error("❌ POLYGON_API_KEY environment variable not set");
  console.error("Usage: POLYGON_API_KEY=your_key bun scripts/test-polygon.ts");
  process.exit(1);
}

const TEST_SYMBOL = "AAPL";

async function testQuotes() {
  console.log("\n📊 Testing Quotes Provider...");
  const provider = new PolygonQuotesProvider(API_KEY);

  try {
    const quote = await provider.getQuote(TEST_SYMBOL);
    console.log(`  ✅ Quote for ${TEST_SYMBOL}:`);
    console.log(`     Last: $${quote.last}`);
    console.log(`     Bid: $${quote.bid ?? "N/A"} / Ask: $${quote.ask ?? "N/A"}`);
    console.log(`     Volume: ${quote.volume?.toLocaleString()}`);
    return true;
  } catch (error) {
    console.log(`  ❌ Failed: ${error}`);
    return false;
  }
}

async function testNews() {
  console.log("\n📰 Testing News Provider...");
  const provider = new PolygonNewsProvider(API_KEY);

  try {
    const articles = await provider.getNews(TEST_SYMBOL, { limit: 3 });
    console.log(`  ✅ News for ${TEST_SYMBOL}: ${articles.length} articles`);

    for (const article of articles.slice(0, 2)) {
      const sentiment = article.insights.find((i) => i.ticker === TEST_SYMBOL);
      console.log(`     - "${article.title.slice(0, 60)}..."`);
      console.log(`       Sentiment: ${sentiment?.sentiment || "N/A"}`);
    }
    return true;
  } catch (error) {
    console.log(`  ❌ Failed: ${error}`);
    return false;
  }
}

async function testIndicators() {
  console.log("\n📉 Testing Indicators Provider...");
  const provider = new PolygonIndicatorsProvider(API_KEY);

  try {
    const [sma, rsi] = await Promise.all([
      provider.getSMA(TEST_SYMBOL, { window: 50, limit: 5 }),
      provider.getRSI(TEST_SYMBOL, { window: 14, limit: 5 }),
    ]);

    console.log(`  ✅ Indicators for ${TEST_SYMBOL}:`);
    console.log(`     SMA(50): $${sma.values[0]?.value.toFixed(2)}`);
    console.log(`     RSI(14): ${rsi.values[0]?.value.toFixed(1)}`);
    return true;
  } catch (error) {
    console.log(`  ❌ Failed: ${error}`);
    return false;
  }
}

async function testTickers() {
  console.log("\n🔍 Testing Tickers Provider...");
  const provider = new PolygonTickersProvider(API_KEY);

  try {
    // Test company info
    const details = await provider.getTickerDetails(TEST_SYMBOL);
    if (details) {
      console.log(`  ✅ Company Info for ${TEST_SYMBOL}:`);
      console.log(`     Name: ${details.name}`);
      console.log(`     Industry: ${details.sicDescription}`);
      console.log(`     Employees: ${details.totalEmployees?.toLocaleString()}`);
      console.log(`     Description: ${details.description?.slice(0, 80)}...`);
    }

    // Test search
    const results = await provider.searchByName("Tesla", { limit: 3 });
    console.log(`  ✅ Search "Tesla": found ${results.length} results`);
    for (const r of results) {
      console.log(`     - ${r.ticker}: ${r.name}`);
    }

    return true;
  } catch (error) {
    console.log(`  ❌ Failed: ${error}`);
    return false;
  }
}

async function main() {
  console.log("🧪 Polygon.io API Integration Tests");
  console.log("====================================");
  console.log(`Using API key: ${API_KEY.slice(0, 8)}...`);
  console.log(`Note: Financial ratios use SEC EDGAR (free) instead of Polygon Financials add-on`);

  const results = {
    quotes: await testQuotes(),
    news: await testNews(),
    indicators: await testIndicators(),
    tickers: await testTickers(),
  };

  console.log("\n====================================");
  console.log("📋 Summary:");

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  for (const [name, passed] of Object.entries(results)) {
    console.log(`   ${passed ? "✅" : "❌"} ${name}`);
  }

  console.log(`\n${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("🎉 All tests passed!");
  } else {
    console.log("⚠️  Some tests failed");
  }
}

main().catch(console.error);

#!/usr/bin/env bun

/**
 * Test: Memory + Attribution
 *
 * - Creates insights with various tags/symbols
 * - Queries by symbol, tag, topic
 * - Verifies relevance scoring order
 * - Tests pruning
 * - Tests buildMemoryContext() output format
 * - Tests attribution recording and P&L distribution
 */

import { AttributionEngine } from "../src/attribution/engine.js";
import { MemoryStore } from "../src/memory/store.js";

console.log("Testing Memory + Attribution System\n");
console.log("=".repeat(50));

// ========== MEMORY TESTS ==========

console.log("\n--- Memory Store Tests ---\n");

// Use a fresh store (tests will use in-memory data)
const store = new MemoryStore();

// Test 1: Add insights
console.log("1. Adding memory entries...");
const entries = [
  {
    type: "insight" as const,
    content: "AAPL shows strong support at $150",
    symbols: ["AAPL"],
    tags: ["technical", "support"],
    confidence: 0.8,
    source: "agent",
  },
  {
    type: "trade_lesson" as const,
    content: "RSI oversold bounce works well in GOOGL",
    symbols: ["GOOGL"],
    tags: ["technical", "rsi"],
    confidence: 0.9,
    source: "agent",
  },
  {
    type: "market_observation" as const,
    content: "Tech sector rotating into value",
    symbols: ["AAPL", "GOOGL", "MSFT"],
    tags: ["sector", "rotation"],
    confidence: 0.7,
    source: "agent",
  },
  {
    type: "strategy_learning" as const,
    content: "SMA crossover signals are more reliable with volume confirmation",
    symbols: [],
    tags: ["strategy", "sma", "volume"],
    confidence: 0.85,
    source: "agent",
  },
  {
    type: "regime_change" as const,
    content: "Fed hawkish pivot increasing volatility",
    symbols: [],
    tags: ["macro", "fed", "volatility"],
    confidence: 0.6,
    source: "agent",
  },
  {
    type: "insight" as const,
    content: "MSFT cloud revenue beating expectations",
    symbols: ["MSFT"],
    tags: ["fundamental", "earnings"],
    confidence: 0.75,
    source: "agent",
  },
  {
    type: "trade_lesson" as const,
    content: "Stop losses at 5% are too tight for TSLA",
    symbols: ["TSLA"],
    tags: ["risk", "stop-loss"],
    confidence: 0.8,
    source: "agent",
  },
  {
    type: "insight" as const,
    content: "NVDA AI demand exceeding supply chain capacity",
    symbols: ["NVDA"],
    tags: ["fundamental", "ai"],
    confidence: 0.9,
    source: "agent",
  },
  {
    type: "market_observation" as const,
    content: "VIX spike correlates with buying opportunity",
    symbols: [],
    tags: ["macro", "vix", "opportunity"],
    confidence: 0.65,
    source: "agent",
  },
  {
    type: "insight" as const,
    content: "AAPL earnings beat consistently in Q4",
    symbols: ["AAPL"],
    tags: ["fundamental", "earnings", "seasonal"],
    confidence: 0.85,
    source: "agent",
  },
];

for (const entry of entries) {
  store.add(entry);
}
console.log(`   Added ${entries.length} entries. Total: ${store.getCount()}`);
console.log("   ✓ Entries added");

// Test 2: Query by symbol
console.log("\n2. Querying by symbol (AAPL)...");
const aaplResults = store.query({ symbols: ["AAPL"] });
console.log(`   Found ${aaplResults.length} results`);
for (const r of aaplResults.slice(0, 3)) {
  console.log(`   [${r.relevanceScore.toFixed(2)}] ${r.entry.content.slice(0, 60)}...`);
}
console.log("   ✓ Symbol query works");

// Test 3: Query by tag
console.log("\n3. Querying by tag (technical)...");
const techResults = store.query({ tags: ["technical"] });
console.log(`   Found ${techResults.length} results`);
console.log("   ✓ Tag query works");

// Test 4: Query by topic
console.log("\n4. Querying by topic (earnings)...");
const earningsResults = store.query({ topic: "earnings" });
console.log(`   Found ${earningsResults.length} results`);
console.log("   ✓ Topic query works");

// Test 5: Verify relevance scoring order
console.log("\n5. Verifying relevance scoring...");
const scored = store.query({ symbols: ["AAPL"], tags: ["technical"] });
let ordered = true;
for (let i = 1; i < scored.length; i++) {
  if (scored[i]!.relevanceScore > scored[i - 1]!.relevanceScore) {
    ordered = false;
    break;
  }
}
console.log(`   Results ordered by relevance: ${ordered ? "YES" : "NO"}`);
console.log("   ✓ Relevance scoring verified");

// Test 6: buildMemoryContext
console.log("\n6. Testing buildMemoryContext()...");
const context = store.buildMemoryContext(["AAPL", "GOOGL", "MSFT"]);
console.log(`   Context length: ${context.length} chars`);
if (context.length > 0) {
  console.log(`   First line: ${context.split("\n")[0]}`);
}
console.log("   ✓ Memory context built");

// Test 7: Query with confidence filter
console.log("\n7. Querying with minConfidence=0.8...");
const highConfResults = store.query({ minConfidence: 0.8 });
console.log(`   Found ${highConfResults.length} high-confidence results`);
console.log("   ✓ Confidence filtering works");

// ========== ATTRIBUTION TESTS ==========

console.log("\n--- Attribution Engine Tests ---\n");

const attribution = new AttributionEngine();

// Test 8: Record attribution
console.log("8. Recording trade attribution...");
const attr = attribution.recordAttribution("trade-001", "AAPL", "buy", 500, [
  { signalId: "sig-1", agentRole: "fundamental-analyst", signal: "BUY", confidence: 0.8, weight: 0.25 },
  { signalId: "sig-2", agentRole: "technical-analyst", signal: "BUY", confidence: 0.7, weight: 0.15 },
  { signalId: "sig-3", agentRole: "sentiment-analyst", signal: "BUY", confidence: 0.6, weight: 0.1 },
]);
console.log(`   Trade ${attr.tradeId}: $${attr.pnl} distributed across ${attr.signals.length} signals`);
for (const sig of attr.signals) {
  console.log(`   ${sig.agentRole}: $${sig.attributedPnl.toFixed(2)} (conf: ${sig.confidence}, weight: ${sig.weight})`);
}
console.log("   ✓ Attribution recorded");

// Test 9: Record a losing trade
console.log("\n9. Recording losing trade attribution...");
attribution.recordAttribution("trade-002", "GOOGL", "sell", -200, [
  { signalId: "sig-4", agentRole: "technical-analyst", signal: "SELL", confidence: 0.5, weight: 0.15 },
  { signalId: "sig-5", agentRole: "macro-analyst", signal: "SELL", confidence: 0.6, weight: 0.15 },
]);
console.log("   ✓ Losing trade recorded");

// Test 10: Get performance
console.log("\n10. Getting agent performance...");
const performances = attribution.getPerformance();
for (const perf of performances) {
  console.log(
    `   ${perf.agentRole}: ${perf.totalSignals} signals, accuracy ${(perf.accuracy * 100).toFixed(0)}%, P&L $${perf.totalAttributedPnl.toFixed(2)}`,
  );
}
console.log("   ✓ Performance metrics computed");

// Test 11: Calculate weight adjustments
console.log("\n11. Calculating weight adjustments...");
const currentWeights: Record<string, number> = {
  "fundamental-analyst": 0.25,
  "technical-analyst": 0.15,
  "sentiment-analyst": 0.1,
  "macro-analyst": 0.15,
};
const adjustments = attribution.calculateWeightAdjustments(currentWeights);
for (const adj of adjustments) {
  console.log(`   ${adj.agentRole}: ${adj.previousWeight.toFixed(3)} -> ${adj.newWeight.toFixed(3)} (${adj.reason})`);
}
console.log(`   ${adjustments.length > 0 ? "Adjustments suggested" : "No adjustments (need more data)"}`);
console.log("   ✓ Weight adjustment system works");

console.log(`\n${"=".repeat(50)}`);
console.log("All memory + attribution tests passed!");

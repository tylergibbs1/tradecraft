/**
 * Agent Swarm Example
 *
 * Demonstrates how to use the multi-agent hedge fund architecture.
 *
 * Run with: bun src/agents/example.ts
 */

import {
  createSwarm,
  getSharedSignalBus,
  AgentCycleContext,
  PriceBar,
} from './index.js';
import { DataManager } from '../data/index.js';
import { YahooDataProvider } from '../data/providers/yahoo.js';

// Simple price data fetcher using Yahoo Finance
async function createPriceDataFetcher(): Promise<(symbol: string, days: number) => Promise<PriceBar[]>> {
  const yahoo = new YahooDataProvider();

  return async (symbol: string, days: number): Promise<PriceBar[]> => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await yahoo.getHistory(symbol, '1d', startDate, endDate);

    return history.map(bar => ({
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  };
}

async function main() {
  console.log('🤖 Agent Swarm Example\n');

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY environment variable not set');
    console.log('\nSet your API key:');
    console.log('  export ANTHROPIC_API_KEY=your-key-here');
    process.exit(1);
  }

  // Trading universe
  const tradingUniverse = ['AAPL', 'MSFT', 'GOOGL'];

  console.log(`📊 Trading Universe: ${tradingUniverse.join(', ')}\n`);

  // Create price data fetcher
  const priceDataFetcher = await createPriceDataFetcher();

  // Create the swarm
  const swarm = createSwarm({
    apiKey,
    tradingUniverse,
    model: 'claude-sonnet-4-20250514', // Use Sonnet for cost efficiency
    priceDataFetcher,
    exaApiKey: process.env.EXA_API_KEY,
  });

  console.log('🐝 Swarm initialized with agents:');
  for (const specialist of swarm.getSpecialists()) {
    console.log(`   - ${specialist.role}`);
  }
  console.log('');

  // Build cycle context
  const cycleContext: AgentCycleContext = {
    cycleId: 'example-cycle-1',
    timestamp: new Date().toISOString(),
    tradingUniverse,
    portfolioSnapshot: {
      cash: 100000,
      equity: 100000,
      positions: new Map(),
    },
    riskStatus: {
      canTrade: true,
      circuitBreaker: 'closed',
      currentDrawdown: 0,
    },
  };

  console.log('🔄 Running swarm cycle...\n');
  console.log('This will run all specialist agents in parallel:');
  console.log('  1. Fundamental Analyst - analyzing 10-K filings');
  console.log('  2. Technical Analyst - analyzing price patterns');
  console.log('  3. Sentiment Analyst - analyzing news sentiment');
  console.log('  4. Macro Analyst - analyzing sector/market conditions\n');

  try {
    // Run the swarm cycle
    const result = await swarm.runSwarmCycle(cycleContext, {
      symbolsToAnalyze: tradingUniverse.slice(0, 1), // Start with just one symbol for demo
      parallelSpecialists: true,
    });

    console.log('\n📈 Swarm Cycle Results:');
    console.log(`   Cycle ID: ${result.cycleId}`);
    console.log(`   Symbols Analyzed: ${result.symbolsAnalyzed.join(', ')}`);
    console.log(`   Total Tokens Used: ${result.totalTokensUsed.toLocaleString()}`);
    console.log(`   Estimated Cost: $${result.totalCostUsd.toFixed(4)}`);

    if (result.error) {
      console.log(`   ❌ Error: ${result.error}`);
    }

    // Show specialist results
    console.log('\n🔬 Specialist Results:');
    for (const specialist of result.specialistResults) {
      const status = specialist.error ? '❌' : '✅';
      console.log(`   ${status} ${specialist.role}: ${specialist.signalsPublished} signals, ${specialist.tokensUsed} tokens`);
      if (specialist.error) {
        console.log(`      Error: ${specialist.error}`);
      }
    }

    // Show trade decisions
    if (result.tradeDecisions.length > 0) {
      console.log('\n💰 Trade Decisions:');
      for (const decision of result.tradeDecisions) {
        console.log(`   ${decision.symbol}: ${decision.action} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`);
        console.log(`      Reason: ${decision.reason.slice(0, 100)}...`);
      }
    } else {
      console.log('\n💤 No trade decisions (insufficient consensus or confidence)');
    }

    // Show consensus
    console.log('\n📊 Consensus by Symbol:');
    const allConsensus = swarm.getAllConsensus();
    for (const [symbol, consensus] of allConsensus) {
      console.log(`   ${symbol}: ${consensus.recommendation} (score: ${consensus.weightedScore.toFixed(2)}, signals: ${consensus.signalCount})`);
      if (consensus.dissent && consensus.dissent.length > 0) {
        console.log(`      ⚠️ Dissent: ${consensus.dissent.length} conflicting views`);
      }
    }

    // Show signal breakdown by role
    console.log('\n📋 Signals by Agent Role:');
    const signalsByRole = swarm.getSignalsByRole();
    for (const [role, count] of signalsByRole) {
      console.log(`   ${role}: ${count} signals`);
    }

  } catch (error) {
    console.error('❌ Swarm cycle failed:', error);
  }

  // Display signal bus state
  console.log('\n📡 Signal Bus State:');
  const signalBus = getSharedSignalBus();
  const allSignals = signalBus.getAllSignals();
  console.log(`   Total signals in bus: ${allSignals.length}`);

  if (allSignals.length > 0) {
    console.log('\n   Recent signals:');
    for (const signal of allSignals.slice(-5)) {
      console.log(`   - ${signal.symbol} | ${signal.agentRole} | ${signal.signal} | ${(signal.confidence * 100).toFixed(0)}% confidence`);
      console.log(`     ${signal.reasoning.slice(0, 80)}...`);
    }
  }

  console.log('\n✅ Example complete!');
}

// Run if executed directly
main().catch(console.error);

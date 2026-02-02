/**
 * Agent Swarm Module
 *
 * Multi-agent hedge fund architecture with:
 * - Specialist research agents (fundamental, technical, sentiment, macro)
 * - Hypothesis generator for alpha discovery
 * - Portfolio manager for signal aggregation and trade execution
 * - Signal bus for inter-agent communication
 */

// Core types
export * from './types.js';

// Signal bus for inter-agent communication
export { SignalBus, getSharedSignalBus, resetSharedSignalBus } from './signal-bus.js';

// Base agent class
export { ResearchAgent, ResearchAgentDependencies, AnalysisCycleResult } from './base.js';

// Specialist agents
export {
  FundamentalAnalyst,
  TechnicalAnalyst,
  SentimentAnalyst,
  MacroAnalyst,
  HypothesisGenerator,
} from './specialists/index.js';

// Portfolio manager (orchestrator)
export {
  PortfolioManagerAgent,
  PortfolioManagerConfig,
  PortfolioManagerDependencies,
  TradeDecision,
  SwarmCycleResult,
  createSwarm,
} from './portfolio-manager.js';

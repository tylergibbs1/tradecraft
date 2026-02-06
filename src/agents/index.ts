/**
 * Agent Swarm Module
 *
 * Multi-agent hedge fund architecture with:
 * - Specialist research agents (fundamental, technical, sentiment, macro)
 * - Hypothesis generator for alpha discovery
 * - Portfolio manager for signal aggregation and trade execution
 * - Signal bus for inter-agent communication
 */

// Base agent class
export { AnalysisCycleResult, ResearchAgent, ResearchAgentDependencies } from "./base.js";
// Portfolio manager (orchestrator)
export {
  createSwarm,
  PortfolioManagerAgent,
  PortfolioManagerConfig,
  PortfolioManagerDependencies,
  SwarmCycleResult,
  TradeDecision,
} from "./portfolio-manager.js";
// Signal bus for inter-agent communication
export { getSharedSignalBus, resetSharedSignalBus, SignalBus } from "./signal-bus.js";

// Specialist agents
export {
  FundamentalAnalyst,
  HypothesisGenerator,
  MacroAnalyst,
  SentimentAnalyst,
  TechnicalAnalyst,
} from "./specialists/index.js";
// Core types
export * from "./types.js";

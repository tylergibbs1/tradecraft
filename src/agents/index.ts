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
export { ResearchAgent } from './base.js';
export type { ResearchAgentDependencies, AnalysisCycleResult } from './base.js';

// Specialist agents
export {
  FundamentalAnalyst,
  TechnicalAnalyst,
  SentimentAnalyst,
  MacroAnalyst,
  HypothesisGenerator,
} from './specialists/index.js';

// Portfolio manager (orchestrator)
export { PortfolioManagerAgent, createSwarm } from './portfolio-manager.js';
export type {
  PortfolioManagerConfig,
  PortfolioManagerDependencies,
} from './portfolio-manager.js';

// Re-export UI state types from types.ts
export type {
  SwarmCallbacks,
  SwarmCycleResult,
  TradeDecision,
  AgentAnalysisResult,
  SpecialistStatus,
  SpecialistUIState,
  SwarmUIState,
} from './types.js';

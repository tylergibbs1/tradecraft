/**
 * Capital Allocation Module
 *
 * Demonstrates LLM capital allocation vs heuristic baselines.
 */

export { AllocationEngine } from "./engine.js";
export { equalWeight, highestIRRFirst, lowestRiskFirst, riskParity, runAllHeuristics } from "./heuristics.js";
export { createAllocationTools } from "./tools.js";
export type {
  AllocationConstraints,
  AllocationDecision,
  AllocationResult,
  HeuristicAllocation,
  HeuristicName,
  Project,
  RiskLevel,
} from "./types.js";
export { DEFAULT_CONSTRAINTS } from "./types.js";

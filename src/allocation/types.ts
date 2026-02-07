/**
 * Corporate Capital Allocation Types
 *
 * Types for demonstrating LLM allocation vs heuristic baselines.
 */

export type RiskLevel = "low" | "medium" | "high";

export interface Project {
  id: string;
  name: string;
  estimatedIRR: number;
  timelineMonths: number;
  capitalRequired: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  sector: string;
  description: string;
}

export interface AllocationDecision {
  projectId: string;
  allocatedCapital: number;
  percentOfBudget: number;
  reasoning: string;
  confidence: number;
}

export interface AllocationConstraints {
  maxPerProject: number; // fraction, e.g. 0.4 = 40%
  maxRiskConcentration: number; // fraction of budget in high-risk projects
}

export const DEFAULT_CONSTRAINTS: AllocationConstraints = {
  maxPerProject: 0.4,
  maxRiskConcentration: 0.5,
};

export type HeuristicName = "equal_weight" | "highest_irr_first" | "lowest_risk_first" | "risk_parity";

export interface HeuristicAllocation {
  heuristic: HeuristicName;
  allocations: { projectId: string; allocatedCapital: number }[];
  weightedIRR: number;
  weightedRisk: number;
  totalAllocated: number;
}

export interface AllocationResult {
  agentAllocations: AllocationDecision[];
  agentWeightedIRR: number;
  agentWeightedRisk: number;
  agentTotalAllocated: number;
  heuristicResults: HeuristicAllocation[];
  irrAdvantageVsHeuristics: { heuristic: HeuristicName; advantage: number }[];
  riskDiffVsHeuristics: { heuristic: HeuristicName; riskDiff: number }[];
  validationErrors: string[];
}

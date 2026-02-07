/**
 * Capital Allocation Heuristics
 *
 * Four baseline strategies for comparison against agent allocation.
 */

import type { HeuristicAllocation, Project, RiskLevel } from "./types.js";

const RISK_SCORES: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function computeWeightedIRR(
  allocations: { projectId: string; allocatedCapital: number }[],
  projects: Project[],
): number {
  const total = allocations.reduce((s, a) => s + a.allocatedCapital, 0);
  if (total === 0) return 0;

  let weightedIRR = 0;
  for (const alloc of allocations) {
    const project = projects.find((p) => p.id === alloc.projectId);
    if (project) {
      weightedIRR += (alloc.allocatedCapital / total) * project.estimatedIRR;
    }
  }
  return weightedIRR;
}

function computeWeightedRisk(
  allocations: { projectId: string; allocatedCapital: number }[],
  projects: Project[],
): number {
  const total = allocations.reduce((s, a) => s + a.allocatedCapital, 0);
  if (total === 0) return 0;

  let weightedRisk = 0;
  for (const alloc of allocations) {
    const project = projects.find((p) => p.id === alloc.projectId);
    if (project) {
      weightedRisk += (alloc.allocatedCapital / total) * RISK_SCORES[project.riskLevel];
    }
  }
  return weightedRisk;
}

/**
 * Equal weight: budget / N per project (capped by capital required).
 */
export function equalWeight(projects: Project[], budget: number): HeuristicAllocation {
  const perProject = budget / projects.length;
  const allocations = projects.map((p) => ({
    projectId: p.id,
    allocatedCapital: Math.min(perProject, p.capitalRequired),
  }));
  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedCapital, 0);

  return {
    heuristic: "equal_weight",
    allocations,
    weightedIRR: computeWeightedIRR(allocations, projects),
    weightedRisk: computeWeightedRisk(allocations, projects),
    totalAllocated,
  };
}

/**
 * Highest IRR first: greedy fill by descending IRR.
 */
export function highestIRRFirst(projects: Project[], budget: number): HeuristicAllocation {
  const sorted = [...projects].sort((a, b) => b.estimatedIRR - a.estimatedIRR);
  const allocations: { projectId: string; allocatedCapital: number }[] = [];
  let remaining = budget;

  for (const project of sorted) {
    if (remaining <= 0) break;
    const alloc = Math.min(remaining, project.capitalRequired);
    allocations.push({ projectId: project.id, allocatedCapital: alloc });
    remaining -= alloc;
  }

  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedCapital, 0);

  return {
    heuristic: "highest_irr_first",
    allocations,
    weightedIRR: computeWeightedIRR(allocations, projects),
    weightedRisk: computeWeightedRisk(allocations, projects),
    totalAllocated,
  };
}

/**
 * Lowest risk first: greedy fill by ascending risk.
 */
export function lowestRiskFirst(projects: Project[], budget: number): HeuristicAllocation {
  const sorted = [...projects].sort((a, b) => RISK_SCORES[a.riskLevel] - RISK_SCORES[b.riskLevel]);
  const allocations: { projectId: string; allocatedCapital: number }[] = [];
  let remaining = budget;

  for (const project of sorted) {
    if (remaining <= 0) break;
    const alloc = Math.min(remaining, project.capitalRequired);
    allocations.push({ projectId: project.id, allocatedCapital: alloc });
    remaining -= alloc;
  }

  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedCapital, 0);

  return {
    heuristic: "lowest_risk_first",
    allocations,
    weightedIRR: computeWeightedIRR(allocations, projects),
    weightedRisk: computeWeightedRisk(allocations, projects),
    totalAllocated,
  };
}

/**
 * Risk parity: allocate inversely proportional to risk score.
 */
export function riskParity(projects: Project[], budget: number): HeuristicAllocation {
  const inverseRisks = projects.map((p) => 1 / RISK_SCORES[p.riskLevel]);
  const totalInverseRisk = inverseRisks.reduce((s, r) => s + r, 0);

  const allocations = projects.map((p, i) => {
    const weight = inverseRisks[i]! / totalInverseRisk;
    return {
      projectId: p.id,
      allocatedCapital: Math.min(weight * budget, p.capitalRequired),
    };
  });

  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedCapital, 0);

  return {
    heuristic: "risk_parity",
    allocations,
    weightedIRR: computeWeightedIRR(allocations, projects),
    weightedRisk: computeWeightedRisk(allocations, projects),
    totalAllocated,
  };
}

export function runAllHeuristics(projects: Project[], budget: number): HeuristicAllocation[] {
  return [
    equalWeight(projects, budget),
    highestIRRFirst(projects, budget),
    lowestRiskFirst(projects, budget),
    riskParity(projects, budget),
  ];
}

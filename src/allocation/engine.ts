/**
 * Allocation Engine
 *
 * Validates agent allocations and compares against heuristic baselines.
 */

import { runAllHeuristics } from "./heuristics.js";
import type { AllocationConstraints, AllocationDecision, AllocationResult, Project, RiskLevel } from "./types.js";

const RISK_SCORES: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export class AllocationEngine {
  private projects: Project[];
  private budget: number;
  private constraints: AllocationConstraints;

  constructor(projects: Project[], budget: number, constraints?: AllocationConstraints) {
    this.projects = projects;
    this.budget = budget;
    this.constraints = constraints ?? { maxPerProject: 0.4, maxRiskConcentration: 0.5 };
  }

  getProjects(): Project[] {
    return this.projects;
  }

  getBudget(): number {
    return this.budget;
  }

  getConstraints(): AllocationConstraints {
    return this.constraints;
  }

  /**
   * Validate a set of allocation decisions against constraints.
   */
  validateAllocation(decisions: AllocationDecision[]): string[] {
    const errors: string[] = [];

    // Check total doesn't exceed budget
    const totalAllocated = decisions.reduce((s, d) => s + d.allocatedCapital, 0);
    if (totalAllocated > this.budget * 1.001) {
      errors.push(`Total allocated ($${totalAllocated.toFixed(0)}) exceeds budget ($${this.budget.toFixed(0)})`);
    }

    // Check per-project max
    const maxPerProject = this.budget * this.constraints.maxPerProject;
    for (const decision of decisions) {
      if (decision.allocatedCapital > maxPerProject * 1.001) {
        errors.push(
          `Project ${decision.projectId}: $${decision.allocatedCapital.toFixed(0)} exceeds per-project max ($${maxPerProject.toFixed(0)})`,
        );
      }
    }

    // Check per-project capital cap
    for (const decision of decisions) {
      const project = this.projects.find((p) => p.id === decision.projectId);
      if (project && decision.allocatedCapital > project.capitalRequired * 1.001) {
        errors.push(
          `Project ${decision.projectId}: allocated $${decision.allocatedCapital.toFixed(0)} exceeds required $${project.capitalRequired.toFixed(0)}`,
        );
      }
    }

    // Check risk concentration
    let highRiskTotal = 0;
    for (const decision of decisions) {
      const project = this.projects.find((p) => p.id === decision.projectId);
      if (project?.riskLevel === "high") {
        highRiskTotal += decision.allocatedCapital;
      }
    }
    const maxRiskAllowed = this.budget * this.constraints.maxRiskConcentration;
    if (highRiskTotal > maxRiskAllowed * 1.001) {
      errors.push(`High-risk concentration ($${highRiskTotal.toFixed(0)}) exceeds max ($${maxRiskAllowed.toFixed(0)})`);
    }

    // Check unknown projects
    for (const decision of decisions) {
      if (!this.projects.find((p) => p.id === decision.projectId)) {
        errors.push(`Unknown project: ${decision.projectId}`);
      }
    }

    return errors;
  }

  /**
   * Compare agent allocation against all heuristic baselines.
   */
  compareToHeuristics(decisions: AllocationDecision[]): AllocationResult {
    const validationErrors = this.validateAllocation(decisions);

    const totalAllocated = decisions.reduce((s, d) => s + d.allocatedCapital, 0);

    // Agent weighted IRR
    let agentWeightedIRR = 0;
    let agentWeightedRisk = 0;
    if (totalAllocated > 0) {
      for (const decision of decisions) {
        const project = this.projects.find((p) => p.id === decision.projectId);
        if (project) {
          const weight = decision.allocatedCapital / totalAllocated;
          agentWeightedIRR += weight * project.estimatedIRR;
          agentWeightedRisk += weight * RISK_SCORES[project.riskLevel];
        }
      }
    }

    // Run all heuristics
    const heuristicResults = runAllHeuristics(this.projects, this.budget);

    // Compare
    const irrAdvantageVsHeuristics = heuristicResults.map((h) => ({
      heuristic: h.heuristic,
      advantage: agentWeightedIRR - h.weightedIRR,
    }));

    const riskDiffVsHeuristics = heuristicResults.map((h) => ({
      heuristic: h.heuristic,
      riskDiff: agentWeightedRisk - h.weightedRisk,
    }));

    return {
      agentAllocations: decisions,
      agentWeightedIRR,
      agentWeightedRisk,
      agentTotalAllocated: totalAllocated,
      heuristicResults,
      irrAdvantageVsHeuristics,
      riskDiffVsHeuristics,
      validationErrors,
    };
  }
}

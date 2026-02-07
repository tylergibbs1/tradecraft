import { describe, expect, test } from "bun:test";
import { AllocationEngine } from "../../src/allocation/engine.js";
import {
  equalWeight,
  highestIRRFirst,
  lowestRiskFirst,
  riskParity,
  runAllHeuristics,
} from "../../src/allocation/heuristics.js";
import type { AllocationDecision, Project } from "../../src/allocation/types.js";

const PROJECTS: Project[] = [
  {
    id: "proj-a",
    name: "Project A",
    estimatedIRR: 0.3,
    timelineMonths: 12,
    capitalRequired: 500_000,
    riskLevel: "high",
    riskFactors: ["Tech risk"],
    sector: "Technology",
    description: "High IRR, high risk",
  },
  {
    id: "proj-b",
    name: "Project B",
    estimatedIRR: 0.15,
    timelineMonths: 6,
    capitalRequired: 300_000,
    riskLevel: "low",
    riskFactors: ["Low risk"],
    sector: "Operations",
    description: "Moderate IRR, low risk",
  },
  {
    id: "proj-c",
    name: "Project C",
    estimatedIRR: 0.2,
    timelineMonths: 18,
    capitalRequired: 400_000,
    riskLevel: "medium",
    riskFactors: ["Moderate risk"],
    sector: "Marketing",
    description: "Good IRR, medium risk",
  },
];

const BUDGET = 1_000_000;

describe("Heuristics", () => {
  test("equalWeight distributes evenly (capped by capital required)", () => {
    const result = equalWeight(PROJECTS, BUDGET);
    expect(result.heuristic).toBe("equal_weight");
    expect(result.allocations).toHaveLength(3);
    // Each gets min(1M/3, capitalRequired) = min(333k, cap)
    for (const a of result.allocations) {
      const proj = PROJECTS.find((p) => p.id === a.projectId)!;
      expect(a.allocatedCapital).toBeLessThanOrEqual(proj.capitalRequired + 1);
      expect(a.allocatedCapital).toBeLessThanOrEqual(BUDGET / 3 + 1);
    }
    expect(result.weightedIRR).toBeGreaterThan(0);
  });

  test("highestIRRFirst fills from highest IRR", () => {
    const result = highestIRRFirst(PROJECTS, BUDGET);
    expect(result.heuristic).toBe("highest_irr_first");
    // Should allocate to proj-a first (0.30 IRR), then proj-c (0.20), then proj-b (0.15)
    const allocA = result.allocations.find((a) => a.projectId === "proj-a")!;
    expect(allocA.allocatedCapital).toBe(500_000);
    const allocC = result.allocations.find((a) => a.projectId === "proj-c")!;
    expect(allocC.allocatedCapital).toBe(400_000);
    // Remaining 100k to proj-b
    const allocB = result.allocations.find((a) => a.projectId === "proj-b")!;
    expect(allocB.allocatedCapital).toBe(100_000);
  });

  test("lowestRiskFirst fills from lowest risk", () => {
    const result = lowestRiskFirst(PROJECTS, BUDGET);
    expect(result.heuristic).toBe("lowest_risk_first");
    // proj-b (low) first, then proj-c (medium), then proj-a (high)
    const allocB = result.allocations.find((a) => a.projectId === "proj-b")!;
    expect(allocB.allocatedCapital).toBe(300_000);
    expect(result.weightedRisk).toBeLessThan(3);
  });

  test("riskParity allocates inversely to risk", () => {
    const result = riskParity(PROJECTS, BUDGET);
    expect(result.heuristic).toBe("risk_parity");
    // Low risk (score 1) gets more than high risk (score 3)
    const allocB = result.allocations.find((a) => a.projectId === "proj-b")!;
    const allocA = result.allocations.find((a) => a.projectId === "proj-a")!;
    // proj-b should get more weight (lower risk), but capped at capitalRequired
    expect(allocB.allocatedCapital).toBeGreaterThan(0);
    expect(allocA.allocatedCapital).toBeGreaterThan(0);
  });

  test("runAllHeuristics returns 4 results", () => {
    const results = runAllHeuristics(PROJECTS, BUDGET);
    expect(results).toHaveLength(4);
    const names = results.map((r) => r.heuristic);
    expect(names).toContain("equal_weight");
    expect(names).toContain("highest_irr_first");
    expect(names).toContain("lowest_risk_first");
    expect(names).toContain("risk_parity");
  });
});

describe("AllocationEngine", () => {
  test("validates within constraints", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET);
    const decisions: AllocationDecision[] = [
      { projectId: "proj-a", allocatedCapital: 300_000, percentOfBudget: 0.3, reasoning: "Good", confidence: 0.8 },
      { projectId: "proj-b", allocatedCapital: 300_000, percentOfBudget: 0.3, reasoning: "Safe", confidence: 0.9 },
      { projectId: "proj-c", allocatedCapital: 400_000, percentOfBudget: 0.4, reasoning: "Balanced", confidence: 0.7 },
    ];

    const errors = engine.validateAllocation(decisions);
    expect(errors).toHaveLength(0);
  });

  test("rejects over-budget allocation", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET);
    const decisions: AllocationDecision[] = [
      { projectId: "proj-a", allocatedCapital: 500_000, percentOfBudget: 0.5, reasoning: "Max", confidence: 0.8 },
      { projectId: "proj-b", allocatedCapital: 300_000, percentOfBudget: 0.3, reasoning: "Full", confidence: 0.9 },
      { projectId: "proj-c", allocatedCapital: 400_000, percentOfBudget: 0.4, reasoning: "Full", confidence: 0.7 },
    ];

    const errors = engine.validateAllocation(decisions);
    expect(errors.some((e) => e.includes("exceeds budget"))).toBe(true);
  });

  test("rejects per-project max violation", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET, {
      maxPerProject: 0.2,
      maxRiskConcentration: 0.5,
    });
    const decisions: AllocationDecision[] = [
      { projectId: "proj-a", allocatedCapital: 300_000, percentOfBudget: 0.3, reasoning: "Over", confidence: 0.8 },
    ];

    const errors = engine.validateAllocation(decisions);
    expect(errors.some((e) => e.includes("per-project max"))).toBe(true);
  });

  test("rejects risk concentration violation", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET, {
      maxPerProject: 0.6,
      maxRiskConcentration: 0.2,
    });
    // proj-a is high risk, allocating 300k when max is 200k (20% of 1M)
    const decisions: AllocationDecision[] = [
      { projectId: "proj-a", allocatedCapital: 300_000, percentOfBudget: 0.3, reasoning: "Risk", confidence: 0.8 },
    ];

    const errors = engine.validateAllocation(decisions);
    expect(errors.some((e) => e.includes("High-risk concentration"))).toBe(true);
  });

  test("rejects allocation exceeding project capital required", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET);
    const decisions: AllocationDecision[] = [
      { projectId: "proj-b", allocatedCapital: 400_000, percentOfBudget: 0.4, reasoning: "Too much", confidence: 0.8 },
    ];

    const errors = engine.validateAllocation(decisions);
    expect(errors.some((e) => e.includes("exceeds required"))).toBe(true);
  });

  test("rejects unknown project", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET);
    const decisions: AllocationDecision[] = [
      { projectId: "unknown", allocatedCapital: 100_000, percentOfBudget: 0.1, reasoning: "?", confidence: 0.5 },
    ];

    const errors = engine.validateAllocation(decisions);
    expect(errors.some((e) => e.includes("Unknown project"))).toBe(true);
  });

  test("compareToHeuristics computes IRR advantage", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET);
    // Agent focuses on high IRR proj-a
    const decisions: AllocationDecision[] = [
      { projectId: "proj-a", allocatedCapital: 400_000, percentOfBudget: 0.4, reasoning: "Best IRR", confidence: 0.9 },
      { projectId: "proj-c", allocatedCapital: 400_000, percentOfBudget: 0.4, reasoning: "Good IRR", confidence: 0.8 },
      { projectId: "proj-b", allocatedCapital: 200_000, percentOfBudget: 0.2, reasoning: "Diversify", confidence: 0.7 },
    ];

    const result = engine.compareToHeuristics(decisions);
    expect(result.agentWeightedIRR).toBeGreaterThan(0);
    expect(result.heuristicResults).toHaveLength(4);
    expect(result.irrAdvantageVsHeuristics).toHaveLength(4);
    expect(result.riskDiffVsHeuristics).toHaveLength(4);
    expect(result.validationErrors).toHaveLength(0);
  });

  test("getters return correct values", () => {
    const engine = new AllocationEngine(PROJECTS, BUDGET);
    expect(engine.getProjects()).toHaveLength(3);
    expect(engine.getBudget()).toBe(1_000_000);
    expect(engine.getConstraints().maxPerProject).toBe(0.4);
  });
});

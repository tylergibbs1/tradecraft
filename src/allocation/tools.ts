/**
 * Capital Allocation Agent Tools
 *
 * MCP tools for the agent to evaluate and allocate capital across projects.
 */

import { z } from "zod";
import type { AllocationEngine } from "./engine.js";
import type { AllocationDecision } from "./types.js";

const EvaluateProjectsSchema = z.object({});

const SubmitAllocationSchema = z.object({
  allocations: z
    .array(
      z.object({
        projectId: z.string().describe("Project ID"),
        allocatedCapital: z.number().min(0).describe("Capital to allocate to this project"),
        reasoning: z.string().min(1).max(500).describe("Reasoning for this allocation amount"),
        confidence: z.number().min(0).max(1).describe("Confidence in this allocation (0-1)"),
      }),
    )
    .min(1)
    .describe("Allocation decisions for each project"),
});

const CompareHeuristicsSchema = z.object({});

export function createAllocationTools(deps: { engine: AllocationEngine }) {
  const { engine } = deps;

  return {
    evaluate_projects: {
      description:
        "View all available projects with their IRR, timeline, capital requirements, risk levels, and sectors. Also shows the total budget and allocation constraints. Use this to understand what you're allocating capital across.",
      inputSchema: EvaluateProjectsSchema,
      handler: async () => {
        const projects = engine.getProjects();
        const budget = engine.getBudget();
        const constraints = engine.getConstraints();
        const totalRequired = projects.reduce((s, p) => s + p.capitalRequired, 0);

        return {
          success: true,
          budget,
          totalCapitalRequired: totalRequired,
          oversubscriptionRatio: totalRequired / budget,
          constraints: {
            maxPerProject: `${(constraints.maxPerProject * 100).toFixed(0)}% of budget ($${(budget * constraints.maxPerProject).toFixed(0)})`,
            maxRiskConcentration: `${(constraints.maxRiskConcentration * 100).toFixed(0)}% of budget in high-risk projects ($${(budget * constraints.maxRiskConcentration).toFixed(0)})`,
          },
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            estimatedIRR: `${(p.estimatedIRR * 100).toFixed(1)}%`,
            timelineMonths: p.timelineMonths,
            capitalRequired: p.capitalRequired,
            riskLevel: p.riskLevel,
            riskFactors: p.riskFactors,
            sector: p.sector,
            description: p.description,
          })),
          timestamp: new Date().toISOString(),
        };
      },
    },

    submit_allocation: {
      description:
        "Submit your capital allocation decisions. Provide per-project allocations with reasoning and confidence. The system will validate against constraints and compare your allocation against 4 heuristic baselines (equal weight, highest IRR first, lowest risk first, risk parity).",
      inputSchema: SubmitAllocationSchema,
      handler: async (input: z.infer<typeof SubmitAllocationSchema>) => {
        const decisions: AllocationDecision[] = input.allocations.map((a) => ({
          projectId: a.projectId,
          allocatedCapital: a.allocatedCapital,
          percentOfBudget: a.allocatedCapital / engine.getBudget(),
          reasoning: a.reasoning,
          confidence: a.confidence,
        }));

        const result = engine.compareToHeuristics(decisions);

        const beatCount = result.irrAdvantageVsHeuristics.filter((h) => h.advantage > 0).length;

        return {
          success: true,
          validationErrors: result.validationErrors,
          agentPerformance: {
            weightedIRR: `${(result.agentWeightedIRR * 100).toFixed(2)}%`,
            weightedRisk: result.agentWeightedRisk.toFixed(2),
            totalAllocated: result.agentTotalAllocated,
            budgetUtilization: `${((result.agentTotalAllocated / engine.getBudget()) * 100).toFixed(1)}%`,
          },
          vsHeuristics: result.heuristicResults.map((h, i) => ({
            heuristic: h.heuristic,
            heuristicIRR: `${(h.weightedIRR * 100).toFixed(2)}%`,
            irrAdvantage: `${(result.irrAdvantageVsHeuristics[i]!.advantage * 100).toFixed(2)}%`,
            agentBeats: result.irrAdvantageVsHeuristics[i]!.advantage > 0,
          })),
          summary: `Agent beat ${beatCount} of 4 heuristic baselines by weighted IRR.`,
          timestamp: new Date().toISOString(),
        };
      },
    },

    compare_allocation_heuristics: {
      description:
        "View how 4 heuristic allocation strategies would allocate the budget. Use this to calibrate your allocation strategy before submitting. Heuristics: equal_weight, highest_irr_first, lowest_risk_first, risk_parity.",
      inputSchema: CompareHeuristicsSchema,
      handler: async () => {
        const { runAllHeuristics } = await import("./heuristics.js");
        const heuristics = runAllHeuristics(engine.getProjects(), engine.getBudget());

        return {
          success: true,
          heuristics: heuristics.map((h) => ({
            name: h.heuristic,
            weightedIRR: `${(h.weightedIRR * 100).toFixed(2)}%`,
            weightedRisk: h.weightedRisk.toFixed(2),
            totalAllocated: h.totalAllocated,
            allocations: h.allocations.map((a) => ({
              projectId: a.projectId,
              amount: a.allocatedCapital,
            })),
          })),
          timestamp: new Date().toISOString(),
        };
      },
    },
  };
}

export { EvaluateProjectsSchema, SubmitAllocationSchema, CompareHeuristicsSchema };

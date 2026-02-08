#!/usr/bin/env bun

/**
 * Corporate Capital Allocation Demo
 *
 * Demonstrates LLM capital allocation vs heuristic baselines.
 * Runs the Claude agent with allocation tools against 12 sample projects.
 *
 * Usage:
 *   bun run scripts/allocation-demo.ts
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import Anthropic from "@anthropic-ai/sdk";
import { AllocationEngine } from "../src/allocation/engine.js";
import { runAllHeuristics } from "../src/allocation/heuristics.js";
import { createAllocationTools } from "../src/allocation/tools.js";
import type { Project } from "../src/allocation/types.js";

// ─── Sample Projects ────────────────────────────────────

const PROJECTS: Project[] = [
  {
    id: "tech-ai-platform",
    name: "AI Platform Expansion",
    estimatedIRR: 0.35,
    timelineMonths: 18,
    capitalRequired: 2_500_000,
    riskLevel: "high",
    riskFactors: ["Technology risk", "Competition from incumbents", "Talent acquisition"],
    sector: "Technology",
    description: "Expand AI/ML platform to enterprise customers. Requires new infrastructure and engineering team.",
  },
  {
    id: "tech-cloud-migration",
    name: "Cloud Infrastructure Migration",
    estimatedIRR: 0.18,
    timelineMonths: 12,
    capitalRequired: 1_200_000,
    riskLevel: "low",
    riskFactors: ["Execution risk", "Temporary productivity dip"],
    sector: "Technology",
    description: "Migrate legacy on-prem systems to cloud. Reduces OpEx by 40% after completion.",
  },
  {
    id: "tech-mobile-app",
    name: "Mobile App Redesign",
    estimatedIRR: 0.22,
    timelineMonths: 9,
    capitalRequired: 800_000,
    riskLevel: "medium",
    riskFactors: ["User adoption uncertainty", "App store competition"],
    sector: "Technology",
    description: "Complete redesign of mobile app with new UX. Expected to increase DAU by 25%.",
  },
  {
    id: "ops-warehouse",
    name: "Warehouse Automation",
    estimatedIRR: 0.25,
    timelineMonths: 24,
    capitalRequired: 3_000_000,
    riskLevel: "medium",
    riskFactors: ["Implementation complexity", "Labor relations", "Supply chain for equipment"],
    sector: "Operations",
    description: "Automate 60% of warehouse operations with robotics. Reduces fulfillment costs by 35%.",
  },
  {
    id: "ops-supply-chain",
    name: "Supply Chain Optimization",
    estimatedIRR: 0.15,
    timelineMonths: 6,
    capitalRequired: 500_000,
    riskLevel: "low",
    riskFactors: ["Vendor cooperation needed"],
    sector: "Operations",
    description: "ML-driven demand forecasting and inventory optimization. Quick payback through reduced waste.",
  },
  {
    id: "mkt-brand-campaign",
    name: "Brand Awareness Campaign",
    estimatedIRR: 0.12,
    timelineMonths: 12,
    capitalRequired: 1_500_000,
    riskLevel: "medium",
    riskFactors: ["ROI measurement difficulty", "Market saturation", "Brand perception risk"],
    sector: "Marketing",
    description: "National brand campaign across digital and traditional media. Targets 15% brand lift.",
  },
  {
    id: "mkt-content-platform",
    name: "Content Marketing Platform",
    estimatedIRR: 0.2,
    timelineMonths: 8,
    capitalRequired: 600_000,
    riskLevel: "low",
    riskFactors: ["Content quality consistency"],
    sector: "Marketing",
    description: "Build in-house content platform for SEO and thought leadership. Reduces CAC by 20%.",
  },
  {
    id: "rd-quantum",
    name: "Quantum Computing Research",
    estimatedIRR: 0.45,
    timelineMonths: 36,
    capitalRequired: 2_000_000,
    riskLevel: "high",
    riskFactors: ["Technology readiness", "Long timeline", "Uncertain commercial viability", "Talent scarcity"],
    sector: "R&D",
    description: "Exploratory quantum computing research for optimization problems. High risk, high reward.",
  },
  {
    id: "rd-materials",
    name: "Advanced Materials R&D",
    estimatedIRR: 0.28,
    timelineMonths: 18,
    capitalRequired: 1_000_000,
    riskLevel: "high",
    riskFactors: ["Patent risk", "Scale-up uncertainty", "Regulatory approval"],
    sector: "R&D",
    description: "Develop novel composite materials for manufacturing. 3 patent applications pending.",
  },
  {
    id: "infra-data-center",
    name: "Data Center Expansion",
    estimatedIRR: 0.16,
    timelineMonths: 18,
    capitalRequired: 2_500_000,
    riskLevel: "low",
    riskFactors: ["Construction delays", "Energy cost volatility"],
    sector: "Infrastructure",
    description: "Expand data center capacity by 200%. Supports growth for next 5 years.",
  },
  {
    id: "infra-security",
    name: "Cybersecurity Upgrade",
    estimatedIRR: 0.1,
    timelineMonths: 6,
    capitalRequired: 750_000,
    riskLevel: "low",
    riskFactors: ["Integration with legacy systems"],
    sector: "Infrastructure",
    description: "Zero-trust security architecture. Reduces breach risk by 80%. Regulatory compliance.",
  },
  {
    id: "infra-green-energy",
    name: "Green Energy Transition",
    estimatedIRR: 0.14,
    timelineMonths: 24,
    capitalRequired: 1_800_000,
    riskLevel: "medium",
    riskFactors: ["Policy changes", "Technology maturity", "Grid integration"],
    sector: "Infrastructure",
    description: "Transition to 80% renewable energy. Reduces energy costs long-term and meets ESG targets.",
  },
];

const BUDGET = 10_000_000;

// ─── Helpers ────────────────────────────────────────────

function zodToJsonSchema(schema: unknown): Anthropic.Tool.InputSchema {
  const zodSchema = schema as { shape?: Record<string, unknown> };
  if (!zodSchema.shape) {
    return { type: "object", properties: {} };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, fieldSchema] of Object.entries(zodSchema.shape)) {
    const field = fieldSchema as {
      _def?: {
        type?: string;
        element?: { type?: string; shape?: Record<string, unknown> };
        innerType?: {
          _def?: { type?: string; element?: { type?: string; shape?: Record<string, unknown> }; values?: string[] };
        };
        values?: string[];
      };
      description?: string;
    };
    const def = field._def;
    if (!def) continue;

    let innerDef = def;
    const isOptional = def.type === "optional";
    if (isOptional && def.innerType?._def) {
      innerDef = def.innerType._def;
    }

    const typeName = innerDef.type;
    let prop: Record<string, unknown> = {};

    if (typeName === "string") {
      prop = { type: "string" };
    } else if (typeName === "number") {
      prop = { type: "number" };
    } else if (typeName === "boolean") {
      prop = { type: "boolean" };
    } else if (typeName === "array") {
      // Handle array of objects
      const elementShape = innerDef.element?.shape;
      if (elementShape) {
        const itemProps: Record<string, unknown> = {};
        const itemRequired: string[] = [];
        for (const [k, v] of Object.entries(elementShape)) {
          const f = v as { _def?: { type?: string }; description?: string };
          const t = f._def?.type ?? "string";
          itemProps[k] = { type: t === "number" ? "number" : "string", description: f.description };
          itemRequired.push(k);
        }
        prop = { type: "array", items: { type: "object", properties: itemProps, required: itemRequired } };
      } else {
        const itemType = innerDef.element?.type;
        prop = { type: "array", items: { type: itemType === "number" ? "number" : "string" } };
      }
    } else if (typeName === "enum") {
      prop = { type: "string", enum: innerDef.values };
    } else {
      prop = { type: "string" };
    }

    if (field.description) {
      prop.description = field.description;
    }
    properties[key] = prop;
    if (!isOptional) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  } as Anthropic.Tool.InputSchema;
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       CORPORATE CAPITAL ALLOCATION DEMO                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`Budget:   $${BUDGET.toLocaleString()}`);
  console.log(`Projects: ${PROJECTS.length}`);
  const totalRequired = PROJECTS.reduce((s, p) => s + p.capitalRequired, 0);
  console.log(`Required: $${totalRequired.toLocaleString()} (${(totalRequired / BUDGET).toFixed(1)}x oversubscribed)`);
  console.log();

  // Show projects
  console.log("─── Available Projects ────────────────────────────────────\n");
  console.log(
    `  ${"Project".padEnd(30)} ${"Sector".padEnd(16)} ${"IRR".padStart(6)} ${"Risk".padStart(8)} ${"Capital".padStart(12)} ${"Months".padStart(8)}`,
  );
  console.log(`  ${"─".repeat(82)}`);
  for (const p of PROJECTS) {
    console.log(
      `  ${p.name.padEnd(30)} ${p.sector.padEnd(16)} ${(`${(p.estimatedIRR * 100).toFixed(0)}%`).padStart(6)} ${p.riskLevel.padStart(8)} ${(`$${(p.capitalRequired / 1000).toFixed(0)}k`).padStart(12)} ${String(p.timelineMonths).padStart(8)}`,
    );
  }
  console.log();

  // Show heuristic baselines first
  console.log("─── Heuristic Baselines ──────────────────────────────────\n");
  const heuristics = runAllHeuristics(PROJECTS, BUDGET);
  console.log(
    `  ${"Heuristic".padEnd(24)} ${"Wtd IRR".padStart(10)} ${"Wtd Risk".padStart(10)} ${"Allocated".padStart(14)}`,
  );
  console.log(`  ${"─".repeat(60)}`);
  for (const h of heuristics) {
    console.log(
      `  ${h.heuristic.padEnd(24)} ${(`${(h.weightedIRR * 100).toFixed(2)}%`).padStart(10)} ${h.weightedRisk.toFixed(2).padStart(10)} ${(`$${(h.totalAllocated / 1000).toFixed(0)}k`).padStart(14)}`,
    );
  }
  console.log();

  // Run agent
  console.log("─── Agent Allocation ─────────────────────────────────────\n");

  const engine = new AllocationEngine(PROJECTS, BUDGET);
  const tools = createAllocationTools({ engine });

  const anthropicTools: Anthropic.Tool[] = Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.inputSchema),
  }));

  const client = new Anthropic({ apiKey });
  const systemPrompt = `You are a corporate capital allocator. You have a $${BUDGET.toLocaleString()} budget to allocate across multiple projects. Your goal is to maximize risk-adjusted returns while respecting constraints.

Steps:
1. Use evaluate_projects to see all available projects and constraints
2. Use compare_allocation_heuristics to understand baseline strategies
3. Use submit_allocation to submit your allocation with per-project reasoning

Think carefully about:
- Diversification across sectors and risk levels
- Risk-adjusted returns (IRR relative to risk)
- Constraint compliance (max per project, risk concentration)
- Portfolio balance between safe bets and high-upside moonshots`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Allocate the $${BUDGET.toLocaleString()} budget across the available projects. Evaluate all projects first, review heuristic baselines, then submit your optimized allocation with reasoning for each project.`,
    },
  ];

  let totalTokens = 0;
  let turns = 0;

  while (turns < 10) {
    turns++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    });

    totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`  Agent: ${block.text.slice(0, 300)}`);
      } else if (block.type === "tool_use") {
        toolUses.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
      }
    }

    if (toolUses.length === 0) {
      break;
    }

    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

    for (const toolUse of toolUses) {
      console.log(`  → ${toolUse.name}`);
      const tool = tools[toolUse.name as keyof typeof tools];
      if (tool) {
        const result = await tool.handler(toolUse.input as never);
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) });

        // Print summary for submit_allocation
        if (toolUse.name === "submit_allocation") {
          const res = result as {
            agentPerformance?: { weightedIRR: string; weightedRisk: string };
            vsHeuristics?: { heuristic: string; heuristicIRR: string; irrAdvantage: string; agentBeats: boolean }[];
            summary?: string;
          };
          if (res.agentPerformance) {
            console.log(`\n  Agent weighted IRR: ${res.agentPerformance.weightedIRR}`);
            console.log(`  Agent weighted risk: ${res.agentPerformance.weightedRisk}`);
          }
          if (res.vsHeuristics) {
            console.log();
            for (const h of res.vsHeuristics) {
              const icon = h.agentBeats ? "✓" : "✗";
              console.log(`  ${icon} vs ${h.heuristic.padEnd(20)}: IRR advantage ${h.irrAdvantage}`);
            }
          }
          if (res.summary) {
            console.log(`\n  ${res.summary}`);
          }
        }
      }
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  const cost = (totalTokens / 1_000_000) * 9;
  console.log(`\n  Turns: ${turns}, Tokens: ${totalTokens.toLocaleString()}, Cost: ~$${cost.toFixed(2)}`);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Capital allocation demo complete.");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Allocation demo failed:", e);
  process.exit(1);
});

"use client";

import { type SpecialistUIState, type AgentRole } from "./SpecialistPanel";
import { SpecialistAgent } from "./SpecialistAgent";
import { ConsensusPanel, type ConsensusResult } from "./ConsensusPanel";
import { type ActiveTool } from "./ToolProgressIndicator";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface SwarmUIState {
  cycleId: string;
  status: "idle" | "running" | "complete" | "error";
  startedAt?: string;
  specialists: Record<string, SpecialistUIState>;
  consensusMap: Record<string, ConsensusResult>;
  activeTools: Record<string, ActiveTool>;
}

interface SwarmViewProps {
  state: SwarmUIState;
  cycleCount?: number;
  tokensUsed?: number;
  costUsd?: number;
}

const SPECIALIST_ROLES: AgentRole[] = [
  "fundamental-analyst",
  "technical-analyst",
  "sentiment-analyst",
  "macro-analyst",
];

const STATUS_BADGE_VARIANTS: Record<SwarmUIState["status"], "default" | "secondary" | "destructive"> = {
  idle: "secondary",
  running: "default",
  complete: "secondary",
  error: "destructive",
};

const STATUS_BADGE_CLASSES: Record<SwarmUIState["status"], string> = {
  idle: "",
  running: "bg-green-600 animate-pulse",
  complete: "bg-blue-600",
  error: "",
};

export function SwarmView({ state, cycleCount, tokensUsed, costUsd }: SwarmViewProps) {
  // Get active tools for each agent
  const getAgentTools = (agentId: string) => {
    return Object.values(state.activeTools)
      .filter(tool => tool.agentId === agentId)
      .map(tool => ({ toolName: tool.toolName, startedAt: tool.startedAt }));
  };

  return (
    <div className="space-y-4">
      {/* Header with status */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-medium">Agent Swarm</CardTitle>
              <Badge
                variant={STATUS_BADGE_VARIANTS[state.status]}
                className={STATUS_BADGE_CLASSES[state.status]}
              >
                {state.status.toUpperCase()}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {cycleCount !== undefined && (
                <span>Cycle #{cycleCount}</span>
              )}
              {tokensUsed !== undefined && (
                <span>{tokensUsed.toLocaleString()} tokens</span>
              )}
              {costUsd !== undefined && (
                <span>${costUsd.toFixed(4)}</span>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Specialist Agents - Collapsible list */}
      <div className="space-y-2">
        {SPECIALIST_ROLES.map((role) => {
          // Find the specialist state by role
          const specialistState = Object.values(state.specialists).find(
            (s) => s.role === role
          );
          const agentTools = specialistState ? getAgentTools(specialistState.agentId) : [];
          const isActive = specialistState?.status === "analyzing" || specialistState?.status === "publishing";

          return (
            <SpecialistAgent
              key={role}
              role={role}
              state={specialistState}
              activeTools={agentTools}
              defaultOpen={isActive}
            />
          );
        })}
      </div>

      {/* Consensus Panel */}
      <ConsensusPanel consensusMap={state.consensusMap} />
    </div>
  );
}

export default SwarmView;

// Export types for use in other components
export type { SpecialistUIState, AgentRole, ConsensusResult, ActiveTool };

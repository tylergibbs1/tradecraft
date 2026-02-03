"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AgentRole =
  | "portfolio-manager"
  | "fundamental-analyst"
  | "technical-analyst"
  | "sentiment-analyst"
  | "macro-analyst"
  | "earnings-analyst"
  | "catalyst-analyst"
  | "hypothesis-generator";

export type SpecialistStatus = "idle" | "analyzing" | "publishing" | "done" | "error";

export interface SpecialistUIState {
  agentId: string;
  role: AgentRole;
  status: SpecialistStatus;
  currentSymbol?: string;
  signalsPublished: number;
  lastMessage?: string;
  streamingText?: string;
  lastActivity: string;
  error?: string;
}

const ROLE_CONFIG: Record<AgentRole, { label: string; color: string; bgColor: string; badgeColor: string }> = {
  "portfolio-manager": {
    label: "Portfolio Manager",
    color: "border-purple-500/30",
    bgColor: "from-purple-500/5 to-transparent",
    badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  },
  "fundamental-analyst": {
    label: "Fundamental",
    color: "border-blue-500/30",
    bgColor: "from-blue-500/5 to-transparent",
    badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  },
  "technical-analyst": {
    label: "Technical",
    color: "border-fuchsia-500/30",
    bgColor: "from-fuchsia-500/5 to-transparent",
    badgeColor: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  },
  "sentiment-analyst": {
    label: "Sentiment",
    color: "border-cyan-500/30",
    bgColor: "from-cyan-500/5 to-transparent",
    badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  },
  "macro-analyst": {
    label: "Macro",
    color: "border-amber-500/30",
    bgColor: "from-amber-500/5 to-transparent",
    badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
  "earnings-analyst": {
    label: "Earnings",
    color: "border-orange-500/30",
    bgColor: "from-orange-500/5 to-transparent",
    badgeColor: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  },
  "catalyst-analyst": {
    label: "Catalyst",
    color: "border-green-500/30",
    bgColor: "from-green-500/5 to-transparent",
    badgeColor: "bg-green-500/20 text-green-300 border-green-500/30",
  },
  "hypothesis-generator": {
    label: "Hypothesis",
    color: "border-pink-500/30",
    bgColor: "from-pink-500/5 to-transparent",
    badgeColor: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  },
};

const STATUS_CONFIG: Record<SpecialistStatus, { label: string; dot: string; animate?: boolean }> = {
  idle: { label: "Idle", dot: "bg-zinc-500" },
  analyzing: { label: "Analyzing", dot: "bg-blue-500", animate: true },
  publishing: { label: "Publishing", dot: "bg-amber-500", animate: true },
  done: { label: "Done", dot: "bg-emerald-500" },
  error: { label: "Error", dot: "bg-red-500" },
};

interface SpecialistPanelProps {
  state?: SpecialistUIState;
  role: AgentRole;
  onClick?: () => void;
}

export function SpecialistPanel({ state, role, onClick }: SpecialistPanelProps) {
  const status = state?.status || "idle";
  const config = ROLE_CONFIG[role];
  const statusConfig = STATUS_CONFIG[status];

  // Get the last meaningful part of streaming text (last paragraph or sentence)
  const getDisplayText = (text?: string) => {
    if (!text) return null;
    // Take last ~300 chars and find a good break point
    const truncated = text.slice(-400);
    // Try to start from a sentence or paragraph
    const lastBreak = Math.max(
      truncated.lastIndexOf('\n\n'),
      truncated.lastIndexOf('. ') + 1,
      0
    );
    return truncated.slice(lastBreak > 50 ? lastBreak : 0).trim();
  };

  const displayText = getDisplayText(state?.streamingText);

  return (
    <Card
      className={cn(
        "border overflow-hidden h-[180px] flex flex-col transition-all",
        config.color,
        status === "analyzing" && "ring-1 ring-blue-500/20",
        onClick && "cursor-pointer hover:border-foreground/20 hover:shadow-md"
      )}
      onClick={onClick}
    >
      {/* Header - fixed height */}
      <div className={cn(
        "px-4 py-2.5 border-b border-border/50 bg-gradient-to-r shrink-0",
        config.bgColor
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm tracking-tight">{config.label}</h3>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", config.badgeColor)}>
              sonnet-4
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {state?.signalsPublished !== undefined && state.signalsPublished > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                {state.signalsPublished}
              </Badge>
            )}
            <div className="flex items-center gap-1.5">
              <div className={cn(
                "w-2 h-2 rounded-full",
                statusConfig.dot,
                statusConfig.animate && "animate-pulse"
              )} />
              <span className="text-[10px] text-muted-foreground">{statusConfig.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content - fills remaining space with scroll */}
      <CardContent className="p-3 flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Current analysis target */}
        {state?.currentSymbol && status === "analyzing" && (
          <div className="flex items-center gap-2 text-xs mb-2 shrink-0">
            <span className="text-muted-foreground">Analyzing</span>
            <Badge variant="outline" className="font-medium text-[10px]">
              {state.currentSymbol}
            </Badge>
          </div>
        )}

        {/* Streaming output - scrollable area */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {displayText ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {displayText}
              {status === "analyzing" && (
                <span className="inline-block w-1 h-3.5 ml-0.5 bg-blue-400 animate-pulse align-middle" />
              )}
            </p>
          ) : status === "idle" ? (
            <p className="text-sm text-muted-foreground/60 italic">
              Waiting to start...
            </p>
          ) : status === "analyzing" && !displayText ? (
            <p className="text-sm text-muted-foreground/60 italic">
              Starting analysis...
            </p>
          ) : null}

          {/* Error state */}
          {state?.error && (
            <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 mt-2">
              <p className="text-xs text-red-400">{state.error}</p>
            </div>
          )}

          {/* Last message when done */}
          {status === "done" && state?.lastMessage && !displayText && (
            <p className="text-sm text-muted-foreground">{state.lastMessage}</p>
          )}
        </div>

        {/* Footer - fixed at bottom */}
        {state?.lastActivity && (
          <div className="pt-2 mt-auto border-t border-border/30 shrink-0">
            <span className="text-[10px] text-muted-foreground/50">
              {new Date(state.lastActivity).toLocaleTimeString()}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SpecialistPanel;

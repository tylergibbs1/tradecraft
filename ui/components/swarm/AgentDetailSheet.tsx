"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { SpecialistUIState, AgentRole } from "./SpecialistPanel";

const ROLE_CONFIG: Record<AgentRole, { label: string; description: string; color: string; badgeColor: string }> = {
  "portfolio-manager": {
    label: "Portfolio Manager",
    description: "Coordinates trading decisions and manages overall portfolio allocation based on signals from other specialists.",
    color: "text-purple-400",
    badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  },
  "fundamental-analyst": {
    label: "Fundamental Analyst",
    description: "Analyzes company financials, earnings, valuations, and business fundamentals to assess intrinsic value.",
    color: "text-blue-400",
    badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  },
  "technical-analyst": {
    label: "Technical Analyst",
    description: "Studies price patterns, trends, volume, and technical indicators to identify trading opportunities.",
    color: "text-fuchsia-400",
    badgeColor: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
  },
  "sentiment-analyst": {
    label: "Sentiment Analyst",
    description: "Monitors news, social media, and market sentiment to gauge investor psychology and market mood.",
    color: "text-cyan-400",
    badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  },
  "macro-analyst": {
    label: "Macro Analyst",
    description: "Evaluates macroeconomic conditions, interest rates, and sector trends that affect market direction.",
    color: "text-amber-400",
    badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
  "earnings-analyst": {
    label: "Earnings Analyst",
    description: "Specializes in earnings reports, guidance, and estimate revisions to predict stock reactions.",
    color: "text-orange-400",
    badgeColor: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  },
  "catalyst-analyst": {
    label: "Catalyst Analyst",
    description: "Identifies upcoming events and catalysts that could trigger significant price movements.",
    color: "text-green-400",
    badgeColor: "bg-green-500/20 text-green-300 border-green-500/30",
  },
  "hypothesis-generator": {
    label: "Hypothesis Generator",
    description: "Generates and tests trading hypotheses based on cross-signal analysis and pattern recognition.",
    color: "text-pink-400",
    badgeColor: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idle: { label: "Idle", color: "text-zinc-400" },
  analyzing: { label: "Analyzing", color: "text-blue-400" },
  publishing: { label: "Publishing Signals", color: "text-amber-400" },
  done: { label: "Completed", color: "text-emerald-400" },
  error: { label: "Error", color: "text-red-400" },
};

interface AgentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state?: SpecialistUIState;
  role: AgentRole;
}

export function AgentDetailSheet({ open, onOpenChange, state, role }: AgentDetailSheetProps) {
  const config = ROLE_CONFIG[role];
  const status = state?.status || "idle";
  const statusConfig = STATUS_CONFIG[status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <SheetTitle className={cn("text-xl", config.color)}>
              {config.label}
            </SheetTitle>
            <Badge variant="outline" className={cn("text-xs", config.badgeColor)}>
              sonnet-4
            </Badge>
          </div>
          <SheetDescription className="text-sm">
            {config.description}
          </SheetDescription>
        </SheetHeader>

        <Separator className="my-4" />

        {/* Status Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Status</h3>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                status === "analyzing" && "bg-blue-500 animate-pulse",
                status === "publishing" && "bg-amber-500 animate-pulse",
                status === "done" && "bg-emerald-500",
                status === "error" && "bg-red-500",
                status === "idle" && "bg-zinc-500"
              )} />
              <span className={cn("font-medium", statusConfig.color)}>
                {statusConfig.label}
              </span>
              {state?.currentSymbol && status === "analyzing" && (
                <Badge variant="outline" className="ml-2 text-xs">
                  {state.currentSymbol}
                </Badge>
              )}
            </div>
          </div>

          {/* Signals Published */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Signals Published</h3>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-emerald-400">
                {state?.signalsPublished ?? 0}
              </span>
              <span className="text-sm text-muted-foreground">this cycle</span>
            </div>
          </div>

          {/* Last Activity */}
          {state?.lastActivity && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Last Activity</h3>
              <span className="text-sm">
                {new Date(state.lastActivity).toLocaleString()}
              </span>
            </div>
          )}

          {/* Error */}
          {state?.error && (
            <div>
              <h3 className="text-sm font-medium text-red-400 mb-2">Error</h3>
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-300">{state.error}</p>
              </div>
            </div>
          )}

          <Separator className="my-4" />

          {/* Full Analysis Output */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Analysis Output</h3>
            <div className="bg-muted/30 rounded-lg p-4 max-h-[400px] overflow-y-auto">
              {state?.streamingText ? (
                <div className="space-y-2">
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {state.streamingText}
                    {status === "analyzing" && (
                      <span className="inline-block w-1.5 h-4 ml-1 bg-blue-400 animate-pulse align-middle" />
                    )}
                  </p>
                </div>
              ) : status === "idle" ? (
                <p className="text-sm text-muted-foreground italic">
                  Waiting for cycle to start...
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No output yet...
                </p>
              )}
            </div>
          </div>

          {/* Last Message */}
          {state?.lastMessage && status === "done" && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Summary</h3>
              <p className="text-sm text-foreground/80">{state.lastMessage}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default AgentDetailSheet;

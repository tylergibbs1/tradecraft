"use client";

import { memo, type ComponentProps } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  BotIcon,
  ChevronDown,
  ActivityIcon,
  SignalIcon,
  WrenchIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
  CircleDotIcon,
} from "lucide-react";
import type { SpecialistUIState, AgentRole } from "./SpecialistPanel";

// Role configurations
const ROLE_CONFIG: Record<AgentRole, { label: string; description: string; color: string; borderColor: string }> = {
  "portfolio-manager": {
    label: "Portfolio Manager",
    description: "Coordinates trading decisions and manages overall portfolio allocation based on signals from specialists.",
    color: "text-purple-400",
    borderColor: "border-l-purple-500",
  },
  "fundamental-analyst": {
    label: "Fundamental Analyst",
    description: "Analyzes company financials, earnings, valuations, and business fundamentals to assess intrinsic value.",
    color: "text-blue-400",
    borderColor: "border-l-blue-500",
  },
  "technical-analyst": {
    label: "Technical Analyst",
    description: "Studies price patterns, trends, volume, and technical indicators to identify trading opportunities.",
    color: "text-fuchsia-400",
    borderColor: "border-l-fuchsia-500",
  },
  "sentiment-analyst": {
    label: "Sentiment Analyst",
    description: "Monitors news, social media, and market sentiment to gauge investor psychology and market mood.",
    color: "text-cyan-400",
    borderColor: "border-l-cyan-500",
  },
  "macro-analyst": {
    label: "Macro Analyst",
    description: "Evaluates macroeconomic conditions, interest rates, and sector trends affecting market direction.",
    color: "text-amber-400",
    borderColor: "border-l-amber-500",
  },
  "earnings-analyst": {
    label: "Earnings Analyst",
    description: "Specializes in earnings reports, guidance, and estimate revisions to predict stock reactions.",
    color: "text-orange-400",
    borderColor: "border-l-orange-500",
  },
  "catalyst-analyst": {
    label: "Catalyst Analyst",
    description: "Identifies upcoming events and catalysts that could trigger significant price movements.",
    color: "text-green-400",
    borderColor: "border-l-green-500",
  },
  "hypothesis-generator": {
    label: "Hypothesis Generator",
    description: "Generates and tests trading hypotheses based on cross-signal analysis and pattern recognition.",
    color: "text-pink-400",
    borderColor: "border-l-pink-500",
  },
};

// Status badge component
function StatusBadge({ status }: { status: SpecialistUIState["status"] }) {
  const config = {
    idle: { label: "Idle", icon: CircleDotIcon, className: "bg-zinc-500/20 text-zinc-400" },
    analyzing: { label: "Analyzing", icon: Loader2Icon, className: "bg-blue-500/20 text-blue-400" },
    publishing: { label: "Publishing", icon: SignalIcon, className: "bg-amber-500/20 text-amber-400" },
    done: { label: "Completed", icon: CheckCircle2Icon, className: "bg-emerald-500/20 text-emerald-400" },
    error: { label: "Error", icon: AlertCircleIcon, className: "bg-red-500/20 text-red-400" },
  }[status];

  const Icon = config.icon;

  return (
    <Badge variant="secondary" className={cn("gap-1 text-xs", config.className)}>
      <Icon className={cn("size-3", status === "analyzing" && "animate-spin")} />
      {config.label}
    </Badge>
  );
}

// Main Specialist Agent component
export type SpecialistAgentProps = ComponentProps<"div"> & {
  role: AgentRole;
  state?: SpecialistUIState;
  activeTools?: Array<{ toolName: string; startedAt: string }>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const SpecialistAgent = memo(({
  className,
  role,
  state,
  activeTools = [],
  defaultOpen = false,
  onOpenChange,
  ...props
}: SpecialistAgentProps) => {
  const config = ROLE_CONFIG[role];
  const status = state?.status || "idle";
  const isActive = status === "analyzing" || status === "publishing";

  return (
    <Collapsible defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "not-prose w-full rounded-md border border-l-2 transition-all",
          config.borderColor,
          isActive && "ring-1 ring-blue-500/20 shadow-md",
          className
        )}
        {...props}
      >
        {/* Header - Always visible */}
        <CollapsibleTrigger asChild>
          <div className="flex w-full cursor-pointer items-center justify-between gap-4 p-3 hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2">
              <BotIcon className={cn("size-4", config.color)} />
              <span className={cn("font-medium text-sm", config.color)}>{config.label}</span>
              <Badge className="font-mono text-[10px]" variant="secondary">
                claude-sonnet-4
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {state?.currentSymbol && isActive && (
                <Badge variant="outline" className="text-xs">
                  {state.currentSymbol}
                </Badge>
              )}
              {(state?.signalsPublished ?? 0) > 0 && (
                <Badge variant="secondary" className="gap-1 text-xs bg-emerald-500/20 text-emerald-400">
                  <SignalIcon className="size-3" />
                  {state?.signalsPublished}
                </Badge>
              )}
              <StatusBadge status={status} />
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Collapsible Content */}
        <CollapsibleContent>
          <div className="space-y-3 border-t p-3">
            {/* Instructions */}
            <div className="space-y-1.5">
              <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Role
              </span>
              <p className="text-sm text-muted-foreground">
                {config.description}
              </p>
            </div>

            {/* Active Tools */}
            {activeTools.length > 0 && (
              <div className="space-y-1.5">
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  Active Tools
                </span>
                <div className="space-y-1">
                  {activeTools.map((tool, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs"
                    >
                      <WrenchIcon className="size-3 text-blue-400 animate-pulse" />
                      <span className="font-mono">{tool.toolName}</span>
                      <span className="text-muted-foreground ml-auto">
                        {new Date(tool.startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Streaming Output */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  Output
                </span>
                {state?.lastActivity && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(state.lastActivity).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div className={cn(
                "rounded-md bg-muted/30 p-3 min-h-[80px] max-h-[200px] overflow-y-auto font-mono text-xs",
                isActive && "ring-1 ring-blue-500/10"
              )}>
                {state?.streamingText ? (
                  <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {state.streamingText}
                    {status === "analyzing" && (
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-blue-400 animate-pulse align-middle" />
                    )}
                  </p>
                ) : status === "idle" ? (
                  <p className="text-muted-foreground/60 italic">
                    Waiting for cycle to start...
                  </p>
                ) : (
                  <p className="text-muted-foreground/60 italic">
                    Starting analysis...
                  </p>
                )}
              </div>
            </div>

            {/* Error display */}
            {state?.error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircleIcon className="size-4" />
                  <span>{state.error}</span>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

SpecialistAgent.displayName = "SpecialistAgent";

export default SpecialistAgent;

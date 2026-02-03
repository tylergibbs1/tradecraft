"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SpecialistUIState, AgentRole } from "./SpecialistPanel";

const ROLE_CONFIG: Record<AgentRole, { label: string; color: string; bgColor: string }> = {
  "portfolio-manager": {
    label: "Portfolio Manager",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/30",
  },
  "fundamental-analyst": {
    label: "Fundamental",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/30",
  },
  "technical-analyst": {
    label: "Technical",
    color: "text-fuchsia-400",
    bgColor: "bg-fuchsia-500/10 border-fuchsia-500/30",
  },
  "sentiment-analyst": {
    label: "Sentiment",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10 border-cyan-500/30",
  },
  "macro-analyst": {
    label: "Macro",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/30",
  },
  "earnings-analyst": {
    label: "Earnings",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10 border-orange-500/30",
  },
  "catalyst-analyst": {
    label: "Catalyst",
    color: "text-green-400",
    bgColor: "bg-green-500/10 border-green-500/30",
  },
  "hypothesis-generator": {
    label: "Hypothesis",
    color: "text-pink-400",
    bgColor: "bg-pink-500/10 border-pink-500/30",
  },
};

interface LiveFeedPanelProps {
  specialists: Record<string, SpecialistUIState>;
}

export function LiveFeedPanel({ specialists }: LiveFeedPanelProps) {
  // Find the currently active (analyzing) specialist, or the most recently active one
  const activeSpecialist = useMemo(() => {
    const specialistList = Object.values(specialists);

    // First priority: currently analyzing
    const analyzing = specialistList.find(s => s.status === "analyzing");
    if (analyzing) return analyzing;

    // Second priority: publishing
    const publishing = specialistList.find(s => s.status === "publishing");
    if (publishing) return publishing;

    // Third priority: most recently active (by lastActivity timestamp)
    const sorted = specialistList
      .filter(s => s.streamingText)
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    return sorted[0] || null;
  }, [specialists]);

  const config = activeSpecialist ? ROLE_CONFIG[activeSpecialist.role] : null;
  const isAnalyzing = activeSpecialist?.status === "analyzing";

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Live Feed</CardTitle>
            {activeSpecialist && config && (
              <Badge
                variant="outline"
                className={cn("text-xs", config.bgColor, config.color)}
              >
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full mr-1.5",
                  isAnalyzing ? "bg-current animate-pulse" : "bg-current opacity-50"
                )} />
                {config.label}
              </Badge>
            )}
            {activeSpecialist?.currentSymbol && isAnalyzing && (
              <Badge variant="outline" className="text-xs">
                {activeSpecialist.currentSymbol}
              </Badge>
            )}
          </div>
          {activeSpecialist?.lastActivity && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(activeSpecialist.lastActivity).toLocaleTimeString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className={cn(
          "bg-muted/30 rounded-lg p-4 min-h-[120px] max-h-[200px] overflow-y-auto font-mono text-sm",
          isAnalyzing && "ring-1 ring-blue-500/20"
        )}>
          {activeSpecialist?.streamingText ? (
            <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {activeSpecialist.streamingText}
              {isAnalyzing && (
                <span className="inline-block w-2 h-4 ml-1 bg-blue-400 animate-pulse align-middle" />
              )}
            </p>
          ) : (
            <p className="text-muted-foreground/60 italic">
              Waiting for agent activity...
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default LiveFeedPanel;

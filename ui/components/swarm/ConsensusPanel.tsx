"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ConsensusResult {
  symbol: string;
  weightedScore: number;
  signalCount: number;
  averageConfidence: number;
  recommendation: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  positionSizeMultiplier: number;
  dissent?: string[];
}

interface ConsensusPanelProps {
  consensusMap: Record<string, ConsensusResult>;
}

const RECOMMENDATION_COLORS: Record<string, string> = {
  STRONG_BUY: "bg-green-600",
  BUY: "bg-green-500",
  HOLD: "bg-gray-500",
  SELL: "bg-red-500",
  STRONG_SELL: "bg-red-600",
};

function ScoreBar({ score }: { score: number }) {
  // Score ranges from -2 (STRONG_SELL) to +2 (STRONG_BUY)
  // Convert to 0-100 percentage for display
  const percentage = ((score + 2) / 4) * 100;
  const isPositive = score > 0;
  const isNegative = score < 0;

  return (
    <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
      {/* Center line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600 z-10" />

      {/* Score bar */}
      <div
        className={cn(
          "absolute top-0 bottom-0 transition-all duration-300",
          isPositive ? "bg-green-500" : isNegative ? "bg-red-500" : "bg-gray-400"
        )}
        style={{
          left: isPositive ? "50%" : `${percentage}%`,
          width: isPositive ? `${percentage - 50}%` : `${50 - percentage}%`,
        }}
      />
    </div>
  );
}

export function ConsensusPanel({ consensusMap }: ConsensusPanelProps) {
  // Memoize sorted symbols to avoid re-sorting on every render
  const symbols = useMemo(
    () => Object.keys(consensusMap).sort(),
    [consensusMap]
  );

  // Memoize symbols with dissent to avoid double iteration
  const symbolsWithDissent = useMemo(
    () => symbols.filter((s) => consensusMap[s]?.dissent?.length),
    [symbols, consensusMap]
  );

  if (symbols.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Consensus Signals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-muted-foreground py-4">
            No consensus data yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Consensus Signals</CardTitle>
          <span className="text-xs text-muted-foreground">
            {symbols.length} symbols
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Header */}
        <div className="grid grid-cols-[60px_1fr_80px_60px_60px] gap-2 text-xs text-muted-foreground font-medium">
          <div>Symbol</div>
          <div className="text-center">Score (-2 to +2)</div>
          <div className="text-center">Action</div>
          <div className="text-center">Signals</div>
          <div className="text-center">Conf</div>
        </div>

        {/* Rows */}
        {symbols.map((symbol) => {
          const consensus = consensusMap[symbol];
          return (
            <div
              key={symbol}
              className="grid grid-cols-[60px_1fr_80px_60px_60px] gap-2 items-center py-1 border-b border-muted/30 last:border-0"
            >
              {/* Symbol */}
              <div className="font-mono font-medium text-sm">{symbol}</div>

              {/* Score bar */}
              <div className="flex items-center gap-2">
                <ScoreBar score={consensus.weightedScore} />
                <span
                  className={cn(
                    "text-xs font-mono w-10 text-right",
                    consensus.weightedScore > 0.5
                      ? "text-green-400"
                      : consensus.weightedScore < -0.5
                      ? "text-red-400"
                      : "text-muted-foreground"
                  )}
                >
                  {consensus.weightedScore >= 0 ? "+" : ""}
                  {consensus.weightedScore.toFixed(2)}
                </span>
              </div>

              {/* Recommendation badge */}
              <div className="flex justify-center">
                <Badge
                  className={cn(
                    "text-[10px] px-1.5",
                    RECOMMENDATION_COLORS[consensus.recommendation]
                  )}
                >
                  {consensus.recommendation.replace("_", " ")}
                </Badge>
              </div>

              {/* Signal count */}
              <div className="text-center text-xs">{consensus.signalCount}</div>

              {/* Confidence */}
              <div className="text-center text-xs">
                {(consensus.averageConfidence * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}

        {/* Dissent warnings - uses memoized symbolsWithDissent */}
        {symbolsWithDissent.length > 0 && (
          <div className="mt-2 pt-2 border-t border-muted/30">
            <div className="text-xs text-yellow-500 font-medium mb-1">
              Dissenting Views
            </div>
            {symbolsWithDissent.map((symbol) => (
              <div key={`${symbol}-dissent`} className="text-xs text-muted-foreground">
                <span className="font-mono">{symbol}</span>:{" "}
                {consensusMap[symbol].dissent?.join(", ")}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ConsensusPanel;

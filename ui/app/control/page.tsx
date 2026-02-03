"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { SwarmView, type SwarmUIState } from "@/components/swarm";

interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

interface Trade {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  value: number;
  pnl?: number;
  timestamp: string;
}

interface ControlState {
  portfolio: {
    cash: number;
    equity: number;
    positions: Record<string, Position>;
    dailyPnL: number;
    weeklyPnL: number;
    totalPnL: number;
    trades: Trade[];
  } | null;
  config: {
    initialCapital: number;
    symbols: string[];
    model: string;
    maxPositionSize: number;
    maxDailyLoss: number;
    maxDrawdown: number;
    cycleIntervalMs: number;
  } | null;
  swarm: {
    isRunning: boolean;
    state: {
      status: string;
      cycle: number;
      lastUpdate: string;
      isActive: boolean;
      specialists: string[];
      latestCycle?: {
        tokens: number;
        cost: number;
        consensus: { symbol: string; action: string; score: number }[];
      };
    } | null;
    output: string[];
  };
  risk: {
    circuitBreaker: {
      state: string;
      reason: string | null;
    };
  };
}

// Default empty swarm UI state
const defaultSwarmUIState: SwarmUIState = {
  cycleId: "",
  status: "idle",
  specialists: {},
  consensusMap: {},
  activeTools: {},
};

function formatCurrency(value: number): string {
  if (value === null || value === undefined || isNaN(value)) return "--";
  return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  if (value === null || value === undefined || isNaN(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return sign + (value * 100).toFixed(2) + "%";
}

// Consolidated swarm metrics to reduce re-renders
interface SwarmMetrics {
  cycleCount: number;
  tokens: number;
  cost: number;
}

const defaultSwarmMetrics: SwarmMetrics = {
  cycleCount: 0,
  tokens: 0,
  cost: 0,
};

export default function ControlCenter() {
  const [state, setState] = useState<ControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [swarmUIState, setSwarmUIState] = useState<SwarmUIState>(defaultSwarmUIState);
  const [swarmMetrics, setSwarmMetrics] = useState<SwarmMetrics>(defaultSwarmMetrics);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/control");
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } catch (e) {
      console.error("Failed to fetch state:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [fetchState]);

  // SSE for real-time swarm updates
  useEffect(() => {
    const eventSource = new EventSource("/api/swarm");

    eventSource.addEventListener("status", (event) => {
      try {
        const data = JSON.parse(event.data);

        // Update cycle metrics atomically (single state update instead of 3)
        setSwarmMetrics((prev) => ({
          cycleCount: data.cycleCount ?? prev.cycleCount,
          tokens: data.lastCycleResult?.tokens ?? prev.tokens,
          cost: data.lastCycleResult?.cost ?? prev.cost,
        }));

        // Update swarm UI state from SSE
        if (data.swarmState) {
          setSwarmUIState({
            cycleId: data.swarmState.cycleId || "",
            status: data.isRunning ? "running" : (data.swarmState.status || "idle"),
            startedAt: data.swarmState.startedAt,
            specialists: data.swarmState.specialists || {},
            consensusMap: data.swarmState.consensusMap || {},
            activeTools: data.swarmState.activeTools || {},
          });
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    });

    eventSource.onerror = () => {
      // Will auto-reconnect
    };

    return () => eventSource.close();
  }, []);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || "Action failed");
      }
      // Refresh state
      await fetchState();
    } catch (e) {
      console.error("Action failed:", e);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading control center...</div>
      </div>
    );
  }

  const positions = state?.portfolio?.positions
    ? Object.values(state.portfolio.positions)
    : [];

  const isSwarmActive = state?.swarm?.state?.isActive || state?.swarm?.isRunning;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Control Center</h1>
            <p className="text-muted-foreground">
              Manage your trading system
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/">
              <Button variant="outline">Dashboard</Button>
            </Link>
          </div>
        </div>

        {/* Main Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Swarm Control */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Swarm Control
                {isSwarmActive ? (
                  <Badge className="bg-green-600">Running</Badge>
                ) : (
                  <Badge variant="secondary">Stopped</Badge>
                )}
              </CardTitle>
              <CardDescription>Start and stop the multi-agent swarm</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  onClick={() => handleAction("start-swarm")}
                  disabled={isSwarmActive || actionLoading === "start-swarm"}
                  className="flex-1"
                >
                  {actionLoading === "start-swarm" ? "Starting..." : "Start Swarm"}
                </Button>
                <Button
                  onClick={() => handleAction("stop-swarm")}
                  disabled={!isSwarmActive || actionLoading === "stop-swarm"}
                  variant="destructive"
                  className="flex-1"
                >
                  {actionLoading === "stop-swarm" ? "Stopping..." : "Stop Swarm"}
                </Button>
              </div>
              <Button
                onClick={() => handleAction("run-single-cycle")}
                disabled={isSwarmActive || actionLoading === "run-single-cycle"}
                variant="outline"
                className="w-full"
              >
                {actionLoading === "run-single-cycle" ? "Running..." : "Run Single Cycle"}
              </Button>

              {state?.swarm?.state && (
                <div className="text-sm space-y-1 pt-2 border-t">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cycle:</span>
                    <span>{state.swarm.state.cycle}</span>
                  </div>
                  {state.swarm.state.latestCycle && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tokens:</span>
                        <span>{state.swarm.state.latestCycle.tokens?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cost:</span>
                        <span>${state.swarm.state.latestCycle.cost?.toFixed(4)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Risk Control */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Risk Control
                {state?.risk?.circuitBreaker?.state === "open" ? (
                  <Badge variant="destructive">Circuit Open</Badge>
                ) : (
                  <Badge className="bg-green-600">Normal</Badge>
                )}
              </CardTitle>
              <CardDescription>Monitor and manage risk limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {state?.risk?.circuitBreaker?.state === "open" && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-sm">
                  <div className="font-medium text-red-500">Circuit Breaker Triggered</div>
                  <div className="text-muted-foreground">{state.risk.circuitBreaker.reason}</div>
                </div>
              )}

              <Button
                onClick={() => handleAction("reset-circuit-breaker")}
                disabled={state?.risk?.circuitBreaker?.state !== "open" || actionLoading === "reset-circuit-breaker"}
                variant="outline"
                className="w-full"
              >
                Reset Circuit Breaker
              </Button>

              {state?.config && (
                <div className="text-sm space-y-1 pt-2 border-t">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Position:</span>
                    <span>{formatPercent(state.config.maxPositionSize)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Daily Loss:</span>
                    <span>{formatPercent(state.config.maxDailyLoss)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Drawdown:</span>
                    <span>{formatPercent(state.config.maxDrawdown)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Portfolio Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Portfolio</CardTitle>
              <CardDescription>Current holdings and P&L</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {state?.portfolio ? (
                <>
                  <div className="text-3xl font-bold">
                    {formatCurrency(state.portfolio.equity)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground">Cash</div>
                      <div>{formatCurrency(state.portfolio.cash)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Positions</div>
                      <div>{positions.length}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Daily P&L</div>
                      <div className={state.portfolio.dailyPnL >= 0 ? "text-green-500" : "text-red-500"}>
                        {formatCurrency(state.portfolio.dailyPnL)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total P&L</div>
                      <div className={state.portfolio.totalPnL >= 0 ? "text-green-500" : "text-red-500"}>
                        {formatCurrency(state.portfolio.totalPnL)}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">No portfolio data</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Consensus is now shown in SwarmView above */}

        {/* Positions */}
        {positions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Open Positions</CardTitle>
              <CardDescription>Current holdings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Symbol</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Avg Cost</th>
                      <th className="text-right py-2">Price</th>
                      <th className="text-right py-2">Value</th>
                      <th className="text-right py-2">P&L</th>
                      <th className="text-right py-2">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <tr key={pos.symbol} className="border-b">
                        <td className="py-2 font-mono font-medium">{pos.symbol}</td>
                        <td className="text-right py-2">{pos.quantity}</td>
                        <td className="text-right py-2">{formatCurrency(pos.averageCost)}</td>
                        <td className="text-right py-2">{formatCurrency(pos.currentPrice)}</td>
                        <td className="text-right py-2">{formatCurrency(pos.marketValue)}</td>
                        <td className={`text-right py-2 ${pos.unrealizedPnL >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatCurrency(pos.unrealizedPnL)}
                        </td>
                        <td className={`text-right py-2 ${pos.unrealizedPnLPercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {formatPercent(pos.unrealizedPnLPercent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Trades */}
        {state?.portfolio?.trades && state.portfolio.trades.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Trades</CardTitle>
              <CardDescription>Last 20 executed trades</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Time</th>
                      <th className="text-left py-2">Symbol</th>
                      <th className="text-left py-2">Side</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Price</th>
                      <th className="text-right py-2">Value</th>
                      <th className="text-right py-2">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.portfolio.trades.slice().reverse().map((trade) => (
                      <tr key={trade.id} className="border-b">
                        <td className="py-2 text-muted-foreground">
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2 font-mono">{trade.symbol}</td>
                        <td className="py-2">
                          <Badge
                            variant={trade.side === "buy" ? "default" : "destructive"}
                            className={trade.side === "buy" ? "bg-green-600" : ""}
                          >
                            {trade.side.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="text-right py-2">{trade.quantity}</td>
                        <td className="text-right py-2">{formatCurrency(trade.price)}</td>
                        <td className="text-right py-2">{formatCurrency(trade.value)}</td>
                        <td className={`text-right py-2 ${(trade.pnl || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {trade.pnl !== undefined ? formatCurrency(trade.pnl) : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Swarm View - Real-time agent visualization */}
        <SwarmView
          state={swarmUIState}
          cycleCount={swarmMetrics.cycleCount}
          tokensUsed={swarmMetrics.tokens}
          costUsd={swarmMetrics.cost}
        />

        {/* Configuration */}
        {state?.config && (
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Current trading system settings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Initial Capital</div>
                  <div className="font-medium">{formatCurrency(state.config.initialCapital)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Model</div>
                  <div className="font-medium font-mono text-xs">{state.config.model}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cycle Interval</div>
                  <div className="font-medium">{state.config.cycleIntervalMs / 1000}s</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Trading Universe</div>
                  <div className="font-medium">{state.config.symbols?.join(", ")}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>Auto-refreshes every 3 seconds | Last updated: {new Date().toLocaleTimeString()}</p>
        </div>
      </div>
    </div>
  );
}

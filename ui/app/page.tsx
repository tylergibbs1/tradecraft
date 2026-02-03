"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
} from "recharts";
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

interface PerformanceData {
  metrics: {
    currentEquity: number;
    initialCapital: number;
    totalReturn: number;
    annualizedReturn: number;
    dailyReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    volatility: number;
    winRate: number;
    alpha: number;
    tradeCount: number;
  };
  equityCurve: { date: string; equity: number; return: number }[];
  dailyReturns: number[];
  rollingSharpe: { date: string; sharpe: number }[];
  benchmarks: {
    spy: {
      totalReturn: number;
      annualizedReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      volatility: number;
      equityCurve: { date: string; equity: number; return: number }[];
    };
    hedgeFund: {
      totalReturn: number;
      annualizedReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      volatility: number;
      equityCurve: { date: string; equity: number; return: number }[];
    };
  };
}

interface AgentActivity {
  timestamp: string;
  swarm: {
    status: string;
    cycle: number;
    lastUpdate: string;
    specialists: string[];
    symbols: string[];
  } | null;
  latestCycle: {
    timestamp: string;
    cycle: number;
    tokens: number;
    cost: number;
    signals: { agent: string; count: number }[];
    consensus: { symbol: string; action: string; score: number }[];
  } | null;
}

function formatPercent(value: number, decimals = 2): string {
  if (value === null || value === undefined || isNaN(value)) return "--";
  const sign = value >= 0 ? "+" : "";
  return sign + (value * 100).toFixed(decimals) + "%";
}

function formatCurrency(value: number): string {
  if (value === null || value === undefined || isNaN(value)) return "--";
  return "$" + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MetricCard({
  title,
  value,
  comparison,
  positive,
}: {
  title: string;
  value: string;
  comparison?: string;
  positive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-bold truncate ${
            positive === true
              ? "text-green-500"
              : positive === false
              ? "text-red-500"
              : ""
          }`}
          title={value}
        >
          {value}
        </div>
        {comparison && (
          <p className="text-xs text-muted-foreground mt-1">{comparison}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/performance");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  // SSE for real-time agent activity
  useEffect(() => {
    const eventSource = new EventSource("/api/swarm");

    eventSource.addEventListener("status", (event) => {
      try {
        const status = JSON.parse(event.data);
        if (status.lastCycleResult) {
          const result = status.lastCycleResult;
          setAgentActivity({
            timestamp: result.timestamp,
            swarm: status.isRunning
              ? {
                  status: "running",
                  cycle: status.cycleCount,
                  lastUpdate: result.timestamp,
                  specialists: result.specialists || [],
                  symbols: result.consensus?.map((c: any) => c.symbol) || [],
                }
              : null,
            latestCycle: result.consensus
              ? {
                  timestamp: result.timestamp,
                  cycle: result.cycle,
                  tokens: result.tokens || 0,
                  cost: result.cost || 0,
                  signals: result.signals || [],
                  consensus: result.consensus || [],
                }
              : null,
          });

          // Add log entry for new cycles
          if (result.consensus && result.cycle) {
            const logEntry = `[Cycle ${result.cycle}] ${result.consensus
              .map((c: any) => `${c.symbol}: ${c.action} (${c.score?.toFixed(2) || "?"})`)
              .join(", ")}`;
            setAgentLogs((prev) => {
              if (prev[prev.length - 1]?.startsWith(`[Cycle ${result.cycle}]`)) return prev;
              return [...prev.slice(-19), logEntry];
            });
          }
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    });

    eventSource.onerror = () => {
      // Reconnect handled automatically by EventSource
    };

    return () => eventSource.close();
  }, []);


  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading performance data...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  // Prepare chart data
  const returnsChartData = data.equityCurve.map((d, i) => ({
    date: d.date.slice(5), // MM-DD format
    tradecraft: d.return * 100,
    spy: (data.benchmarks.spy.equityCurve[i]?.return || 0) * 100,
    hedgeFund: (data.benchmarks.hedgeFund.equityCurve[i]?.return || 0) * 100,
  }));

  // Daily returns histogram
  const bins = [-3, -2, -1, 0, 1, 2, 3];
  const histogramData = bins.slice(0, -1).map((bin, i) => {
    const count = data.dailyReturns.filter(
      (r) => r * 100 >= bin && r * 100 < bins[i + 1]
    ).length;
    return {
      range: `${bin}% to ${bins[i + 1]}%`,
      count,
      positive: bin >= 0,
    };
  });

  const vsMarket = data.metrics.totalReturn - data.benchmarks.spy.totalReturn;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Tradecraft Performance</h1>
            <p className="text-muted-foreground">
              Multi-agent trading system vs market benchmarks
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/control">
              <Button variant="default">Control Center</Button>
            </Link>
            <Button onClick={fetchData} variant="outline">
              Refresh
            </Button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard
            title="Total Return"
            value={formatPercent(data.metrics.totalReturn)}
            comparison={`vs S&P: ${formatPercent(vsMarket)}`}
            positive={data.metrics.totalReturn >= 0}
          />
          <MetricCard
            title="Sharpe Ratio"
            value={data.metrics.sharpeRatio.toFixed(2)}
            comparison="HF Avg: 1.0"
            positive={data.metrics.sharpeRatio > 1}
          />
          <MetricCard
            title="Max Drawdown"
            value={formatPercent(-Math.abs(data.metrics.maxDrawdown))}
            comparison={`S&P: ${formatPercent(-Math.abs(data.benchmarks.spy.maxDrawdown))}`}
            positive={data.metrics.maxDrawdown < data.benchmarks.spy.maxDrawdown}
          />
          <MetricCard
            title="Win Rate"
            value={formatPercent(data.metrics.winRate, 1)}
            comparison="HF Avg: 55%"
            positive={data.metrics.winRate > 0.55}
          />
          <MetricCard
            title="Current Equity"
            value={formatCurrency(data.metrics.currentEquity)}
            comparison={`${formatPercent(data.metrics.dailyReturn)} today`}
          />
          <MetricCard
            title="Alpha"
            value={formatPercent(data.metrics.alpha)}
            comparison="Excess return vs market"
            positive={data.metrics.alpha > 0}
          />
        </div>

        {/* Main Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Returns Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Cumulative Returns</CardTitle>
              <CardDescription>
                Tradecraft vs S&P 500 vs Hedge Fund Index
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={returnsChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                      dataKey="date"
                      stroke="#888"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#888"
                      fontSize={12}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => `${value.toFixed(2)}%`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="tradecraft"
                      name="Tradecraft"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="spy"
                      name="S&P 500"
                      stroke="#6b7280"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="hedgeFund"
                      name="Hedge Fund"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Comparison Table */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-muted-foreground">
                        Metric
                      </th>
                      <th className="text-right py-2 text-muted-foreground">TC</th>
                      <th className="text-right py-2 text-muted-foreground">SPY</th>
                      <th className="text-right py-2 text-muted-foreground">HF</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2">Return</td>
                      <td
                        className={`text-right ${
                          data.metrics.totalReturn >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {formatPercent(data.metrics.totalReturn)}
                      </td>
                      <td className="text-right">
                        {formatPercent(data.benchmarks.spy.totalReturn)}
                      </td>
                      <td className="text-right">
                        {formatPercent(data.benchmarks.hedgeFund.totalReturn)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Sharpe</td>
                      <td className="text-right">
                        {data.metrics.sharpeRatio.toFixed(2)}
                      </td>
                      <td className="text-right">
                        {data.benchmarks.spy.sharpeRatio.toFixed(2)}
                      </td>
                      <td className="text-right">
                        {data.benchmarks.hedgeFund.sharpeRatio.toFixed(2)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Max DD</td>
                      <td className="text-right text-red-500">
                        {formatPercent(-Math.abs(data.metrics.maxDrawdown))}
                      </td>
                      <td className="text-right">
                        {formatPercent(-Math.abs(data.benchmarks.spy.maxDrawdown))}
                      </td>
                      <td className="text-right">
                        {formatPercent(
                          -Math.abs(data.benchmarks.hedgeFund.maxDrawdown)
                        )}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Volatility</td>
                      <td className="text-right">
                        {formatPercent(data.metrics.volatility)}
                      </td>
                      <td className="text-right">
                        {formatPercent(data.benchmarks.spy.volatility)}
                      </td>
                      <td className="text-right">
                        {formatPercent(data.benchmarks.hedgeFund.volatility)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2">Trades</td>
                      <td className="text-right">{data.metrics.tradeCount}</td>
                      <td className="text-right">-</td>
                      <td className="text-right">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily Returns Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Returns Distribution</CardTitle>
              <CardDescription>Frequency of daily return ranges</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogramData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="range" stroke="#888" fontSize={10} />
                    <YAxis stroke="#888" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar dataKey="count" name="Days">
                      {histogramData.map((entry, index) => (
                        <Cell
                          key={index}
                          fill={entry.positive ? "#22c55e" : "#ef4444"}
                          fillOpacity={0.7}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Rolling Sharpe */}
          <Card>
            <CardHeader>
              <CardTitle>Rolling Sharpe Ratio (20-day)</CardTitle>
              <CardDescription>
                Risk-adjusted returns over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.rollingSharpe}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                      dataKey="date"
                      stroke="#888"
                      fontSize={10}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis stroke="#888" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => value.toFixed(2)}
                    />
                    <Area
                      type="monotone"
                      dataKey="sharpe"
                      name="Sharpe"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.2}
                    />
                    {/* Benchmark line at 1.0 */}
                    <Line
                      type="monotone"
                      dataKey={() => 1}
                      name="Benchmark"
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Agent Activity */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Agent Activity
                  {agentActivity?.swarm ? (
                    <Badge variant="default" className="bg-green-600">
                      Running
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Idle</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Real-time multi-agent swarm activity
                </CardDescription>
              </div>
              {agentActivity?.latestCycle && (
                <div className="text-right text-sm text-muted-foreground">
                  <div>Cycle {agentActivity.latestCycle.cycle}</div>
                  <div>
                    {agentActivity.latestCycle.tokens.toLocaleString()} tokens |{" "}
                    ${agentActivity.latestCycle.cost.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Consensus Signals */}
              <div>
                <h4 className="text-sm font-medium mb-2">Latest Consensus</h4>
                <div className="space-y-2">
                  {agentActivity?.latestCycle?.consensus.map((c) => (
                    <div
                      key={c.symbol}
                      className="flex items-center justify-between p-2 rounded bg-muted/50"
                    >
                      <span className="font-mono">{c.symbol}</span>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            c.action === "BUY"
                              ? "default"
                              : c.action === "SELL"
                              ? "destructive"
                              : "secondary"
                          }
                          className={
                            c.action === "BUY"
                              ? "bg-green-600"
                              : c.action === "SELL"
                              ? "bg-red-600"
                              : ""
                          }
                        >
                          {c.action}
                        </Badge>
                        <span
                          className={`text-sm ${
                            c.score > 0.5
                              ? "text-green-500"
                              : c.score < -0.5
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {c.score.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )) || (
                    <div className="text-muted-foreground text-sm">
                      No signals yet - run <code className="bg-muted px-1 rounded">bun run cli swarm</code> to start
                    </div>
                  )}
                </div>
              </div>

              {/* Agent Log */}
              <div>
                <h4 className="text-sm font-medium mb-2">Activity Log</h4>
                <div className="h-[200px] overflow-y-auto rounded bg-black/50 p-2 font-mono text-xs">
                  {agentLogs.length > 0 ? (
                    agentLogs.map((log, i) => (
                      <div key={i} className="text-green-400">
                        {log}
                      </div>
                    ))
                  ) : (
                    <div className="text-muted-foreground">
                      Waiting for agent activity...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>
            Auto-refreshes every 60 seconds | Last updated:{" "}
            {new Date().toLocaleTimeString()}
          </p>
        </div>
      </div>
    </div>
  );
}

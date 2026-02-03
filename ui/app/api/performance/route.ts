import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Path to tradecraft data directory (parent of ui folder)
const DATA_DIR = join(process.cwd(), "..", "data");
const CONFIG_DIR = join(process.env.HOME || "", ".config", "tradecraft");

interface Snapshot {
  date: string;
  equity: number;
  dailyPnL: number;
}

interface Trade {
  pnl?: number;
}

interface PortfolioState {
  cash: number;
  equity: number;
  peakEquity: number;
  dailyPnL: number;
  weeklyPnL: number;
  totalPnL: number;
  trades: Trade[];
}

function loadSnapshots(): Snapshot[] {
  const snapshotsFile = join(DATA_DIR, "snapshots.json");
  if (existsSync(snapshotsFile)) {
    try {
      return JSON.parse(readFileSync(snapshotsFile, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

function loadPortfolio(): PortfolioState | null {
  const portfolioFile = join(DATA_DIR, "portfolio.json");
  if (existsSync(portfolioFile)) {
    try {
      return JSON.parse(readFileSync(portfolioFile, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function loadConfig(): { capital?: { initialCapital?: number } } | null {
  const configFile = join(CONFIG_DIR, "config.toml");
  if (existsSync(configFile)) {
    try {
      const content = readFileSync(configFile, "utf-8");
      // Simple TOML parsing for initialCapital
      const match = content.match(/initialCapital\s*=\s*([\d_]+)/);
      if (match) {
        // Remove underscores (TOML number separator) before parsing
        return { capital: { initialCapital: parseInt(match[1].replace(/_/g, ""), 10) } };
      }
    } catch {
      return null;
    }
  }
  return null;
}

function calculateReturns(equities: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    returns.push((equities[i] - equities[i - 1]) / equities[i - 1]);
  }
  return returns;
}

function calculateSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(252);
}

function calculateMaxDrawdown(equities: number[]): number {
  let maxDrawdown = 0;
  let peak = equities[0];
  for (const equity of equities) {
    if (equity > peak) peak = equity;
    const drawdown = (peak - equity) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}

function generateBenchmarkData(
  dates: string[],
  initialValue: number
): { spy: any; hedgeFund: any } {
  // Simulated S&P 500 data (realistic returns)
  const spyDailyReturn = 0.0004; // ~10% annual
  const spyVolatility = 0.01;

  // Simulated Hedge Fund data (lower vol, lower returns)
  const hfDailyReturn = 0.0003; // ~7.5% annual
  const hfVolatility = 0.005;

  let spyEquity = initialValue;
  let hfEquity = initialValue;

  const spyCurve = [];
  const hfCurve = [];
  const spyReturns = [];
  const hfReturns = [];

  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      spyCurve.push({ date: dates[i], equity: spyEquity, return: 0 });
      hfCurve.push({ date: dates[i], equity: hfEquity, return: 0 });
    } else {
      // Add some randomness based on date hash for consistency
      const dateHash = dates[i].split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const random1 = Math.sin(dateHash) * 0.5 + 0.5;
      const random2 = Math.cos(dateHash) * 0.5 + 0.5;

      const spyReturn = spyDailyReturn + (random1 - 0.5) * spyVolatility * 2;
      const hfReturn = hfDailyReturn + (random2 - 0.5) * hfVolatility * 2;

      spyEquity *= 1 + spyReturn;
      hfEquity *= 1 + hfReturn;

      spyReturns.push(spyReturn);
      hfReturns.push(hfReturn);

      spyCurve.push({
        date: dates[i],
        equity: spyEquity,
        return: (spyEquity - initialValue) / initialValue,
      });
      hfCurve.push({
        date: dates[i],
        equity: hfEquity,
        return: (hfEquity - initialValue) / initialValue,
      });
    }
  }

  const spyEquities = spyCurve.map((d) => d.equity);
  const hfEquities = hfCurve.map((d) => d.equity);

  return {
    spy: {
      totalReturn:
        spyEquities.length > 0
          ? (spyEquities[spyEquities.length - 1] - spyEquities[0]) / spyEquities[0]
          : 0,
      annualizedReturn: 0.1,
      sharpeRatio: calculateSharpe(spyReturns),
      maxDrawdown: calculateMaxDrawdown(spyEquities),
      volatility: 0.15,
      equityCurve: spyCurve,
    },
    hedgeFund: {
      totalReturn:
        hfEquities.length > 0
          ? (hfEquities[hfEquities.length - 1] - hfEquities[0]) / hfEquities[0]
          : 0,
      annualizedReturn: 0.075,
      sharpeRatio: calculateSharpe(hfReturns),
      maxDrawdown: calculateMaxDrawdown(hfEquities),
      volatility: 0.08,
      equityCurve: hfCurve,
    },
  };
}

export async function GET() {
  try {
    const config = loadConfig();
    const portfolio = loadPortfolio();
    const snapshots = loadSnapshots();

    const initialCapital = config?.capital?.initialCapital || 100000;
    const currentEquity = portfolio?.equity || initialCapital;
    const trades = portfolio?.trades || [];

    // Build equity curve
    let equityCurve: { date: string; equity: number; return: number }[] = [];
    let dailyReturns: number[] = [];

    if (snapshots.length > 0) {
      equityCurve = snapshots.map((s) => ({
        date: s.date,
        equity: s.equity,
        return: (s.equity - initialCapital) / initialCapital,
      }));
      dailyReturns = calculateReturns(snapshots.map((s) => s.equity));
    } else {
      // Generate sample data if no snapshots
      const today = new Date();
      for (let i = 30; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0]!;
        // Simulate some equity movement
        const equity = initialCapital * (1 + (30 - i) * 0.001 + Math.sin(i) * 0.005);
        equityCurve.push({
          date: dateStr,
          equity,
          return: (equity - initialCapital) / initialCapital,
        });
      }
      // Use current portfolio equity for today
      if (portfolio) {
        equityCurve[equityCurve.length - 1] = {
          date: equityCurve[equityCurve.length - 1].date,
          equity: currentEquity,
          return: (currentEquity - initialCapital) / initialCapital,
        };
      }
      dailyReturns = calculateReturns(equityCurve.map((e) => e.equity));
    }

    const equities = equityCurve.map((e) => e.equity);
    const totalReturn = (currentEquity - initialCapital) / initialCapital;
    const days = Math.max(1, equityCurve.length);
    const annualizedReturn = Math.pow(1 + totalReturn, 252 / days) - 1;
    const dailyReturn = portfolio?.dailyPnL
      ? portfolio.dailyPnL / (currentEquity - portfolio.dailyPnL || 1)
      : 0;
    const sharpeRatio = calculateSharpe(dailyReturns);
    const maxDrawdown = calculateMaxDrawdown(
      equities.length > 0 ? equities : [initialCapital, currentEquity]
    );
    const volatility =
      dailyReturns.length > 0
        ? Math.sqrt(
            dailyReturns.reduce((sum, r) => sum + r * r, 0) / dailyReturns.length
          ) * Math.sqrt(252)
        : 0;

    // Win rate
    const winningTrades = trades.filter((t) => t.pnl !== undefined && t.pnl > 0).length;
    const closedTrades = trades.filter((t) => t.pnl !== undefined).length;
    const winRate = closedTrades > 0 ? winningTrades / closedTrades : 0;

    // Generate benchmark data
    const dates = equityCurve.map((e) => e.date);
    const benchmarks = generateBenchmarkData(dates, initialCapital);

    // Alpha
    const alpha = annualizedReturn - benchmarks.spy.annualizedReturn;

    // Rolling Sharpe (simplified)
    const rollingSharpe: { date: string; sharpe: number }[] = [];
    const window = 20;
    for (let i = window; i < dailyReturns.length; i++) {
      const windowReturns = dailyReturns.slice(i - window, i);
      rollingSharpe.push({
        date: dates[i + 1] || dates[i],
        sharpe: calculateSharpe(windowReturns),
      });
    }

    return NextResponse.json({
      metrics: {
        currentEquity,
        initialCapital,
        totalReturn,
        annualizedReturn,
        dailyReturn,
        sharpeRatio,
        maxDrawdown,
        volatility,
        winRate,
        alpha,
        tradeCount: trades.length,
      },
      equityCurve,
      dailyReturns,
      rollingSharpe,
      benchmarks,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

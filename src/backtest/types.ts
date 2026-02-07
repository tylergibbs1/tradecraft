export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols: string[];
  commission: number; // Per trade
  slippage: number; // Percentage
}

export interface BacktestTrade {
  timestamp: number;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  value: number;
  commission: number;
  pnl?: number;
}

export interface BacktestPosition {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
}

export interface BacktestSnapshot {
  timestamp: number;
  equity: number;
  cash: number;
  positions: BacktestPosition[];
}

export interface BacktestResult {
  config: BacktestConfig;
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownDate: string;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  tradingDays: number;
  trades: BacktestTrade[];
  equityCurve: BacktestSnapshot[];
  benchmarkComparison?: BenchmarkComparison;
}

export interface BenchmarkResult {
  name: string;
  annualizedReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  equityCurve?: { timestamp: number; equity: number }[];
}

export interface AlphaMetrics {
  alpha: number;
  trackingError: number;
  informationRatio: number;
}

export interface BenchmarkComparison {
  benchmarks: BenchmarkResult[];
  alphaVsBenchmarks: Record<string, AlphaMetrics>;
}

export type SignalType = "buy" | "sell" | "hold";

export interface Signal {
  symbol: string;
  type: SignalType;
  strength: number; // 0-1
  reason?: string;
}

export interface Strategy {
  name: string;
  description: string;
  generateSignals(
    symbol: string,
    history: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[],
    position: BacktestPosition | null,
  ): Signal;
}

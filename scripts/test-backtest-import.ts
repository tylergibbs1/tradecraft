import { AgentBacktestEngine, type AgentBacktestConfig } from "../src/backtest/agent-engine.js";
import { DataManager } from "../src/data/index.js";

// Smoke test: construct backtest engine without running it.
const dataManager = new DataManager("yahoo", undefined);

const cfg: AgentBacktestConfig = {
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-10"),
  initialCapital: 100000,
  symbols: ["AAPL", "MSFT"],
  model: "claude-sonnet-4-20250514",
  maxTurnsPerCycle: 3,
  allowShorts: false,
  riskLimits: {
    maxPositionSize: 0.1,
    maxPositionCount: 10,
    dailyLossLimit: 0.02,
    weeklyLossLimit: 0.05,
    maxDrawdown: 0.1,
    maxOrderValue: 10000,
  },
  cycleFrequency: 5,
};

const engine = new AgentBacktestEngine("test-key", dataManager, cfg);
console.log("AgentBacktestEngine constructed.");


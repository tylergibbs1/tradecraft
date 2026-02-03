import { NextRequest, NextResponse } from "next/server";
import { spawn, ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(process.cwd(), "..");
const DATA_DIR = join(ROOT_DIR, "data");
const CONFIG_DIR = join(process.env.HOME || "", ".config", "tradecraft");

// Global process reference for the swarm
let swarmProcess: ChildProcess | null = null;
let swarmOutput: string[] = [];

function loadPortfolio() {
  const file = join(DATA_DIR, "portfolio.json");
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function loadConfig() {
  const file = join(CONFIG_DIR, "config.toml");
  if (existsSync(file)) {
    try {
      const content = readFileSync(file, "utf-8");
      // Parse key config values
      const parseValue = (key: string) => {
        const match = content.match(new RegExp(`${key}\\s*=\\s*([\\d_]+|"[^"]*"|'[^']*'|\\[[^\\]]*\\])`));
        if (match) {
          let val = match[1];
          if (val.startsWith('"') || val.startsWith("'")) val = val.slice(1, -1);
          if (val.startsWith("[")) {
            return val.slice(1, -1).split(",").map(s => s.trim().replace(/['"]/g, ""));
          }
          return val.replace(/_/g, "");
        }
        return null;
      };

      return {
        initialCapital: parseInt(parseValue("initialCapital") || "100000", 10),
        symbols: parseValue("symbols") || ["AAPL", "GOOGL", "MSFT"],
        model: parseValue("model") || "claude-sonnet-4-5-20250929",
        maxPositionSize: parseFloat(parseValue("maxPositionSize") || "0.1"),
        maxDailyLoss: parseFloat(parseValue("maxDailyLoss") || "0.02"),
        maxDrawdown: parseFloat(parseValue("maxDrawdown") || "0.1"),
        cycleIntervalMs: parseInt(parseValue("cycleIntervalMs") || "60000", 10),
      };
    } catch {
      return null;
    }
  }
  return null;
}

function loadSwarmState() {
  const file = join(DATA_DIR, "swarm_state.json");
  if (existsSync(file)) {
    try {
      const state = JSON.parse(readFileSync(file, "utf-8"));
      // Check if swarm is still active (updated within last 2 minutes)
      const lastUpdate = new Date(state.lastUpdate).getTime();
      const isActive = Date.now() - lastUpdate < 120000;
      return { ...state, isActive };
    } catch {
      return null;
    }
  }
  return null;
}

function loadCircuitBreaker() {
  const file = join(DATA_DIR, "circuit_breaker.json");
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  }
  return { state: "closed", reason: null };
}

export async function GET() {
  const portfolio = loadPortfolio();
  const config = loadConfig();
  const swarmState = loadSwarmState();
  const circuitBreaker = loadCircuitBreaker();

  return NextResponse.json({
    portfolio: portfolio ? {
      cash: portfolio.cash,
      equity: portfolio.equity,
      positions: portfolio.positions,
      dailyPnL: portfolio.dailyPnL,
      weeklyPnL: portfolio.weeklyPnL,
      totalPnL: portfolio.totalPnL,
      trades: portfolio.trades?.slice(-20) || [],
    } : null,
    config,
    swarm: {
      isRunning: swarmProcess !== null && !swarmProcess.killed,
      state: swarmState,
      output: swarmOutput.slice(-50),
    },
    risk: {
      circuitBreaker,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, params } = body;

  switch (action) {
    case "start-swarm": {
      if (swarmProcess && !swarmProcess.killed) {
        return NextResponse.json({ success: false, error: "Swarm already running" });
      }

      swarmOutput = ["Starting swarm..."];
      swarmProcess = spawn("bun", ["run", "src/cli.ts", "swarm"], {
        cwd: ROOT_DIR,
        env: { ...process.env },
      });

      swarmProcess.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        swarmOutput.push(...lines);
        if (swarmOutput.length > 100) swarmOutput = swarmOutput.slice(-100);
      });

      swarmProcess.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        swarmOutput.push(...lines.map((l: string) => `[ERR] ${l}`));
      });

      swarmProcess.on("close", (code) => {
        swarmOutput.push(`Swarm exited with code ${code}`);
        swarmProcess = null;
      });

      return NextResponse.json({ success: true, message: "Swarm started" });
    }

    case "stop-swarm": {
      if (!swarmProcess || swarmProcess.killed) {
        return NextResponse.json({ success: false, error: "Swarm not running" });
      }

      swarmProcess.kill("SIGINT");
      swarmOutput.push("Stopping swarm...");
      return NextResponse.json({ success: true, message: "Swarm stopping" });
    }

    case "reset-circuit-breaker": {
      const file = join(DATA_DIR, "circuit_breaker.json");
      writeFileSync(file, JSON.stringify({ state: "closed", reason: null, triggeredAt: null }, null, 2));
      return NextResponse.json({ success: true, message: "Circuit breaker reset" });
    }

    case "run-single-cycle": {
      if (swarmProcess && !swarmProcess.killed) {
        return NextResponse.json({ success: false, error: "Swarm already running" });
      }

      const cycleProcess = spawn("bun", ["run", "src/cli.ts", "swarm-cycle"], {
        cwd: ROOT_DIR,
        env: { ...process.env },
      });

      let output = "";
      cycleProcess.stdout?.on("data", (data) => {
        output += data.toString();
      });
      cycleProcess.stderr?.on("data", (data) => {
        output += data.toString();
      });

      return new Promise((resolve) => {
        cycleProcess.on("close", () => {
          resolve(NextResponse.json({ success: true, output }));
        });
      });
    }

    default:
      return NextResponse.json({ success: false, error: "Unknown action" });
  }
}

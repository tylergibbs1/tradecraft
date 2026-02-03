import { NextRequest, NextResponse } from "next/server";
import { spawn, ChildProcess } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { swarmDbReader } from "@/lib/db";

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
      const parseValue = (key: string): string | string[] | null => {
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

      const parseString = (key: string, defaultVal: string): string => {
        const val = parseValue(key);
        return typeof val === "string" ? val : defaultVal;
      };

      const parseArray = (key: string, defaultVal: string[]): string[] => {
        const val = parseValue(key);
        return Array.isArray(val) ? val : defaultVal;
      };

      return {
        initialCapital: parseInt(parseString("initialCapital", "100000"), 10),
        symbols: parseArray("symbols", ["AAPL", "GOOGL", "MSFT"]),
        model: parseString("model", "claude-sonnet-4-5-20250929"),
        maxPositionSize: parseFloat(parseString("maxPositionSize", "0.1")),
        maxDailyLoss: parseFloat(parseString("maxDailyLoss", "0.02")),
        maxDrawdown: parseFloat(parseString("maxDrawdown", "0.1")),
        cycleIntervalMs: parseInt(parseString("cycleIntervalMs", "60000"), 10),
      };
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
  const circuitBreaker = loadCircuitBreaker();

  // Get swarm state from SQLite
  const dbState = swarmDbReader.getState();
  const isRunning = swarmDbReader.isRunning() || (swarmProcess !== null && !swarmProcess.killed);

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
      isRunning,
      state: dbState ? {
        status: dbState.status,
        cycle: dbState.cycle_number,
        cycleId: dbState.cycle_id,
        lastUpdate: dbState.updated_at,
        pid: dbState.pid,
      } : null,
      output: swarmOutput.slice(-50),
    },
    risk: {
      circuitBreaker,
    },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json();
  const { action } = body;

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
      // First try the in-memory process reference
      if (swarmProcess && !swarmProcess.killed) {
        swarmProcess.kill("SIGINT");
        swarmOutput.push("Stopping swarm...");
        return NextResponse.json({ success: true, message: "Swarm stopping" });
      }

      // Fallback: check SQLite for PID (handles server restarts)
      const pid = swarmDbReader.getPid();
      const isRunning = swarmDbReader.isRunning();
      if (pid && isRunning) {
        try {
          process.kill(pid, "SIGINT");
          swarmOutput.push("Stopping swarm via PID...");
          return NextResponse.json({ success: true, message: "Swarm stopping" });
        } catch {
          // Process might already be dead
          return NextResponse.json({ success: false, error: "Swarm process not found" });
        }
      }

      return NextResponse.json({ success: false, error: "Swarm not running" });
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

      return new Promise<Response>((resolve) => {
        cycleProcess.on("close", () => {
          resolve(NextResponse.json({ success: true, output }));
        });
      });
    }

    default:
      return NextResponse.json({ success: false, error: "Unknown action" });
  }
}

import { NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "..", "data");
const LOGS_DIR = join(process.cwd(), "..", "logs");

interface AgentCycle {
  timestamp: string;
  cycle: number;
  tokens: number;
  cost: number;
  signals: {
    agent: string;
    count: number;
  }[];
  consensus: {
    symbol: string;
    action: string;
    score: number;
  }[];
}

function getLatestAgentLog(): AgentCycle | null {
  const agentLogDir = join(LOGS_DIR, "agent");
  if (!existsSync(agentLogDir)) return null;

  try {
    // Find the most recent .jsonl file
    const files = readdirSync(agentLogDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().reverse();

    if (jsonlFiles.length === 0) return null;

    const latestFile = join(agentLogDir, jsonlFiles[0]);
    const content = readFileSync(latestFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    if (lines.length === 0) return null;

    // Parse the last line
    const lastLine = lines[lines.length - 1];
    return JSON.parse(lastLine);
  } catch {
    return null;
  }
}

interface SwarmState {
  status: string;
  cycle: number;
  lastUpdate: string;
  specialists: string[];
  latestCycle?: AgentCycle;
}

function getSwarmState(): SwarmState | null {
  const swarmFile = join(DATA_DIR, "swarm_state.json");
  if (existsSync(swarmFile)) {
    try {
      return JSON.parse(readFileSync(swarmFile, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendUpdate = () => {
        const swarmState = getSwarmState();
        const latestLog = getLatestAgentLog();

        const data = {
          timestamp: new Date().toISOString(),
          swarm: swarmState,
          latestCycle: latestLog,
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial data
      sendUpdate();

      // Poll for updates every 2 seconds
      const interval = setInterval(sendUpdate, 2000);

      // Clean up on close
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

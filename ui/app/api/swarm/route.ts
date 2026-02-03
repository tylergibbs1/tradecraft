import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "..", "data");

interface SpecialistState {
  agentId: string;
  role: string;
  status: "idle" | "analyzing" | "publishing" | "done" | "error";
  currentSymbol?: string;
  signalsPublished: number;
  lastMessage?: string;
  streamingText?: string;
  lastActivity: string;
  error?: string;
}

interface ActiveTool {
  agentId: string;
  toolName: string;
  startedAt: string;
}

interface ConsensusResult {
  symbol: string;
  weightedScore: number;
  signalCount: number;
  averageConfidence: number;
  recommendation: string;
  positionSizeMultiplier: number;
  dissent?: string[];
}

interface SwarmState {
  status: string;
  cycleId?: string;
  cycle: number;
  lastUpdate: string;
  specialists: string[] | Record<string, SpecialistState>;
  symbols: string[];
  activeTools?: Record<string, ActiveTool>;
  consensusMap?: Record<string, ConsensusResult>;
  latestCycle: {
    timestamp: string;
    cycle: number;
    tokens: number;
    cost: number;
    signals: { agent: string; count: number }[];
    consensus: { symbol: string; action: string; score: number }[];
  };
}

function loadSwarmState(): SwarmState | null {
  const stateFile = join(DATA_DIR, "swarm_state.json");
  if (existsSync(stateFile)) {
    try {
      return JSON.parse(readFileSync(stateFile, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let lastDataHash = "";

  const stream = new ReadableStream({
    start(controller) {
      const sendUpdate = () => {
        const state = loadSwarmState();

        const currentUpdateTime = state?.lastUpdate || "";
        const isRunning = state && Date.now() - new Date(state.lastUpdate).getTime() < 120000;

        // Quick hash to detect changes (using lastUpdate + streaming text lengths)
        const streamingLengths = state?.specialists
          ? Object.values(state.specialists as Record<string, SpecialistState>)
              .map(s => s.streamingText?.length || 0)
              .join(',')
          : '';
        const dataHash = `${currentUpdateTime}-${streamingLengths}`;

        // Skip if no changes
        if (dataHash === lastDataHash) return;
        lastDataHash = dataHash;

        // Build enhanced response with specialist states
        const specialistStates: Record<string, SpecialistState> = {};
        if (state?.specialists) {
          if (typeof state.specialists === "object" && !Array.isArray(state.specialists)) {
            // New format: already a record
            Object.assign(specialistStates, state.specialists);
          } else if (Array.isArray(state.specialists)) {
            // Old format: array of role names - convert to basic states
            for (const role of state.specialists) {
              const agentId = `swarm-pm-${role.replace("-analyst", "")}`;
              specialistStates[agentId] = {
                agentId,
                role,
                status: isRunning ? "analyzing" : "idle",
                signalsPublished: 0,
                lastActivity: state.lastUpdate,
              };
            }
          }
        }

        // Build consensus map from latestCycle.consensus
        const consensusMap: Record<string, ConsensusResult> = {};
        if (state?.consensusMap) {
          Object.assign(consensusMap, state.consensusMap);
        } else if (state?.latestCycle?.consensus) {
          for (const c of state.latestCycle.consensus) {
            consensusMap[c.symbol] = {
              symbol: c.symbol,
              weightedScore: c.score,
              signalCount: 1,
              averageConfidence: 0.7,
              recommendation: c.action,
              positionSizeMultiplier: Math.abs(c.score) / 2,
            };
          }
        }

        const cycleCount = state?.cycle || 0;
        const response = {
          isRunning,
          cycleCount,
          cycleId: state?.cycleId || `cycle-${cycleCount}`,
          swarmState: {
            cycleId: state?.cycleId || `cycle-${cycleCount}`,
            status: isRunning ? "running" : (state?.status || "idle"),
            startedAt: state?.lastUpdate,
            specialists: specialistStates,
            consensusMap,
            activeTools: state?.activeTools || {},
          },
          lastCycleResult: state?.latestCycle
            ? {
                ...state.latestCycle,
                specialists: Array.isArray(state.specialists) ? state.specialists : Object.keys(state.specialists),
              }
            : null,
        };

        controller.enqueue(
          encoder.encode(`event: status\ndata: ${JSON.stringify(response)}\n\n`)
        );
      };

      // Send initial data
      sendUpdate();

      // Poll for updates every 100ms for real-time streaming
      const interval = setInterval(sendUpdate, 100);

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

import { NextRequest } from "next/server";
import { swarmDbReader } from "@/lib/db";

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let lastDataHash = "";

  const stream = new ReadableStream({
    start(controller) {
      const sendUpdate = () => {
        const snapshot = swarmDbReader.getSnapshot();
        const { state, specialists, activeTools, consensus, latestCycle } = snapshot;

        // Quick hash to detect changes
        const streamingLengths = specialists
          .map(s => s.streaming_text?.length || 0)
          .join(',');
        const dataHash = `${state?.updated_at || ''}-${streamingLengths}-${activeTools.length}`;

        // Skip if no changes
        if (dataHash === lastDataHash) return;
        lastDataHash = dataHash;

        const isRunning = state?.status === "running" &&
          state?.updated_at &&
          Date.now() - new Date(state.updated_at).getTime() < 120000;

        // Build specialist states map
        const specialistStates: Record<string, {
          agentId: string;
          role: string;
          status: string;
          currentSymbol?: string;
          signalsPublished: number;
          lastMessage?: string;
          streamingText?: string;
          lastActivity: string;
          error?: string;
        }> = {};

        for (const s of specialists) {
          specialistStates[s.agent_id] = {
            agentId: s.agent_id,
            role: s.role,
            status: s.status,
            currentSymbol: s.current_symbol || undefined,
            signalsPublished: s.signals_published,
            lastMessage: s.last_message || undefined,
            streamingText: s.streaming_text || undefined,
            lastActivity: s.last_activity,
            error: s.error || undefined,
          };
        }

        // Build active tools map
        const activeToolsMap: Record<string, {
          agentId: string;
          toolName: string;
          startedAt: string;
        }> = {};

        for (const t of activeTools) {
          const key = `${t.agent_id}-${t.tool_name}`;
          activeToolsMap[key] = {
            agentId: t.agent_id,
            toolName: t.tool_name,
            startedAt: t.started_at,
          };
        }

        // Build consensus map
        const consensusMap: Record<string, {
          symbol: string;
          weightedScore: number;
          signalCount: number;
          averageConfidence: number;
          recommendation: string;
          positionSizeMultiplier: number;
          dissent?: string[];
        }> = {};

        for (const c of consensus) {
          consensusMap[c.symbol] = {
            symbol: c.symbol,
            weightedScore: c.weighted_score,
            signalCount: c.signal_count,
            averageConfidence: c.average_confidence || 0.7,
            recommendation: c.recommendation,
            positionSizeMultiplier: c.position_size_multiplier || 1,
            dissent: c.dissent ? JSON.parse(c.dissent) : undefined,
          };
        }

        const cycleCount = state?.cycle_number || 0;
        const response = {
          isRunning,
          cycleCount,
          cycleId: state?.cycle_id || `cycle-${cycleCount}`,
          swarmState: {
            cycleId: state?.cycle_id || `cycle-${cycleCount}`,
            status: isRunning ? "running" : (state?.status || "idle"),
            startedAt: state?.updated_at,
            specialists: specialistStates,
            consensusMap,
            activeTools: activeToolsMap,
          },
          lastCycleResult: latestCycle
            ? {
                timestamp: latestCycle.completed_at,
                cycle: latestCycle.cycle_number,
                tokens: latestCycle.tokens_used,
                cost: latestCycle.cost_usd,
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

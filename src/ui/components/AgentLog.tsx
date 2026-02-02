import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { AgentMessage, AgentCycleResult } from "../../agent/types.js";

interface AgentLogProps {
  messages: AgentMessage[];
  cycleResults: AgentCycleResult[];
  maxMessages?: number;
}

type ViewMode = "messages" | "cycles";

const MESSAGE_COLORS: Record<AgentMessage["type"], string> = {
  system: "gray",
  user: "blue",
  assistant: "green",
  tool_use: "yellow",
  tool_result: "cyan",
  error: "red",
};

const MESSAGE_PREFIXES: Record<AgentMessage["type"], string> = {
  system: "SYS",
  user: "USR",
  assistant: "AGT",
  tool_use: "TUL",
  tool_result: "RES",
  error: "ERR",
};

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString();
}

export function AgentLog({
  messages,
  cycleResults,
  maxMessages = 50,
}: AgentLogProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("messages");
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);

  const displayMessages = messages.slice(-maxMessages);
  const maxScroll = Math.max(0, displayMessages.length - 15);

  useInput((input, key) => {
    if (input === "m") {
      setViewMode("messages");
    } else if (input === "c") {
      setViewMode("cycles");
    } else if (input === "a") {
      setAutoScroll(!autoScroll);
    } else if (key.upArrow && !autoScroll) {
      setScrollOffset(Math.min(maxScroll, scrollOffset + 1));
    } else if (key.downArrow && !autoScroll) {
      setScrollOffset(Math.max(0, scrollOffset - 1));
    }
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(0);
    }
  }, [messages.length, autoScroll]);

  return (
    <Box flexDirection="column">
      {/* View Toggle */}
      <Box marginBottom={1}>
        <Text
          color={viewMode === "messages" ? "cyan" : "gray"}
          bold={viewMode === "messages"}
        >
          [m] Messages
        </Text>
        <Text> │ </Text>
        <Text
          color={viewMode === "cycles" ? "cyan" : "gray"}
          bold={viewMode === "cycles"}
        >
          [c] Cycles ({cycleResults.length})
        </Text>
        <Text> │ </Text>
        <Text color={autoScroll ? "green" : "gray"}>
          [a] Auto-scroll: {autoScroll ? "ON" : "OFF"}
        </Text>
      </Box>

      {viewMode === "messages" ? (
        <MessagesView
          messages={displayMessages}
          scrollOffset={scrollOffset}
        />
      ) : (
        <CyclesView cycles={cycleResults} />
      )}
    </Box>
  );
}

function MessagesView({
  messages,
  scrollOffset,
}: {
  messages: AgentMessage[];
  scrollOffset: number;
}) {
  const visibleMessages = messages.slice(
    -(15 + scrollOffset),
    messages.length - scrollOffset || undefined
  );

  if (visibleMessages.length === 0) {
    return <Text color="gray">No messages yet</Text>;
  }

  return (
    <Box flexDirection="column">
      {visibleMessages.map((msg) => (
        <Box key={msg.id} flexWrap="wrap">
          <Text color="gray">{formatTime(msg.timestamp)} </Text>
          <Text color={MESSAGE_COLORS[msg.type]} bold>
            [{MESSAGE_PREFIXES[msg.type]}]
          </Text>
          <Text color={MESSAGE_COLORS[msg.type]}>
            {" "}
            {msg.content.length > 100
              ? msg.content.slice(0, 100) + "..."
              : msg.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function CyclesView({ cycles }: { cycles: AgentCycleResult[] }) {
  if (cycles.length === 0) {
    return <Text color="gray">No cycles completed yet</Text>;
  }

  const recentCycles = cycles.slice(-10).reverse();

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="gray">
          {"Cycle".padEnd(10)}
          {"Started".padEnd(12)}
          {"Duration".padEnd(10)}
          {"Turns".padStart(8)}
          {"Tokens".padStart(10)}
          {"Cost".padStart(8)}
          {"Orders".padStart(8)}
          {"Status".padEnd(10)}
        </Text>
      </Box>
      {/* Rows */}
      {recentCycles.map((cycle) => {
        const duration = cycle.completedAt
          ? (
              (new Date(cycle.completedAt).getTime() -
                new Date(cycle.startedAt).getTime()) /
              1000
            ).toFixed(1) + "s"
          : "...";

        return (
          <Box key={cycle.cycleId}>
            <Text>
              {cycle.cycleId.slice(0, 8).padEnd(10)}
              {formatTime(cycle.startedAt).padEnd(12)}
              {duration.padEnd(10)}
              {cycle.turnsUsed.toString().padStart(8)}
              {cycle.tokensUsed.toString().padStart(10)}
              {"$" + cycle.costUsd.toFixed(3).padStart(7)}
              {cycle.ordersPlaced.toString().padStart(8)}
            </Text>
            <Text color={cycle.error ? "red" : "green"}>
              {(cycle.error ? "ERROR" : "OK").padEnd(10)}
            </Text>
          </Box>
        );
      })}

      {/* Totals */}
      <Box marginTop={1}>
        <Text bold>
          Total: {cycles.length} cycles, $
          {cycles.reduce((sum, c) => sum + c.costUsd, 0).toFixed(2)} spent,{" "}
          {cycles.reduce((sum, c) => sum + c.ordersPlaced, 0)} orders
        </Text>
      </Box>
    </Box>
  );
}

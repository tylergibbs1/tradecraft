import React from "react";
import { Box, Text } from "ink";
import { AgentState } from "../../agent/types.js";

interface FooterProps {
  agentState: AgentState;
}

export function Footer({ agentState }: FooterProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="gray">
          ─────────────────────────────────────────────────────────────────
        </Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Box>
          {agentState === "running" && (
            <Text color="gray">[p] Pause </Text>
          )}
          {agentState === "paused" && (
            <Text color="gray">[r] Resume </Text>
          )}
          {agentState === "stopped" && (
            <Text color="gray">[r] Start </Text>
          )}
          {agentState !== "halted" && (
            <Text color="gray">[k] Kill </Text>
          )}
          {agentState === "halted" && (
            <Text color="red">[r] to reset halt </Text>
          )}
          <Text color="gray">[q] Quit</Text>
        </Box>
        <Box>
          <Text color="gray">
            {new Date().toLocaleTimeString()}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

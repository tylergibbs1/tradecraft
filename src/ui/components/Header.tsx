import { Box, Text } from "ink";
import type { AgentState } from "../../agent/types.js";

interface HeaderProps {
  agentState: AgentState;
  equity: number;
  dailyPnL: number;
  activeTab: number;
  agentMode?: "single" | "swarm";
}

const STATE_COLORS: Record<AgentState, string> = {
  running: "green",
  paused: "yellow",
  stopped: "gray",
  halted: "red",
};

const STATE_ICONS: Record<AgentState, string> = {
  running: "●",
  paused: "◐",
  stopped: "○",
  halted: "✕",
};

const TAB_NAMES = ["Portfolio", "Trades", "Journal", "Agent Log"];

export function Header({ agentState, equity, dailyPnL, activeTab, agentMode }: HeaderProps) {
  const pnlColor = dailyPnL >= 0 ? "green" : "red";
  const pnlSign = dailyPnL >= 0 ? "+" : "";
  const modeLabel = (agentMode ?? "single").toUpperCase();
  const modeColor = agentMode === "swarm" ? "magenta" : "blue";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            TRADECRAFT
          </Text>
          <Text color="gray"> │ </Text>
          <Text color={STATE_COLORS[agentState]}>
            {STATE_ICONS[agentState]} {agentState.toUpperCase()}
          </Text>
          <Text color="gray"> │ </Text>
          <Text color={modeColor}>{modeLabel}</Text>
        </Box>
        <Box>
          <Text>Equity: </Text>
          <Text bold>${equity.toLocaleString()}</Text>
          <Text color="gray"> │ </Text>
          <Text>Day: </Text>
          <Text color={pnlColor}>
            {pnlSign}${dailyPnL.toFixed(2)}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        {TAB_NAMES.map((name, i) => (
          <Box key={name} marginRight={2}>
            <Text color={i === activeTab ? "cyan" : "gray"} bold={i === activeTab}>
              [{i + 1}] {name}
            </Text>
          </Box>
        ))}
      </Box>
      <Box>
        <Text color="gray">─────────────────────────────────────────────────────────────────</Text>
      </Box>
    </Box>
  );
}

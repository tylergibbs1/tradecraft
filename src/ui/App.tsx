import { Box, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import { type AgentCycleResult, type AgentMessage, type AgentState, TradingAgent } from "../agent/index.js";
import { SwarmTradingAgent } from "../agent/swarm-adapter.js";
import type { ITradingAgent } from "../agent/types.js";
import type { Config } from "../config/index.js";
import { DataManager } from "../data/index.js";
import { PortfolioManager } from "../portfolio/manager.js";
import { RiskMonitor } from "../risk/monitor.js";
import { AgentLog } from "./components/AgentLog.js";
import { Footer } from "./components/Footer.js";
import { Header } from "./components/Header.js";
import { Journal } from "./components/Journal.js";
import { Portfolio } from "./components/Portfolio.js";
import { Trades } from "./components/Trades.js";

interface AppProps {
  config: Config;
}

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState(0);
  const [agentState, setAgentState] = useState<AgentState>("stopped");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [cycleResults, setCycleResults] = useState<AgentCycleResult[]>([]);
  const [portfolioState, setPortfolioState] = useState(() => {
    const pm = new PortfolioManager(config.capital.initialCapital);
    return pm.getState();
  });
  const [equityHistory, setEquityHistory] = useState<{ date: string; equity: number }[]>([]);

  // Initialize managers
  const [managers] = useState(() => {
    const portfolioManager = new PortfolioManager(config.capital.initialCapital);
    const riskMonitor = new RiskMonitor(config.riskLimits);
    const dataManager = new DataManager(config.dataProvider, config.dataProviderApiKey);

    return { portfolioManager, riskMonitor, dataManager };
  });

  // Initialize agent (mode-aware: single or swarm)
  const [agent] = useState<ITradingAgent>(() => {
    const callbacks = {
      onStateChange: (state: AgentState) => setAgentState(state),
      onMessage: (msg: AgentMessage) => setMessages((prev) => [...prev.slice(-100), msg]),
      onCycleComplete: (result: AgentCycleResult) => {
        setCycleResults((prev) => [...prev, result]);
        setPortfolioState(managers.portfolioManager.getState());
        setEquityHistory(managers.portfolioManager.getEquityHistory());
      },
    };

    const agentDeps = {
      config,
      portfolioManager: managers.portfolioManager,
      riskMonitor: managers.riskMonitor,
      dataManager: managers.dataManager,
    };

    if (config.agentMode === "swarm") {
      return new SwarmTradingAgent(agentDeps, callbacks);
    }
    return new TradingAgent(agentDeps, callbacks);
  });

  // Refresh portfolio periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setPortfolioState(managers.portfolioManager.getState());
    }, 5000);
    return () => clearInterval(interval);
  }, [managers.portfolioManager]);

  // Handle keyboard input
  useInput((input, _key) => {
    // Tab navigation
    if (input === "1") setActiveTab(0);
    else if (input === "2") setActiveTab(1);
    else if (input === "3") setActiveTab(2);
    else if (input === "4") setActiveTab(3);
    // Agent control
    else if (input === "p" && agentState === "running") {
      agent.pause();
    } else if (input === "r") {
      if (agentState === "paused") {
        agent.resume();
      } else if (agentState === "stopped" || agentState === "halted") {
        // Reset halt state and start
        agent.start();
      }
    } else if (input === "k" && agentState !== "halted") {
      agent.halt();
    } else if (input === "q") {
      agent.stop();
      exit();
    }
  });

  const renderTab = useCallback(() => {
    switch (activeTab) {
      case 0:
        return <Portfolio portfolio={portfolioState} equityHistory={equityHistory} />;
      case 1:
        return (
          <Trades
            openOrders={managers.portfolioManager.getOpenOrders()}
            recentTrades={managers.portfolioManager.getTrades(50)}
          />
        );
      case 2:
        return <Journal trades={managers.portfolioManager.getTrades()} />;
      case 3:
        return <AgentLog messages={messages} cycleResults={cycleResults} />;
      default:
        return null;
    }
  }, [activeTab, portfolioState, equityHistory, messages, cycleResults, managers.portfolioManager]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        agentState={agentState}
        equity={portfolioState.equity}
        dailyPnL={portfolioState.dailyPnL}
        activeTab={activeTab}
        agentMode={config.agentMode}
      />
      <Box flexGrow={1} minHeight={15}>
        {renderTab()}
      </Box>
      <Footer agentState={agentState} />
    </Box>
  );
}

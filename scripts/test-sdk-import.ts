import { SdkTradingAgent } from "../src/agent/sdk-trading-agent.js";
import { defaultConfig } from "../src/config/schema.js";
import { DataManager } from "../src/data/index.js";
import { PortfolioManager } from "../src/portfolio/manager.js";
import { RiskMonitor } from "../src/risk/monitor.js";

// Minimal construction smoke test: instantiate SDK agent without running cycles.
// This should not perform any network calls or file I/O beyond imports.

const config = {
  ...defaultConfig,
  anthropicApiKey: "test-key",
};

const portfolioManager = new PortfolioManager(config.capital.initialCapital);
const riskMonitor = new RiskMonitor(config.riskLimits);
const dataManager = new DataManager(config.dataProvider, config.dataProviderApiKey);

const agent = new SdkTradingAgent(
  { config, portfolioManager, riskMonitor, dataManager },
  {
    onMessage: (msg) => {
      if (msg.type === "error") {
        console.error("[ERR]", msg.content);
      }
    },
  },
);

console.log("SdkTradingAgent constructed. State:", agent.getState());

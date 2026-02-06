import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { type Config, type DataProvider, defaultConfig, getConfigPath, saveConfig } from "../config/index.js";
import { Confirm } from "./components/Confirm.js";
import { MaskedInput } from "./components/MaskedInput.js";
import { MultiInput } from "./components/MultiInput.js";
import { NumberInput } from "./components/NumberInput.js";
import { RadioSelect } from "./components/RadioSelect.js";
import { Slider } from "./components/Slider.js";

type SetupStep =
  | "welcome"
  | "dataProvider"
  | "dataProviderKey"
  | "anthropicKey"
  | "riskLimits"
  | "riskLimitsPositionCount"
  | "riskLimitsDailyLoss"
  | "riskLimitsWeeklyLoss"
  | "riskLimitsMaxDrawdown"
  | "riskLimitsMaxOrderValue"
  | "tradingUniverse"
  | "tradingUniverseShorts"
  | "agentModel"
  | "agentMaxTurns"
  | "agentBudget"
  | "capital"
  | "paperTrading"
  | "confirm"
  | "complete";

const STEPS: SetupStep[] = [
  "welcome",
  "dataProvider",
  "dataProviderKey",
  "anthropicKey",
  "riskLimits",
  "riskLimitsPositionCount",
  "riskLimitsDailyLoss",
  "riskLimitsWeeklyLoss",
  "riskLimitsMaxDrawdown",
  "riskLimitsMaxOrderValue",
  "tradingUniverse",
  "tradingUniverseShorts",
  "agentModel",
  "agentMaxTurns",
  "agentBudget",
  "capital",
  "paperTrading",
  "confirm",
  "complete",
];

export function SetupWizard() {
  const { exit } = useApp();
  const [step, setStep] = useState<SetupStep>("welcome");
  const [config, setConfig] = useState<Config>({ ...defaultConfig });

  const _currentStepIndex = STEPS.indexOf(step);
  const totalSteps = STEPS.length - 2; // Exclude welcome and complete

  const nextStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1]!);
    }
  };

  const updateConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
  };

  useInput((_input, key) => {
    if (key.escape) {
      exit();
    }
  });

  // Handle completion
  useEffect(() => {
    if (step === "complete") {
      saveConfig(config);
      setTimeout(() => exit(), 2000);
    }
  }, [step, config, exit]);

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <Box flexDirection="column">
            <Text color="cyan" bold>
              ╔════════════════════════════════════════╗
            </Text>
            <Text color="cyan" bold>
              ║ TRADECRAFT SETUP WIZARD ║
            </Text>
            <Text color="cyan" bold>
              ╚════════════════════════════════════════╝
            </Text>
            <Box marginTop={1}>
              <Text>Welcome! This wizard will help you configure your autonomous trading agent.</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="yellow">Press Enter to begin, Escape to exit at any time</Text>
            </Box>
            <WelcomeHandler onContinue={nextStep} />
          </Box>
        );

      case "dataProvider":
        return (
          <StepWrapper title="Data Provider" step={1} total={totalSteps}>
            <Text>Select your market data provider:</Text>
            <Box marginTop={1}>
              <RadioSelect
                options={[
                  {
                    label: "Yahoo Finance",
                    value: "yahoo" as DataProvider,
                    description: "Free, no API key required",
                  },
                  {
                    label: "Polygon.io",
                    value: "polygon" as DataProvider,
                    description: "Real-time data, API key required",
                  },
                  {
                    label: "Alpha Vantage",
                    value: "alphavantage" as DataProvider,
                    description: "Free tier available",
                  },
                ]}
                defaultValue={config.dataProvider}
                onSelect={(value) => {
                  updateConfig("dataProvider", value);
                  if (value === "yahoo") {
                    // Skip API key step for Yahoo
                    setStep("anthropicKey");
                  } else {
                    nextStep();
                  }
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "dataProviderKey":
        return (
          <StepWrapper title="Data Provider API Key" step={2} total={totalSteps}>
            <MaskedInput
              label={`Enter your ${config.dataProvider} API key`}
              masked
              onSubmit={(value) => {
                updateConfig("dataProviderApiKey", value);
                nextStep();
              }}
              validate={(v) => (v.length < 10 ? "API key seems too short" : null)}
            />
          </StepWrapper>
        );

      case "anthropicKey":
        return (
          <StepWrapper title="Anthropic API Key" step={3} total={totalSteps}>
            <Text color="gray">(Leave empty to use ANTHROPIC_API_KEY env var)</Text>
            <Box marginTop={1}>
              <MaskedInput
                label="Enter your Anthropic API key"
                masked
                placeholder="sk-ant-..."
                onSubmit={(value) => {
                  if (value) {
                    updateConfig("anthropicApiKey", value);
                  }
                  nextStep();
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "riskLimits":
        return (
          <StepWrapper title="Risk Limits - Position Size" step={4} total={totalSteps}>
            <Text>Maximum position size (% of portfolio):</Text>
            <Box marginTop={1}>
              <Slider
                label="Max Position Size"
                min={0.01}
                max={0.5}
                step={0.01}
                defaultValue={config.riskLimits.maxPositionSize}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onSubmit={(value) => {
                  updateConfig("riskLimits", {
                    ...config.riskLimits,
                    maxPositionSize: value,
                  });
                  nextStep();
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "riskLimitsPositionCount":
        return (
          <StepWrapper title="Risk Limits - Position Count" step={5} total={totalSteps}>
            <NumberInput
              label="Maximum number of simultaneous positions"
              defaultValue={config.riskLimits.maxPositionCount}
              min={1}
              max={100}
              onSubmit={(value) => {
                updateConfig("riskLimits", {
                  ...config.riskLimits,
                  maxPositionCount: Math.floor(value),
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "riskLimitsDailyLoss":
        return (
          <StepWrapper title="Risk Limits - Daily Loss" step={6} total={totalSteps}>
            <Text>Maximum daily loss limit (% of portfolio):</Text>
            <Box marginTop={1}>
              <Slider
                label="Daily Loss Limit"
                min={0.01}
                max={0.1}
                step={0.005}
                defaultValue={config.riskLimits.dailyLossLimit}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                onSubmit={(value) => {
                  updateConfig("riskLimits", {
                    ...config.riskLimits,
                    dailyLossLimit: value,
                  });
                  nextStep();
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "riskLimitsWeeklyLoss":
        return (
          <StepWrapper title="Risk Limits - Weekly Loss" step={7} total={totalSteps}>
            <Text>Maximum weekly loss limit (% of portfolio):</Text>
            <Box marginTop={1}>
              <Slider
                label="Weekly Loss Limit"
                min={0.02}
                max={0.2}
                step={0.01}
                defaultValue={config.riskLimits.weeklyLossLimit}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onSubmit={(value) => {
                  updateConfig("riskLimits", {
                    ...config.riskLimits,
                    weeklyLossLimit: value,
                  });
                  nextStep();
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "riskLimitsMaxDrawdown":
        return (
          <StepWrapper title="Risk Limits - Max Drawdown" step={8} total={totalSteps}>
            <Text>Maximum drawdown before circuit breaker triggers (% of portfolio):</Text>
            <Box marginTop={1}>
              <Slider
                label="Max Drawdown"
                min={0.05}
                max={0.3}
                step={0.01}
                defaultValue={config.riskLimits.maxDrawdown}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onSubmit={(value) => {
                  updateConfig("riskLimits", {
                    ...config.riskLimits,
                    maxDrawdown: value,
                  });
                  nextStep();
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "riskLimitsMaxOrderValue":
        return (
          <StepWrapper title="Risk Limits - Max Order Value" step={9} total={totalSteps}>
            <NumberInput
              label="Maximum single order value ($)"
              defaultValue={config.riskLimits.maxOrderValue}
              min={100}
              max={1000000}
              format={(v) => `$${v.toLocaleString()}`}
              onSubmit={(value) => {
                updateConfig("riskLimits", {
                  ...config.riskLimits,
                  maxOrderValue: value,
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "tradingUniverse":
        return (
          <StepWrapper title="Trading Universe" step={10} total={totalSteps}>
            <MultiInput
              label="Enter stock symbols to trade"
              defaultValues={config.tradingUniverse.symbols}
              onSubmit={(values) => {
                updateConfig("tradingUniverse", {
                  ...config.tradingUniverse,
                  symbols: values.map((s) => s.toUpperCase()),
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "tradingUniverseShorts":
        return (
          <StepWrapper title="Trading Universe - Short Selling" step={11} total={totalSteps}>
            <Confirm
              message="Allow short selling?"
              defaultValue={config.tradingUniverse.allowShorts}
              onConfirm={(value) => {
                updateConfig("tradingUniverse", {
                  ...config.tradingUniverse,
                  allowShorts: value,
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "agentModel":
        return (
          <StepWrapper title="Agent Parameters - Model" step={12} total={totalSteps}>
            <Text>Select the Claude model for trading decisions:</Text>
            <Box marginTop={1}>
              <RadioSelect
                options={[
                  {
                    label: "Claude Sonnet 4.5",
                    value: "claude-sonnet-4-5-20250929" as const,
                    description: "Latest, best performance",
                  },
                  {
                    label: "Claude Sonnet 4",
                    value: "claude-sonnet-4-20250514" as const,
                    description: "Balanced cost/performance",
                  },
                  {
                    label: "Claude 3.5 Sonnet",
                    value: "claude-3-5-sonnet-20241022" as const,
                    description: "Previous generation",
                  },
                ]}
                defaultValue={config.agentParams.model}
                onSelect={(value) => {
                  updateConfig("agentParams", {
                    ...config.agentParams,
                    model: value,
                  });
                  nextStep();
                }}
              />
            </Box>
          </StepWrapper>
        );

      case "agentMaxTurns":
        return (
          <StepWrapper title="Agent Parameters - Max Turns" step={13} total={totalSteps}>
            <NumberInput
              label="Maximum turns per trading cycle"
              defaultValue={config.agentParams.maxTurns}
              min={1}
              max={50}
              onSubmit={(value) => {
                updateConfig("agentParams", {
                  ...config.agentParams,
                  maxTurns: Math.floor(value),
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "agentBudget":
        return (
          <StepWrapper title="Agent Parameters - Budget" step={14} total={totalSteps}>
            <NumberInput
              label="Max API spend per cycle ($)"
              defaultValue={config.agentParams.maxBudgetUsd}
              min={0.1}
              max={10}
              format={(v) => `$${v.toFixed(2)}`}
              onSubmit={(value) => {
                updateConfig("agentParams", {
                  ...config.agentParams,
                  maxBudgetUsd: value,
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "capital":
        return (
          <StepWrapper title="Capital" step={15} total={totalSteps}>
            <NumberInput
              label="Initial trading capital ($)"
              defaultValue={config.capital.initialCapital}
              min={1000}
              max={100000000}
              format={(v) => `$${v.toLocaleString()}`}
              onSubmit={(value) => {
                updateConfig("capital", {
                  ...config.capital,
                  initialCapital: value,
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "paperTrading":
        return (
          <StepWrapper title="Trading Mode" step={16} total={totalSteps}>
            <Confirm
              message="Enable paper trading mode? (recommended for testing)"
              defaultValue={config.capital.paperTrading}
              onConfirm={(value) => {
                updateConfig("capital", {
                  ...config.capital,
                  paperTrading: value,
                });
                nextStep();
              }}
            />
          </StepWrapper>
        );

      case "confirm":
        return (
          <StepWrapper title="Confirm Configuration" step={17} total={totalSteps}>
            <Box flexDirection="column">
              <Text bold>Review your configuration:</Text>
              <Box marginTop={1} flexDirection="column">
                <Text>
                  Data Provider: <Text color="cyan">{config.dataProvider}</Text>
                </Text>
                <Text>
                  Trading Symbols: <Text color="cyan">{config.tradingUniverse.symbols.join(", ")}</Text>
                </Text>
                <Text>
                  Initial Capital: <Text color="cyan">${config.capital.initialCapital.toLocaleString()}</Text>
                </Text>
                <Text>
                  Max Position Size: <Text color="cyan">{(config.riskLimits.maxPositionSize * 100).toFixed(0)}%</Text>
                </Text>
                <Text>
                  Max Drawdown: <Text color="cyan">{(config.riskLimits.maxDrawdown * 100).toFixed(0)}%</Text>
                </Text>
                <Text>
                  Paper Trading:{" "}
                  <Text color={config.capital.paperTrading ? "green" : "red"}>
                    {config.capital.paperTrading ? "Yes" : "No"}
                  </Text>
                </Text>
              </Box>
              <Box marginTop={1}>
                <Confirm
                  message="Save this configuration?"
                  defaultValue={true}
                  onConfirm={(confirmed) => {
                    if (confirmed) {
                      nextStep();
                    } else {
                      setStep("welcome");
                    }
                  }}
                />
              </Box>
            </Box>
          </StepWrapper>
        );

      case "complete":
        return (
          <Box flexDirection="column">
            <Text color="green" bold>
              ✓ Configuration saved successfully!
            </Text>
            <Box marginTop={1}>
              <Text>
                Config file: <Text color="cyan">{getConfigPath()}</Text>
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text>Run `bun run start` to launch the trading TUI.</Text>
            </Box>
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      {renderStep()}
    </Box>
  );
}

function StepWrapper({
  title,
  step,
  total,
  children,
}: {
  title: string;
  step: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">
          [{step}/{total}]{" "}
        </Text>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

function WelcomeHandler({ onContinue }: { onContinue: () => void }) {
  useInput((_input, key) => {
    if (key.return) {
      onContinue();
    }
  });
  return null;
}

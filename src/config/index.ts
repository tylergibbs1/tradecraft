import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as TOML from "@iarna/toml";
import { type Config, ConfigSchema, defaultConfig } from "./schema.js";

const CONFIG_DIR = path.join(os.homedir(), ".config", "tradecraft");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.toml");

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): Config {
  // Check environment variables first
  const envConfig: Partial<Config> = {};

  if (process.env.ANTHROPIC_API_KEY) {
    envConfig.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.POLYGON_API_KEY) {
    envConfig.dataProviderApiKey = process.env.POLYGON_API_KEY;
  }
  if (process.env.ALPHAVANTAGE_API_KEY) {
    envConfig.dataProviderApiKey = process.env.ALPHAVANTAGE_API_KEY;
  }
  if (process.env.AGENT_MODE === "swarm" || process.env.AGENT_MODE === "single") {
    envConfig.agentMode = process.env.AGENT_MODE;
  }

  // Load from file if exists
  if (configExists()) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = TOML.parse(content);
      const merged = { ...defaultConfig, ...parsed, ...envConfig };
      return ConfigSchema.parse(merged);
    } catch (error) {
      console.error("Error loading config:", error);
      return ConfigSchema.parse({ ...defaultConfig, ...envConfig });
    }
  }

  return ConfigSchema.parse({ ...defaultConfig, ...envConfig });
}

export function saveConfig(config: Config): void {
  ensureConfigDir();

  const toSave = {
    ...config,
    updatedAt: new Date().toISOString(),
    createdAt: config.createdAt || new Date().toISOString(),
  };

  // Remove undefined values and prepare for TOML
  const cleanConfig = JSON.parse(JSON.stringify(toSave));

  const content = TOML.stringify(cleanConfig as TOML.JsonMap);
  fs.writeFileSync(CONFIG_FILE, content, "utf-8");
}

export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();
  const updated = { ...current, ...updates };
  saveConfig(updated);
  return updated;
}

export * from "./schema.js";

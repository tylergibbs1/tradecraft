import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as TOML from "@iarna/toml";
import { Config, ConfigSchema, defaultConfig } from "./schema.js";

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

  // Atomic write: write to temp file, then rename
  const tempFile = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tempFile, content, "utf-8");
  fs.renameSync(tempFile, CONFIG_FILE);

  // Set restrictive permissions (owner read/write only) to protect API keys
  fs.chmodSync(CONFIG_FILE, 0o600);
}

export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();
  const updated = { ...current, ...updates };
  saveConfig(updated);
  return updated;
}

export * from "./schema.js";

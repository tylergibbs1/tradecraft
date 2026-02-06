#!/usr/bin/env bun
import { render } from "ink";
import { configExists, loadConfig } from "./config/index.js";
import { App } from "./ui/App.js";

async function main() {
  // Check if config exists
  if (!configExists()) {
    console.log("No configuration found. Please run 'bun run setup' first.");
    process.exit(1);
  }

  // Load config
  const config = loadConfig();

  // Check for API key
  if (!config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    console.log("Anthropic API key not configured.");
    console.log("Set ANTHROPIC_API_KEY environment variable or run 'bun run setup'.");
    process.exit(1);
  }

  // Render the TUI
  const { waitUntilExit } = render(<App config={config} />);

  await waitUntilExit();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

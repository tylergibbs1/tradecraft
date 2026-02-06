#!/usr/bin/env bun
import { render } from "ink";
import { SetupWizard } from "./setup/index.js";

async function main() {
  const { waitUntilExit } = render(<SetupWizard />);
  await waitUntilExit();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

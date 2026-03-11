#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quickstartScript = path.resolve(__dirname, "../../scripts/examples/action-wallet-first-governed-action.mjs");
const args = process.argv.slice(2);
const wantsHelp = args.includes("--help") || args.includes("-h");

if (wantsHelp) {
  process.stdout.write(
    [
      "Nooterra OpenClaw sample app",
      "",
      "This wrapper runs the Action Wallet first-governed-action flow with NOOTERRA_HOST_TRACK fixed to `openclaw`.",
      "Use it to prove the launch path: signup -> bootstrap -> approval -> receipt -> dispute.",
      ""
    ].join("\n")
  );
}

const child = spawn(process.execPath, [quickstartScript, ...args], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NOOTERRA_HOST_TRACK: "openclaw"
  },
  stdio: "inherit"
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

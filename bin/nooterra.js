#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = process.argv.slice(2);

if (args[0] === "mcp") {
  const result = spawnSync("node", [path.join(root, "scripts/mcp/nooterra-mcp-server.mjs"), ...args.slice(1)], {
    stdio: "inherit",
    cwd: root,
  });
  process.exit(result.status ?? 1);
} else {
  console.log(`nooterra — AI employees for your business

Usage:
  nooterra mcp     Start the MCP server (for Claude Desktop / Cursor)

Web dashboard:  https://nooterra.ai
Docs:           https://docs.nooterra.ai`);
}

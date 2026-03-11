import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

function runHelp(scriptPath) {
  return spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

test("Claude sample app wrapper exposes help and delegates to the shared quickstart", () => {
  const scriptPath = path.join(process.cwd(), "examples/claude-mcp-action-wallet/run.mjs");
  const result = runHelp(scriptPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Claude MCP sample app/);
  assert.match(result.stdout, /first-governed-action quickstart/);
});

test("OpenClaw sample app wrapper exposes help and delegates to the shared quickstart", () => {
  const scriptPath = path.join(process.cwd(), "examples/openclaw-action-wallet/run.mjs");
  const result = runHelp(scriptPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenClaw sample app/);
  assert.match(result.stdout, /first-governed-action quickstart/);
});

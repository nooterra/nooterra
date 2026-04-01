#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const cwd = process.cwd();

function runShell(command) {
  const result = spawnSync("bash", ["-lc", command], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[runtime-hardening] running runtime test pack");
runShell("npx tsx --test test/runtime-*.test.js");

console.log("[runtime-hardening] running runtime lint pack");
runShell("npx eslint services/runtime/*.js test/runtime-*.test.js");

console.log("[runtime-hardening] running type check");
runShell("npx tsc --noEmit");

console.log("[runtime-hardening] gate passed");

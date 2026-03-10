import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PRODUCT_SHELL_PATH = path.resolve(process.cwd(), "dashboard/src/product/ProductShell.jsx");

test("product shell launch copy stays aligned to the Action Wallet scope", () => {
  const source = fs.readFileSync(PRODUCT_SHELL_PATH, "utf8");

  assert.match(source, /Action Wallet Launch/);
  assert.match(source, /Action Wallet boundary/);
  assert.match(source, /Action Wallet: approvals, standing rules, trusted hosts, sessions, and payment guardrails/i);
  assert.match(source, /hosted approvals/i);
  assert.match(source, /Claude MCP and OpenClaw only/);

  assert.doesNotMatch(source, /Authority Wallet/);
  assert.doesNotMatch(source, /\bTask Wallet\b/);
  assert.doesNotMatch(source, /task wallet envelope/i);
  assert.doesNotMatch(source, /Marketplace context/);
  assert.doesNotMatch(source, /Managed specialists:/);
  assert.doesNotMatch(source, /marketplace provider publications/i);
  assert.doesNotMatch(source, /work-order rail/i);
  assert.doesNotMatch(source, /ChatGPT app/i);
  assert.doesNotMatch(source, /Cursor/);
  assert.doesNotMatch(source, /first-party assistant shell/i);
  assert.doesNotMatch(source, /Passport status/);
});

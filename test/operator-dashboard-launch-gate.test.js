import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const OPERATOR_DASHBOARD_PATH = path.resolve(process.cwd(), "dashboard/src/operator/OperatorDashboard.jsx");

test("operator dashboard launch gate scorecard stays locked to the two host channels and per-channel launch metrics", () => {
  const source = fs.readFileSync(OPERATOR_DASHBOARD_PATH, "utf8");

  assert.match(source, /By launch channel/);
  assert.match(source, /Claude MCP/);
  assert.match(source, /OpenClaw/);
  assert.match(source, /ready/);
  assert.match(source, /watch/);
  assert.match(source, /blocked/);
  assert.match(source, /per-channel partitions/i);
  assert.match(source, /Launch readiness is gated by approval conversion, receipt coverage, out-of-scope blocking, dispute handling, and operator recovery on Claude MCP and OpenClaw only\./);
  assert.match(source, /Approval conversion/);
  assert.match(source, /Receipt coverage/);
  assert.match(source, /Out-of-scope blocking/);
  assert.match(source, /Open rescues/);
  assert.match(source, /Pending approvals/);
  assert.match(source, /Resume queue/);
  assert.match(source, /Watchpoints/);
  assert.match(source, /wallet-only launch scope/i);

  assert.doesNotMatch(source, /Cursor/);
  assert.doesNotMatch(source, /ChatGPT app/i);
  assert.doesNotMatch(source, /marketplace publication/i);
  assert.doesNotMatch(source, /Nooterra-owned execution/i);
});

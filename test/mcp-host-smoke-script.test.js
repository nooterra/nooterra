import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

test("mcp host smoke script emits fail-closed runtime/policy metadata evidence", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-mcp-host-smoke-test-"));
  const reportPath = path.join(tmpDir, "report.json");
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, ["scripts/ci/run-mcp-host-smoke.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      MCP_HOST_SMOKE_REPORT_PATH: reportPath
    },
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "McpHostSmokeReport.v1");
  assert.equal(report.ok, true);

  const checks = Array.isArray(report.checks) ? report.checks : [];
  const byId = new Map(checks.map((check) => [check.id, check]));

  assert.equal(byId.get("runtime_bootstrap")?.ok, true);
  assert.equal(byId.get("runtime_bootstrap_metadata_projection")?.ok, true);
  assert.equal(byId.get("runtime_smoke_test")?.ok, true);
  assert.equal(byId.get("runtime_smoke_test_rejects_tenant_mismatch")?.ok, true);
  assert.equal(byId.get("runtime_smoke_test_rejects_tenant_mismatch")?.code, "ENV_INVALID");
  assert.equal(byId.get("mcp_paid_tool_runtime_policy_metadata_fail_closed")?.ok, true);
  assert.equal(byId.get("mcp_paid_tool_runtime_policy_metadata_fail_closed")?.requestCount > 0, true);
});

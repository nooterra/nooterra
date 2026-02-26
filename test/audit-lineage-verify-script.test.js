import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildAuditLineageV1 } from "../src/core/audit-lineage.js";

function runVerifyScript(args = []) {
  const scriptPath = path.resolve(process.cwd(), "scripts/ops/verify-audit-lineage.mjs");
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function buildFixtureLineage() {
  return buildAuditLineageV1({
    tenantId: "tenant_default",
    filters: {
      traceId: "trace_verify_script_1",
      includeSessionEvents: true
    },
    records: [
      {
        kind: "SESSION_EVENT",
        recordId: "evt_verify_script_1",
        at: "2026-02-25T02:00:00.000Z",
        status: null,
        traceIds: ["trace_verify_script_1"],
        agentIds: ["agt_1"],
        refs: { sessionId: "sess_1", chainHash: "d".repeat(64), payloadHash: "e".repeat(64) }
      }
    ],
    limit: 50,
    offset: 0
  });
}

test("verify-audit-lineage script returns ok for valid lineage input", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-audit-lineage-verify-"));
  try {
    const lineagePath = path.join(tmpDir, "lineage.json");
    const lineage = buildFixtureLineage();
    await fs.writeFile(lineagePath, `${JSON.stringify({ lineage }, null, 2)}\n`, "utf8");

    const run = runVerifyScript(["--in", lineagePath]);
    assert.equal(run.status, 0, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.schemaVersion, "AuditLineageVerificationReport.v1");
    assert.equal(report.lineageHash, lineage.lineageHash);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("verify-audit-lineage script fails closed on tampered lineage hash", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-audit-lineage-verify-"));
  try {
    const lineagePath = path.join(tmpDir, "lineage-tampered.json");
    const lineage = buildFixtureLineage();
    const tampered = {
      ...lineage,
      records: lineage.records.map((row) => ({ ...row, status: "tampered" }))
    };
    await fs.writeFile(lineagePath, `${JSON.stringify({ lineage: tampered }, null, 2)}\n`, "utf8");

    const run = runVerifyScript(["--in", lineagePath]);
    assert.equal(run.status, 1, `stdout:\n${run.stdout}\n\nstderr:\n${run.stderr}`);
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.code, "AUDIT_LINEAGE_HASH_MISMATCH");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});


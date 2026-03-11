import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBackupRestoreDrillReport,
  extractStepResults,
  parseArgs
} from "../scripts/ops/run-backup-restore-drill.mjs";

test("extractStepResults captures pass/fail timing from shell output", () => {
  const steps = extractStepResults(`
[1/8] Seed workload into source DB
    -> ok (3s)
[2/8] Capture expected state
    -> ok (1s)
[3/8] Restore into restore DB
    -> failed (9s, exit=1)
`);
  assert.deepEqual(
    steps.map((step) => ({ id: step.id, status: step.status, elapsedSeconds: step.elapsedSeconds })),
    [
      { id: "1/8", status: "pass", elapsedSeconds: 3 },
      { id: "2/8", status: "pass", elapsedSeconds: 1 },
      { id: "3/8", status: "fail", elapsedSeconds: 9 }
    ]
  );
});

test("createBackupRestoreDrillReport redacts database URLs and records blocking issues", () => {
  const report = createBackupRestoreDrillReport({
    capturedAt: "2026-03-11T21:30:00.000Z",
    args: {
      tenantId: "tenant_default",
      databaseUrl: "postgres://user:pw@source.db.example.com:5432/nooterra",
      restoreDatabaseUrl: "postgres://user:pw@restore.db.example.com:5432/nooterra_restore",
      schema: "backup_schema",
      restoreSchema: "backup_schema_restore",
      jobs: 10,
      month: "2026-03",
      verifyFinancePack: true
    },
    run: {
      status: 1,
      signal: null,
      runtimeMs: 1234,
      stdout: "[1/8] Seed workload\n    -> failed (2s, exit=1)\n",
      stderr: "boom\n"
    },
    steps: [
      {
        id: "1/8",
        label: "Seed workload",
        status: "fail",
        elapsedSeconds: 2,
        detail: "2s, exit=1"
      }
    ]
  });
  assert.equal(report.schemaVersion, "BackupRestoreDrillReport.v1");
  assert.equal(report.status, "fail");
  assert.equal(report.inputs.sourceDatabase.host, "source.db.example.com");
  assert.equal(report.inputs.restoreDatabase.host, "restore.db.example.com");
  assert.equal(report.inputs.verifyFinancePack, true);
  assert.equal(report.blockingIssues[0].code, "BACKUP_RESTORE_DRILL_FAILED");
  assert.equal(report.blockingIssues[1].code, "BACKUP_RESTORE_STEP_FAILED");
  assert.match(report.artifacts.stdoutSha256, /^[a-f0-9]{64}$/);
});

test("CLI emits pass report and writes output file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nooterra-backup-drill-"));
  const shellPath = path.join(tempDir, "fake-drill.sh");
  const outPath = path.join(tempDir, "report.json");
  fs.writeFileSync(
    shellPath,
    `#!/usr/bin/env bash
echo "[1/8] Seed workload into source DB"
echo "    -> ok (1s)"
echo "[2/8] Capture expected state"
echo "    -> ok (1s)"
echo "=== Backup/Restore Verification PASSED ==="
`
  );
  fs.chmodSync(shellPath, 0o755);

  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(
    process.execPath,
    [
      "scripts/ops/run-backup-restore-drill.mjs",
      "--tenant-id",
      "tenant_default",
      "--database-url",
      "postgres://user:pw@source.example.com:5432/nooterra",
      "--restore-database-url",
      "postgres://user:pw@restore.example.com:5432/nooterra",
      "--shell-script-path",
      shellPath,
      "--out",
      outPath
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );

  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.checks.steps.length, 2);
  assert.equal(fs.existsSync(outPath), true);
});

test("parseArgs rejects missing database url", () => {
  assert.throws(
    () => parseArgs(["--tenant-id", "tenant_default", "--restore-database-url", "postgres://x@y/z"]),
    /--database-url is required/
  );
});

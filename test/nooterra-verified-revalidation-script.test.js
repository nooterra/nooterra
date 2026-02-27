import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseArgs, runNooterraVerifiedRevalidation } from "../scripts/ci/run-nooterra-verified-revalidation.mjs";

test("nooterra verified revalidation parser: parses custom inputs and forwards gate args", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    [
      "--level",
      "core",
      "--baseline-report",
      "./artifacts/baseline.json",
      "--revocation-signals",
      "./artifacts/revocations.json",
      "--notifications-out",
      "./artifacts/alerts.json",
      "--allow-missing-baseline",
      "--allow-missing-revocation-signals"
    ],
    {},
    cwd
  );
  assert.equal(args.allowMissingBaseline, true);
  assert.equal(args.allowMissingRevocationSignals, true);
  assert.equal(args.gateArgs.level, "core");
  assert.equal(args.baselineReport, path.resolve(cwd, "./artifacts/baseline.json"));
  assert.equal(args.revocationSignals, path.resolve(cwd, "./artifacts/revocations.json"));
  assert.equal(args.notificationsOut, path.resolve(cwd, "./artifacts/alerts.json"));
});

test("nooterra verified revalidation runner: flags regression from passing baseline to failing current check", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nooterra-revalidation-"));
  const baselinePath = path.join(tmp, "baseline.json");
  const revocationsPath = path.join(tmp, "revocations.json");
  const outPath = path.join(tmp, "revalidation.json");
  const currentOut = path.join(tmp, "current-gate.json");
  const notificationsOut = path.join(tmp, "alerts.json");
  await mkdir(tmp, { recursive: true });

  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: "NooterraVerifiedGateReport.v1",
        checks: [{ id: "mcp_host_cert_matrix", ok: true }],
        summary: { failedChecks: 0 }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    revocationsPath,
    `${JSON.stringify(
      {
        schemaVersion: "NooterraVerifiedRevocationSignals.v1",
        generatedAt: "2026-01-01T00:00:00.000Z",
        signals: []
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const args = parseArgs(
    [
      "--level",
      "core",
      "--baseline-report",
      baselinePath,
      "--revocation-signals",
      revocationsPath,
      "--out",
      outPath,
      "--current-report-out",
      currentOut,
      "--notifications-out",
      notificationsOut
    ],
    {},
    process.cwd()
  );

  const { report } = await runNooterraVerifiedRevalidation(args, {
    runGateFn: async () => ({
      report: {
        schemaVersion: "NooterraVerifiedGateReport.v1",
        checks: [{ id: "mcp_host_cert_matrix", ok: false }],
        summary: { failedChecks: 1 },
        blockingIssues: []
      }
    })
  });

  assert.equal(report.ok, false);
  assert.equal(report.summary.regressions, 1);
  assert.equal(report.blockingIssues.some((row) => row.code === "CHECK_REGRESSION"), true);
});

test("nooterra verified revalidation runner: fails closed on active revoked signal", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "nooterra-revalidation-"));
  const baselinePath = path.join(tmp, "baseline.json");
  const revocationsPath = path.join(tmp, "revocations.json");
  const outPath = path.join(tmp, "revalidation.json");
  const currentOut = path.join(tmp, "current-gate.json");
  const notificationsOut = path.join(tmp, "alerts.json");
  await mkdir(tmp, { recursive: true });

  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: "NooterraVerifiedGateReport.v1",
        checks: [{ id: "mcp_host_cert_matrix", ok: true }],
        summary: { failedChecks: 0 }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    revocationsPath,
    `${JSON.stringify(
      {
        schemaVersion: "NooterraVerifiedRevocationSignals.v1",
        generatedAt: "2026-01-01T00:00:00.000Z",
        signals: [
          {
            signalId: "sig_1",
            entityId: "runtime_1",
            status: "revoked",
            reasonCode: "KEY_REVOKED",
            effectiveAt: "2026-01-01T00:00:00.000Z",
            source: "issuer"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const args = parseArgs(
    [
      "--level",
      "core",
      "--baseline-report",
      baselinePath,
      "--revocation-signals",
      revocationsPath,
      "--out",
      outPath,
      "--current-report-out",
      currentOut,
      "--notifications-out",
      notificationsOut
    ],
    {},
    process.cwd()
  );

  const { report } = await runNooterraVerifiedRevalidation(args, {
    runGateFn: async () => ({
      report: {
        schemaVersion: "NooterraVerifiedGateReport.v1",
        checks: [{ id: "mcp_host_cert_matrix", ok: true }],
        summary: { failedChecks: 0 },
        blockingIssues: []
      }
    })
  });

  assert.equal(report.ok, false);
  assert.equal(report.summary.activeRevocationSignals, 1);
  assert.equal(report.blockingIssues.some((row) => row.code === "REVOCATION_SIGNAL_ACTIVE"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildX402PilotReliabilityReport } from "../scripts/ops/build-x402-pilot-reliability-report.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("x402 pilot reliability report computes core rates from artifact runs", async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "nooterra-x402-pilot-metrics-"));
  const artifactRoot = path.join(tmpRoot, "artifacts", "mcp-paid-exa");
  fs.mkdirSync(artifactRoot, { recursive: true });

  const runSuccess = path.join(artifactRoot, "2026-02-10T10:00:00.000Z");
  writeJson(path.join(runSuccess, "summary.json"), {
    ok: true,
    runId: "run_success",
    timestamps: { startedAt: "2026-02-10T10:00:00.000Z", completedAt: "2026-02-10T10:00:02.000Z" },
    passChecks: { tokenVerified: true, providerSignature: true },
    batchSettlement: { enabled: true, ok: true, result: { payoutExecution: { enabled: true, failed: 0 } } }
  });
  writeJson(path.join(runSuccess, "mcp-call.parsed.json"), { tool: "nooterra.exa_search_paid", durationMs: 800 });
  writeJson(path.join(runSuccess, "nooterra-pay-token-verification.json"), { ok: true });
  writeJson(path.join(runSuccess, "provider-signature-verification.json"), { ok: true });
  writeJson(path.join(runSuccess, "provider-replay-probe.json"), {
    replayCounters: { totalRequests: 1, duplicateResponses: 1 }
  });

  const runGatewayFail = path.join(artifactRoot, "2026-02-10T10:10:00.000Z");
  writeJson(path.join(runGatewayFail, "summary.json"), {
    ok: false,
    runId: "run_gateway_fail",
    timestamps: { startedAt: "2026-02-10T10:10:00.000Z", completedAt: "2026-02-10T10:10:01.000Z" },
    error: 'mcp tool call returned error: {"error":"gateway_error"}'
  });
  writeJson(path.join(runGatewayFail, "mcp-call.parsed.json"), { tool: "nooterra.exa_search_paid", error: "gateway_error", durationMs: 700 });

  const runInfraFail = path.join(artifactRoot, "2026-02-10T10:20:00.000Z");
  writeJson(path.join(runInfraFail, "summary.json"), {
    ok: false,
    runId: "run_infra_fail",
    timestamps: { startedAt: "2026-02-10T10:20:00.000Z", completedAt: "2026-02-10T10:20:00.100Z" },
    error: "api /healthz exited before becoming ready (exitCode=1)"
  });

  const report = buildX402PilotReliabilityReport({
    artifactRoot,
    days: 7,
    nowIso: "2026-02-11T00:00:00.000Z"
  });

  assert.equal(report.schemaVersion, "X402PilotReliabilityReport.v1");
  assert.equal(report.runCounts.runsInWindow, 3);
  assert.equal(report.runCounts.infraBootFailures, 1);
  assert.equal(report.runCounts.toolCallAttempts, 2);
  assert.equal(report.runCounts.successfulPaidCalls, 1);

  assert.equal(report.metrics.reserveFailRate.numerator, 1);
  assert.equal(report.metrics.reserveFailRate.denominator, 2);
  assert.equal(report.metrics.reserveFailRate.value, 0.5);

  assert.equal(report.metrics.tokenVerifyFailRate.numerator, 0);
  assert.equal(report.metrics.tokenVerifyFailRate.denominator, 1);
  assert.equal(report.metrics.tokenVerifyFailRate.value, 0);

  assert.equal(report.metrics.providerSigFailRate.numerator, 0);
  assert.equal(report.metrics.providerSigFailRate.denominator, 1);
  assert.equal(report.metrics.providerSigFailRate.value, 0);

  assert.equal(report.metrics.settlementSuccessRate.numerator, 1);
  assert.equal(report.metrics.settlementSuccessRate.denominator, 1);
  assert.equal(report.metrics.settlementSuccessRate.value, 1);

  assert.equal(report.metrics.replayDuplicateRate.numerator, 1);
  assert.equal(report.metrics.replayDuplicateRate.denominator, 1);
  assert.equal(report.metrics.replayDuplicateRate.value, 1);

  assert.equal(report.metrics.timeToFirstPaidCallMs, 2000);
  assert.deepEqual(report.checks, []);
  assert.deepEqual(report.blockingIssues, []);
  assert.equal(report.verdict?.ok, true);
  assert.equal(report.verdict?.status, "pass");
  assert.equal(report.verdict?.requiredChecks, 0);
  assert.equal(report.verdict?.passedChecks, 0);
  assert.equal(report.verdict?.failedChecks, 0);
});

test("x402 pilot reliability report script emits checks/blocking issues/verdict counts for threshold failures", async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "nooterra-x402-pilot-threshold-"));
  const artifactRoot = path.join(tmpRoot, "artifacts", "mcp-paid-exa");
  const runFail = path.join(artifactRoot, "2026-02-10T10:10:00.000Z");
  const outPath = path.join(tmpRoot, "report.json");

  writeJson(path.join(runFail, "summary.json"), {
    ok: false,
    runId: "run_gateway_fail",
    timestamps: { startedAt: "2026-02-10T10:10:00.000Z", completedAt: "2026-02-10T10:10:01.000Z" },
    error: 'mcp tool call returned error: {"error":"gateway_error"}'
  });
  writeJson(path.join(runFail, "mcp-call.parsed.json"), { tool: "nooterra.exa_search_paid", error: "gateway_error", durationMs: 700 });

  const run = spawnSync(
    process.execPath,
    [
      "scripts/ops/build-x402-pilot-reliability-report.mjs",
      "--artifact-root",
      artifactRoot,
      "--days",
      "7",
      "--now",
      "2026-02-11T00:00:00.000Z",
      "--max-reserve-fail-rate",
      "0",
      "--out",
      outPath
    ],
    {
      cwd: path.resolve("."),
      encoding: "utf8"
    }
  );
  assert.equal(run.status, 1, `stdout=${run.stdout}\nstderr=${run.stderr}`);

  const report = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(Array.isArray(report.checks), true);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0]?.id, "maxReserveFailRate");
  assert.equal(report.checks[0]?.ok, false);
  assert.equal(Array.isArray(report.blockingIssues), true);
  assert.equal(report.blockingIssues.length, 1);
  assert.equal(report.blockingIssues[0]?.checkId, "maxReserveFailRate");
  assert.equal(report.verdict?.ok, false);
  assert.equal(report.verdict?.status, "fail");
  assert.equal(report.verdict?.requiredChecks, 1);
  assert.equal(report.verdict?.passedChecks, 0);
  assert.equal(report.verdict?.failedChecks, 1);
});

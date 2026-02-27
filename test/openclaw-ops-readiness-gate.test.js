import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeOpenclawOperatorReadinessArtifactHash,
  parseArgs,
  runOpenclawOperatorReadinessGate
} from "../scripts/ops/openclaw-operator-readiness-gate.mjs";
import { buildHostedBaselineEvidenceOutput } from "../scripts/ops/hosted-baseline-evidence.mjs";

test("openclaw operator readiness gate parser: requires hosted evidence and supports overrides", () => {
  assert.throws(() => parseArgs([], {}, "/tmp/nooterra"), /--hosted-evidence is required/);

  const args = parseArgs(
    ["--hosted-evidence", "artifacts/ops/hosted.json", "--openclaw-plugin", "openclaw.plugin.json", "--mcp-config", "artifacts/ops/mcp.json", "--out", "artifacts/gates/openclaw.json"],
    {},
    "/tmp/nooterra"
  );

  assert.equal(args.hostedEvidencePath, path.resolve("/tmp/nooterra", "artifacts/ops/hosted.json"));
  assert.equal(args.openclawPluginPath, path.resolve("/tmp/nooterra", "openclaw.plugin.json"));
  assert.equal(args.mcpConfigPath, path.resolve("/tmp/nooterra", "artifacts/ops/mcp.json"));
  assert.equal(args.outPath, path.resolve("/tmp/nooterra", "artifacts/gates/openclaw.json"));
});

test("openclaw operator readiness gate: passes with hosted evidence + plugin env", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-openclaw-ops-ready-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const hostedPath = path.join(tmpRoot, "hosted-baseline.json");
  const pluginPath = path.join(tmpRoot, "openclaw.plugin.json");

  const hosted = buildHostedBaselineEvidenceOutput({
    reportCore: {
      type: "HostedBaselineEvidence.v1",
      v: 1,
      capturedAt: "2026-02-27T00:00:00.000Z",
      status: "pass",
      failures: [],
      inputs: {
        baseUrl: "https://api.nooterra.work",
        tenantId: "tenant_default",
        environment: "production",
        requireBillingCatalog: true,
        requireMaintenanceSchedulers: true,
        requiredMetrics: ["replay_mismatch_gauge"],
        rateLimitMode: "optional",
        rateLimitProbeRequests: 0,
        rateLimitProbePath: "/ops/status",
        runBackupRestore: false,
        backupRestoreEvidencePath: null,
        requireBackupRestore: false
      },
      checks: {
        healthz: { ok: true, statusCode: 200, body: { ok: true } },
        opsStatus: { ok: true, statusCode: 200, maintenanceSchedulersEnabled: true, summary: null },
        metrics: { ok: true, statusCode: 200, metricCount: 1, missingMetrics: [] },
        billingCatalog: { ok: true, statusCode: 200, validation: { ok: true, failures: [] } },
        rateLimitProbe: null,
        backupRestore: null
      }
    }
  });

  await fs.writeFile(hostedPath, `${JSON.stringify(hosted, null, 2)}\n`, "utf8");
  await fs.writeFile(
    pluginPath,
    `${JSON.stringify(
      {
        id: "nooterra",
        baseUrl: "https://api.nooterra.work",
        tenantId: "tenant_default",
        apiKey: "sk_live_ops"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const { report } = await runOpenclawOperatorReadinessGate({
    hostedEvidencePath: hostedPath,
    openclawPluginPath: pluginPath,
    mcpConfigPath: null,
    capturedAt: null,
    outPath: path.join(tmpRoot, "report.json")
  });

  assert.equal(report.schemaVersion, "OpenClawOperatorReadinessGateReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  const { artifactHash, ...reportCore } = report;
  assert.equal(artifactHash, computeOpenclawOperatorReadinessArtifactHash(reportCore));
  assert.equal(
    report.checks.some((check) => check.id === "self_host_required_env_resolved" && check.ok === true),
    true
  );
});

test("openclaw operator readiness gate: fails closed when required self-host config is missing", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-openclaw-ops-ready-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const hostedPath = path.join(tmpRoot, "hosted-baseline.json");
  const pluginPath = path.join(tmpRoot, "openclaw.plugin.json");

  const hosted = buildHostedBaselineEvidenceOutput({
    reportCore: {
      type: "HostedBaselineEvidence.v1",
      v: 1,
      capturedAt: "2026-02-27T00:00:00.000Z",
      status: "pass",
      failures: [],
      inputs: {},
      checks: {}
    }
  });

  await fs.writeFile(hostedPath, `${JSON.stringify(hosted, null, 2)}\n`, "utf8");
  await fs.writeFile(
    pluginPath,
    `${JSON.stringify(
      {
        id: "nooterra",
        baseUrl: "https://api.nooterra.work"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const { report } = await runOpenclawOperatorReadinessGate({
    hostedEvidencePath: hostedPath,
    openclawPluginPath: pluginPath,
    mcpConfigPath: null,
    capturedAt: null,
    outPath: path.join(tmpRoot, "report.json")
  });

  assert.equal(report.verdict.ok, false);
  assert.equal(report.blockingIssues.length > 0, true);
  const selfHostCheck = report.checks.find((check) => check.id === "self_host_required_env_resolved");
  assert.equal(selfHostCheck?.ok, false);
  assert.equal(Array.isArray(selfHostCheck?.detail?.missingKeys), true);
  assert.equal(selfHostCheck?.detail?.missingKeys.includes("NOOTERRA_API_KEY"), true);
});

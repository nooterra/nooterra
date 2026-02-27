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
        opsConfig: { ok: true, statusCode: 200, s8Approval: { enforceX402AuthorizePayment: true, policyConfigured: true } },
        s8ApprovalRollout: {
          ok: true,
          enforceX402AuthorizePayment: true,
          policyPresent: true,
          policyShapeValid: true,
          failureCode: null,
          message: "S8 approval enforcement is enabled with explicit policy shape.",
          policySummary: {
            schemaVersion: "NooterraHumanApprovalPolicy.v1",
            requireApprovalAboveCents: 50000,
            strictEvidenceRefs: true,
            highRiskActionTypesCount: 4
          }
        },
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
  assert.equal(report.checks.some((check) => check.id === "s8_rollout_guardrails" && check.ok === true), true);
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
      checks: {
        s8ApprovalRollout: {
          ok: true,
          enforceX402AuthorizePayment: false,
          policyPresent: true,
          policyShapeValid: true,
          failureCode: null,
          message: "S8 approval enforcement toggle is disabled.",
          policySummary: null
        }
      }
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

test("openclaw operator readiness gate: fails closed when hosted S8 rollout guard check fails", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-openclaw-ops-ready-s8-fail-"));
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
      status: "fail",
      failures: ["s8 rollout guard check failed (s8_approval_policy_missing)"],
      inputs: {},
      checks: {
        s8ApprovalRollout: {
          ok: false,
          enforceX402AuthorizePayment: true,
          policyPresent: false,
          policyShapeValid: false,
          failureCode: "s8_approval_policy_missing",
          message: "S8 approval enforcement is enabled; config.s8Approval.policy must be a plain object.",
          policySummary: null
        }
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

  assert.equal(report.verdict.ok, false);
  const s8Check = report.checks.find((check) => check.id === "s8_rollout_guardrails");
  assert.equal(s8Check?.ok, false);
  assert.equal(s8Check?.failureCode, "s8_approval_policy_missing");
  assert.equal(
    report.blockingIssues.some((issue) => issue.id === "openclaw_operator_readiness:s8_rollout_guardrails"),
    true
  );
});

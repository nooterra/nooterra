import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_ONBOARDING_DOC_PATHS,
  computeAcsE10ReadinessArtifactHash,
  parseArgs,
  runAcsE10ReadinessGate
} from "../scripts/ci/run-acs-e10-readiness-gate.mjs";
import { buildHostedBaselineEvidenceOutput } from "../scripts/ops/hosted-baseline-evidence.mjs";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeRequiredDocs(cwd) {
  for (const relativePath of REQUIRED_ONBOARDING_DOC_PATHS) {
    const absolutePath = path.resolve(cwd, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `# ${path.basename(relativePath)}\n`, "utf8");
  }
}

test("acs e10 readiness parser: supports env defaults and argument overrides", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    [
      "--report",
      "artifacts/custom/e10.json",
      "--hosted-evidence",
      "artifacts/custom/hosted.json",
      "--captured-at",
      "2026-02-28T00:00:00.000Z"
    ],
    {
      ACS_E10_OPENCLAW_OPERATOR_READINESS_PATH: "artifacts/custom/openclaw.json",
      ACS_E10_ONBOARDING_HOST_SUCCESS_PATH: "artifacts/custom/onboarding.json",
      ACS_E10_MCP_HOST_CERT_MATRIX_PATH: "artifacts/custom/matrix.json",
      ACS_E10_PUBLIC_ONBOARDING_GATE_PATH: "artifacts/custom/public-onboarding.json",
      ACS_E10_SELF_HOST_UPGRADE_MIGRATION_GATE_PATH: "artifacts/custom/self-host-upgrade-gate.json",
      ACS_E10_SERVING_MODE_BOUNDARY_GATE_PATH: "artifacts/custom/serving-mode-boundary-gate.json"
    },
    cwd
  );

  assert.equal(args.outPath, path.resolve(cwd, "artifacts/custom/e10.json"));
  assert.equal(args.hostedEvidencePath, path.resolve(cwd, "artifacts/custom/hosted.json"));
  assert.equal(args.openclawReadinessPath, path.resolve(cwd, "artifacts/custom/openclaw.json"));
  assert.equal(args.onboardingHostSuccessPath, path.resolve(cwd, "artifacts/custom/onboarding.json"));
  assert.equal(args.mcpHostCertMatrixPath, path.resolve(cwd, "artifacts/custom/matrix.json"));
  assert.equal(args.publicOnboardingGatePath, path.resolve(cwd, "artifacts/custom/public-onboarding.json"));
  assert.equal(args.selfHostUpgradeMigrationGatePath, path.resolve(cwd, "artifacts/custom/self-host-upgrade-gate.json"));
  assert.equal(args.servingModeBoundaryGatePath, path.resolve(cwd, "artifacts/custom/serving-mode-boundary-gate.json"));
  assert.equal(args.capturedAt, "2026-02-28T00:00:00.000Z");
});

test("acs e10 readiness parser: fails closed on invalid capturedAt", () => {
  assert.throws(() => parseArgs(["--captured-at", "not-an-iso"], {}, "/tmp/nooterra"), /valid ISO date-time/);
});

test("acs e10 readiness gate: emits pass report when all upstream checks are green", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-acs-e10-pass-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "artifacts", "gates", "acs-e10-readiness-gate.json");
  const hostedPath = path.join(tmpRoot, "artifacts", "ops", "hosted.json");
  const openclawPath = path.join(tmpRoot, "artifacts", "gates", "openclaw.json");
  const onboardingPath = path.join(tmpRoot, "artifacts", "gates", "onboarding.json");
  const matrixPath = path.join(tmpRoot, "artifacts", "ops", "mcp-host-cert-matrix.json");
  const publicOnboardingPath = path.join(tmpRoot, "artifacts", "gates", "public-onboarding.json");
  const selfHostUpgradeGatePath = path.join(tmpRoot, "artifacts", "gates", "self-host-upgrade-migration-gate.json");
  const servingModeBoundaryGatePath = path.join(tmpRoot, "artifacts", "gates", "serving-mode-boundary-gate.json");

  const hostedEvidence = buildHostedBaselineEvidenceOutput({
    reportCore: {
      type: "HostedBaselineEvidence.v1",
      v: 1,
      capturedAt: "2026-02-28T00:00:00.000Z",
      status: "pass",
      failures: [],
      inputs: {},
      checks: {
        s8ApprovalRollout: {
          ok: true,
          enforceX402AuthorizePayment: true,
          policyPresent: true,
          policyShapeValid: true,
          failureCode: null,
          message: "S8 approval policy is configured.",
          policySummary: {
            schemaVersion: "NooterraHumanApprovalPolicy.v1",
            requireApprovalAboveCents: 50000,
            strictEvidenceRefs: true,
            highRiskActionTypesCount: 4
          }
        }
      }
    }
  });
  await writeJson(hostedPath, hostedEvidence);
  await writeJson(openclawPath, {
    schemaVersion: "OpenClawOperatorReadinessGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-openclaw"
  });
  await writeJson(onboardingPath, {
    schemaVersion: "OnboardingHostSuccessGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-onboarding"
  });
  await writeJson(matrixPath, {
    schemaVersion: "NooterraMcpHostCertMatrix.v1",
    ok: true,
    driftGate: {
      schemaVersion: "NooterraMcpHostCertMatrixDriftGate.v1",
      strictOk: true,
      ok: true,
      overrideApplied: false
    },
    artifactHash: "sha256-matrix"
  });
  await writeJson(publicOnboardingPath, {
    schemaVersion: "PublicOnboardingGate.v1",
    ok: true
  });
  await writeJson(selfHostUpgradeGatePath, {
    schemaVersion: "SelfHostUpgradeMigrationGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-self-host-upgrade"
  });
  await writeJson(servingModeBoundaryGatePath, {
    schemaVersion: "ServingModeBoundaryGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-serving-mode-boundary"
  });
  await writeRequiredDocs(tmpRoot);

  const { report } = await runAcsE10ReadinessGate(
    {
      help: false,
      outPath: reportPath,
      hostedEvidencePath: hostedPath,
      openclawReadinessPath: openclawPath,
      onboardingHostSuccessPath: onboardingPath,
      mcpHostCertMatrixPath: matrixPath,
      publicOnboardingGatePath: publicOnboardingPath,
      selfHostUpgradeMigrationGatePath: selfHostUpgradeGatePath,
      servingModeBoundaryGatePath,
      capturedAt: "2026-02-28T00:00:00.000Z"
    },
    tmpRoot
  );

  assert.equal(report.schemaVersion, "AcsE10ReadinessGateReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.artifactHash, computeAcsE10ReadinessArtifactHash(report));
  assert.equal(
    report.checks.some((check) => check.id === "mcp_host_cert_matrix_green" && check.ok === true),
    true
  );
});

test("acs e10 readiness gate: fails closed when mcp matrix drift gate is not strict green", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-acs-e10-fail-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "artifacts", "gates", "acs-e10-readiness-gate.json");
  const hostedPath = path.join(tmpRoot, "artifacts", "ops", "hosted.json");
  const openclawPath = path.join(tmpRoot, "artifacts", "gates", "openclaw.json");
  const onboardingPath = path.join(tmpRoot, "artifacts", "gates", "onboarding.json");
  const matrixPath = path.join(tmpRoot, "artifacts", "ops", "mcp-host-cert-matrix.json");
  const publicOnboardingPath = path.join(tmpRoot, "artifacts", "gates", "public-onboarding.json");
  const selfHostUpgradeGatePath = path.join(tmpRoot, "artifacts", "gates", "self-host-upgrade-migration-gate.json");
  const servingModeBoundaryGatePath = path.join(tmpRoot, "artifacts", "gates", "serving-mode-boundary-gate.json");

  const hostedEvidence = buildHostedBaselineEvidenceOutput({
    reportCore: {
      type: "HostedBaselineEvidence.v1",
      v: 1,
      capturedAt: "2026-02-28T00:00:00.000Z",
      status: "pass",
      failures: [],
      inputs: {},
      checks: {
        s8ApprovalRollout: {
          ok: true,
          enforceX402AuthorizePayment: true,
          policyPresent: true,
          policyShapeValid: true,
          failureCode: null,
          message: "S8 approval policy is configured.",
          policySummary: {
            schemaVersion: "NooterraHumanApprovalPolicy.v1",
            requireApprovalAboveCents: 50000,
            strictEvidenceRefs: true,
            highRiskActionTypesCount: 4
          }
        }
      }
    }
  });
  await writeJson(hostedPath, hostedEvidence);
  await writeJson(openclawPath, {
    schemaVersion: "OpenClawOperatorReadinessGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-openclaw"
  });
  await writeJson(onboardingPath, {
    schemaVersion: "OnboardingHostSuccessGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-onboarding"
  });
  await writeJson(matrixPath, {
    schemaVersion: "NooterraMcpHostCertMatrix.v1",
    ok: true,
    driftGate: {
      schemaVersion: "NooterraMcpHostCertMatrixDriftGate.v1",
      strictOk: false,
      ok: true,
      overrideApplied: true
    },
    artifactHash: "sha256-matrix"
  });
  await writeJson(publicOnboardingPath, {
    schemaVersion: "PublicOnboardingGate.v1",
    ok: true
  });
  await writeJson(selfHostUpgradeGatePath, {
    schemaVersion: "SelfHostUpgradeMigrationGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-self-host-upgrade"
  });
  await writeJson(servingModeBoundaryGatePath, {
    schemaVersion: "ServingModeBoundaryGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-serving-mode-boundary"
  });
  await writeRequiredDocs(tmpRoot);

  const { report } = await runAcsE10ReadinessGate(
    {
      help: false,
      outPath: reportPath,
      hostedEvidencePath: hostedPath,
      openclawReadinessPath: openclawPath,
      onboardingHostSuccessPath: onboardingPath,
      mcpHostCertMatrixPath: matrixPath,
      publicOnboardingGatePath: publicOnboardingPath,
      selfHostUpgradeMigrationGatePath: selfHostUpgradeGatePath,
      servingModeBoundaryGatePath,
      capturedAt: null
    },
    tmpRoot
  );

  assert.equal(report.verdict.ok, false);
  assert.equal(
    report.blockingIssues.some((issue) => issue.id === "acs_e10_readiness:mcp_host_cert_matrix_green"),
    true
  );
  assert.equal(report.checks.find((check) => check.id === "mcp_host_cert_matrix_green")?.ok, false);
});

test("acs e10 readiness artifact hash: stable across generatedAt mutation", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-acs-e10-hash-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const reportPath = path.join(tmpRoot, "artifacts", "gates", "acs-e10-readiness-gate.json");
  const hostedPath = path.join(tmpRoot, "artifacts", "ops", "hosted.json");
  const openclawPath = path.join(tmpRoot, "artifacts", "gates", "openclaw.json");
  const onboardingPath = path.join(tmpRoot, "artifacts", "gates", "onboarding.json");
  const matrixPath = path.join(tmpRoot, "artifacts", "ops", "mcp-host-cert-matrix.json");
  const publicOnboardingPath = path.join(tmpRoot, "artifacts", "gates", "public-onboarding.json");
  const selfHostUpgradeGatePath = path.join(tmpRoot, "artifacts", "gates", "self-host-upgrade-migration-gate.json");
  const servingModeBoundaryGatePath = path.join(tmpRoot, "artifacts", "gates", "serving-mode-boundary-gate.json");

  const hostedEvidence = buildHostedBaselineEvidenceOutput({
    reportCore: {
      type: "HostedBaselineEvidence.v1",
      v: 1,
      capturedAt: "2026-02-28T00:00:00.000Z",
      status: "pass",
      failures: [],
      inputs: {},
      checks: {
        s8ApprovalRollout: {
          ok: true,
          enforceX402AuthorizePayment: true,
          policyPresent: true,
          policyShapeValid: true,
          failureCode: null,
          message: "S8 approval policy is configured.",
          policySummary: {
            schemaVersion: "NooterraHumanApprovalPolicy.v1",
            requireApprovalAboveCents: 50000,
            strictEvidenceRefs: true,
            highRiskActionTypesCount: 4
          }
        }
      }
    }
  });
  await writeJson(hostedPath, hostedEvidence);
  await writeJson(openclawPath, {
    schemaVersion: "OpenClawOperatorReadinessGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-openclaw"
  });
  await writeJson(onboardingPath, {
    schemaVersion: "OnboardingHostSuccessGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-onboarding"
  });
  await writeJson(matrixPath, {
    schemaVersion: "NooterraMcpHostCertMatrix.v1",
    ok: true,
    driftGate: {
      schemaVersion: "NooterraMcpHostCertMatrixDriftGate.v1",
      strictOk: true,
      ok: true,
      overrideApplied: false
    },
    artifactHash: "sha256-matrix"
  });
  await writeJson(publicOnboardingPath, {
    schemaVersion: "PublicOnboardingGate.v1",
    ok: true
  });
  await writeJson(selfHostUpgradeGatePath, {
    schemaVersion: "SelfHostUpgradeMigrationGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-self-host-upgrade"
  });
  await writeJson(servingModeBoundaryGatePath, {
    schemaVersion: "ServingModeBoundaryGateReport.v1",
    verdict: { ok: true, status: "pass" },
    artifactHash: "sha256-serving-mode-boundary"
  });
  await writeRequiredDocs(tmpRoot);

  const { report } = await runAcsE10ReadinessGate(
    {
      help: false,
      outPath: reportPath,
      hostedEvidencePath: hostedPath,
      openclawReadinessPath: openclawPath,
      onboardingHostSuccessPath: onboardingPath,
      mcpHostCertMatrixPath: matrixPath,
      publicOnboardingGatePath: publicOnboardingPath,
      selfHostUpgradeMigrationGatePath: selfHostUpgradeGatePath,
      servingModeBoundaryGatePath,
      capturedAt: null
    },
    tmpRoot
  );

  const mutated = {
    ...report,
    generatedAt: "2099-01-01T00:00:00.000Z",
    runtime: { actor: "tester" }
  };
  assert.equal(computeAcsE10ReadinessArtifactHash(mutated), report.artifactHash);
});

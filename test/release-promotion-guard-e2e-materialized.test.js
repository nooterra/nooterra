import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runNodeScript(scriptRelativePath, args, { cwd, env = {} }) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, scriptRelativePath), ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

async function exportE2eArtifact(sourcePath, artifactFileName) {
  const outputDir = String(process.env.NOOTERRA_RELEASE_PROMOTION_E2E_ARTIFACT_DIR ?? "").trim();
  if (!outputDir) return;
  await fs.mkdir(outputDir, { recursive: true });
  try {
    await fs.copyFile(sourcePath, path.join(outputDir, artifactFileName));
  } catch {
    // best-effort triage export only
  }
}

async function seedPromotionGuardUpstreamArtifacts(tmpRoot) {
  const testsRoot = path.join(tmpRoot, "upstream", "tests");
  const goLiveRoot = path.join(tmpRoot, "upstream", "go-live");
  const releaseGateRoot = path.join(tmpRoot, "upstream", "release-gate");

  await writeJson(path.join(testsRoot, "kernel", "kernel-v0-ship-gate.json"), {
    schemaVersion: "KernelV0ShipGateReport.v1",
    verdict: { ok: true, requiredChecks: 1, passedChecks: 1 }
  });

  await writeJson(path.join(testsRoot, "production", "production-cutover-gate.json"), {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true, requiredChecks: 11, passedChecks: 11 },
    checks: [
      {
        id: "nooterra_verified_collaboration",
        status: "passed",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json"
      },
      {
        id: "openclaw_substrate_demo_lineage_verified",
        status: "passed"
      },
      {
        id: "openclaw_substrate_demo_transcript_verified",
        status: "passed"
      },
      {
        id: "session_stream_conformance_verified",
        status: "passed"
      },
      {
        id: "settlement_dispute_arbitration_lifecycle_verified",
        status: "passed"
      },
      {
        id: "checkpoint_grant_binding_verified",
        status: "passed"
      },
      {
        id: "work_order_metering_durability_verified",
        status: "passed"
      },
      {
        id: "ns3_evidence_binding_coverage_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_js_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_py_verified",
        status: "passed"
      },
      {
        id: "sdk_python_contract_freeze_verified",
        status: "passed"
      }
    ]
  });
  const requiredCutoverChecks = [
    {
      id: "nooterra_verified_collaboration",
      status: "passed",
      ok: true,
      source: {
        type: "report_verdict",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: null
      }
    },
    {
      id: "openclaw_substrate_demo_lineage_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "openclaw_substrate_demo_lineage_verified"
      }
    },
    {
      id: "openclaw_substrate_demo_transcript_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "openclaw_substrate_demo_transcript_verified"
      }
    },
    {
      id: "session_stream_conformance_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "e2e_session_stream_conformance_v1"
      }
    },
    {
      id: "settlement_dispute_arbitration_lifecycle_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "e2e_settlement_dispute_arbitration_lifecycle_enforcement"
      }
    },
    {
      id: "checkpoint_grant_binding_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "ops_agent_substrate_fast_loop_checkpoint_grant_binding"
      }
    },
    {
      id: "work_order_metering_durability_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "pg_work_order_metering_durability"
      }
    },
    {
      id: "ns3_evidence_binding_coverage_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "ns3_evidence_binding_coverage_verified"
      }
    },
    {
      id: "sdk_acs_smoke_js_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "e2e_js_sdk_acs_substrate_smoke"
      }
    },
    {
      id: "sdk_acs_smoke_py_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "e2e_python_sdk_acs_substrate_smoke"
      }
    },
    {
      id: "sdk_python_contract_freeze_verified",
      status: "passed",
      ok: true,
      source: {
        type: "collaboration_check",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
        reportSchemaVersion: "NooterraVerifiedGateReport.v1",
        sourceCheckId: "e2e_python_sdk_contract_freeze"
      }
    }
  ];

  await writeJson(path.join(testsRoot, "parity", "offline-verification-parity-gate.json"), {
    schemaVersion: "OfflineVerificationParityGateReport.v1",
    verdict: { ok: true, requiredChecks: 1, passedChecks: 1 }
  });

  await writeJson(path.join(testsRoot, "onboarding", "onboarding-host-success-gate.json"), {
    schemaVersion: "OnboardingHostSuccessGateReport.v1",
    verdict: { ok: true, requiredHosts: 4, passedHosts: 4 }
  });
  await writeJson(path.join(testsRoot, "simulation", "simulation-scorecard-gate.json"), {
    schemaVersion: "NooterraSimulationScorecardGateReport.v1",
    strictOk: true,
    okWithWaiver: true,
    waiverApplied: false,
    summary: { runCount: 3, requiredChecks: 9, passedChecks: 9, failedChecks: 0, blockingIssueCount: 0 }
  });
  await writeJson(path.join(testsRoot, "simulation", "simulation-fault-matrix-report.json"), {
    schemaVersion: "NooterraSimulationFaultMatrixReport.v1",
    strictOk: true,
    checks: [],
    blockingIssues: [],
    matrix: {
      schemaVersion: "NooterraSimulationFaultMatrix.v1",
      summary: { totalFaults: 6, passedFaults: 6, failedFaults: 0 }
    }
  });
  await writeJson(path.join(testsRoot, "simulation", "simulation-high-scale-report.json"), {
    schemaVersion: "NooterraSimulationHighScaleHarnessReport.v1",
    strictOk: true,
    run: {
      schemaVersion: "NooterraSimulationHighScaleRun.v1",
      tier: "scale_10000",
      telemetry: { agentCount: 10000, actionCount: 10000, blockedActions: 0 }
    }
  });

  const collabGatePath = path.join(goLiveRoot, "s13", "nooterra-verified-collaboration-gate.json");
  await writeJson(collabGatePath, {
    schemaVersion: "NooterraVerifiedGateReport.v1",
    level: "collaboration",
    ok: true,
    summary: { totalChecks: 12, passedChecks: 12, failedChecks: 0 }
  });

  const collabGateRaw = await fs.readFile(collabGatePath, "utf8");
  const collabGateSha256 = createHash("sha256").update(collabGateRaw).digest("hex");

  await writeJson(path.join(goLiveRoot, "s13", "s13-go-live-gate.json"), {
    schemaVersion: "GoLiveGateReport.v1",
    verdict: { ok: true, requiredChecks: 1, passedChecks: 1 }
  });

  await writeJson(path.join(goLiveRoot, "s13", "s13-launch-cutover-packet.json"), {
    schemaVersion: "LaunchCutoverPacket.v1",
    sources: {
      nooterraVerifiedCollaborationGateReportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
      nooterraVerifiedCollaborationGateReportSha256: collabGateSha256
    },
    requiredCutoverChecks: {
      schemaVersion: "ProductionCutoverRequiredChecksSummary.v1",
      sourceReportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
      sourceReportSchemaVersion: "NooterraVerifiedGateReport.v1",
      sourceReportOk: true,
      checks: requiredCutoverChecks,
      summary: {
        requiredChecks: requiredCutoverChecks.length,
        passedChecks: requiredCutoverChecks.length,
        failedChecks: 0
      }
    },
    verdict: { ok: true, requiredChecks: 1, passedChecks: 1 }
  });

  await writeJson(path.join(releaseGateRoot, "ops", "hosted-baseline-release-gate.json"), {
    type: "HostedBaselineEvidence.v1",
    v: 1,
    status: "pass",
    failures: []
  });

  return { testsRoot, goLiveRoot, releaseGateRoot };
}

test("release promotion guard e2e: materialized upstream artifacts pass NOO-65 guard", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-promotion-e2e-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const roots = await seedPromotionGuardUpstreamArtifacts(tmpRoot);

  const materialize = runNodeScript(
    "scripts/ci/materialize-release-promotion-guard-inputs.mjs",
    [
      "--tests-root",
      roots.testsRoot,
      "--go-live-root",
      roots.goLiveRoot,
      "--release-gate-root",
      roots.releaseGateRoot,
      "--report",
      "artifacts/gates/release-promotion-guard-input-materialization.json"
    ],
    { cwd: tmpRoot }
  );

  assert.equal(
    materialize.status,
    0,
    `materialization expected success\nstdout:\n${materialize.stdout}\n\nstderr:\n${materialize.stderr}`
  );

  const materializationReport = JSON.parse(
    await fs.readFile(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard-input-materialization.json"), "utf8")
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard-input-materialization.json"),
    "pass-release-promotion-guard-input-materialization.json"
  );
  assert.equal(materializationReport.verdict.ok, true);
  assert.equal(materializationReport.verdict.failedFiles, 0);

  const promotionGuard = runNodeScript(
    "scripts/ci/run-release-promotion-guard.mjs",
    [
      "--kernel-gate",
      "artifacts/gates/kernel-v0-ship-gate.json",
      "--production-gate",
      "artifacts/gates/production-cutover-gate.json",
      "--offline-parity-gate",
      "artifacts/gates/offline-verification-parity-gate.json",
      "--onboarding-host-success-gate",
      "artifacts/gates/onboarding-host-success-gate.json",
      "--go-live-gate",
      "artifacts/gates/s13-go-live-gate.json",
      "--launch-packet",
      "artifacts/gates/s13-launch-cutover-packet.json",
      "--baseline-evidence",
      "artifacts/ops/hosted-baseline-release-gate.json",
      "--promotion-ref",
      "commit_e2e_release_promotion_guard",
      "--now",
      "2026-02-25T18:30:00.000Z",
      "--report",
      "artifacts/gates/release-promotion-guard.json"
    ],
    { cwd: tmpRoot }
  );

  assert.equal(
    promotionGuard.status,
    0,
    `promotion guard expected success\nstdout:\n${promotionGuard.stdout}\n\nstderr:\n${promotionGuard.stderr}`
  );
  await exportE2eArtifact(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "pass-release-promotion-guard.json");

  const guardReport = JSON.parse(await fs.readFile(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "utf8"));
  assert.equal(guardReport.schemaVersion, "ReleasePromotionGuardReport.v1");
  assert.equal(guardReport.verdict.ok, true);
  assert.equal(guardReport.verdict.status, "pass");

  const bindingCheck = Array.isArray(guardReport.bindingChecks)
    ? guardReport.bindingChecks.find((row) => row.id === "launch_packet_nooterra_verified_collaboration_binding")
    : null;
  assert.ok(bindingCheck, "expected launch packet collaboration binding check row");
  assert.equal(bindingCheck.ok, true);

  const launchPacketArtifact = Array.isArray(guardReport.artifacts)
    ? guardReport.artifacts.find((row) => row.id === "launch_cutover_packet")
    : null;
  assert.ok(launchPacketArtifact, "expected launch_cutover_packet artifact row");
  assert.equal(launchPacketArtifact.status, "passed");
});

test("release promotion guard e2e: tampered launch packet collaboration binding fails closed", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-promotion-e2e-tamper-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const roots = await seedPromotionGuardUpstreamArtifacts(tmpRoot);
  await writeJson(path.join(roots.goLiveRoot, "s13", "s13-launch-cutover-packet.json"), {
    schemaVersion: "LaunchCutoverPacket.v1",
    sources: {
      nooterraVerifiedCollaborationGateReportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
      nooterraVerifiedCollaborationGateReportSha256: "0".repeat(64)
    },
    verdict: { ok: true, requiredChecks: 1, passedChecks: 1 }
  });

  const materialize = runNodeScript(
    "scripts/ci/materialize-release-promotion-guard-inputs.mjs",
    [
      "--tests-root",
      roots.testsRoot,
      "--go-live-root",
      roots.goLiveRoot,
      "--release-gate-root",
      roots.releaseGateRoot,
      "--report",
      "artifacts/gates/release-promotion-guard-input-materialization.json"
    ],
    { cwd: tmpRoot }
  );
  assert.equal(
    materialize.status,
    0,
    `materialization expected success\nstdout:\n${materialize.stdout}\n\nstderr:\n${materialize.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard-input-materialization.json"),
    "tamper-release-promotion-guard-input-materialization.json"
  );

  const promotionGuard = runNodeScript(
    "scripts/ci/run-release-promotion-guard.mjs",
    [
      "--kernel-gate",
      "artifacts/gates/kernel-v0-ship-gate.json",
      "--production-gate",
      "artifacts/gates/production-cutover-gate.json",
      "--offline-parity-gate",
      "artifacts/gates/offline-verification-parity-gate.json",
      "--onboarding-host-success-gate",
      "artifacts/gates/onboarding-host-success-gate.json",
      "--go-live-gate",
      "artifacts/gates/s13-go-live-gate.json",
      "--launch-packet",
      "artifacts/gates/s13-launch-cutover-packet.json",
      "--baseline-evidence",
      "artifacts/ops/hosted-baseline-release-gate.json",
      "--promotion-ref",
      "commit_e2e_release_promotion_guard_tampered",
      "--now",
      "2026-02-25T18:31:00.000Z",
      "--report",
      "artifacts/gates/release-promotion-guard.json"
    ],
    { cwd: tmpRoot }
  );

  assert.equal(
    promotionGuard.status,
    1,
    `promotion guard expected fail-closed exit\nstdout:\n${promotionGuard.stdout}\n\nstderr:\n${promotionGuard.stderr}`
  );
  await exportE2eArtifact(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "tamper-release-promotion-guard.json");

  const guardReport = JSON.parse(await fs.readFile(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "utf8"));
  assert.equal(guardReport.schemaVersion, "ReleasePromotionGuardReport.v1");
  assert.equal(guardReport.verdict.ok, false);
  assert.equal(guardReport.verdict.status, "fail");

  const bindingCheck = Array.isArray(guardReport.bindingChecks)
    ? guardReport.bindingChecks.find((row) => row.id === "launch_packet_nooterra_verified_collaboration_binding")
    : null;
  assert.ok(bindingCheck, "expected launch packet collaboration binding check row");
  assert.equal(bindingCheck.ok, false);
  assert.equal(Array.isArray(bindingCheck.failureCodes) && bindingCheck.failureCodes.includes("binding_source_sha_mismatch"), true);

  const launchPacketArtifact = Array.isArray(guardReport.artifacts)
    ? guardReport.artifacts.find((row) => row.id === "launch_cutover_packet")
    : null;
  assert.ok(launchPacketArtifact, "expected launch_cutover_packet artifact row");
  assert.equal(launchPacketArtifact.status, "failed");
  assert.equal(Array.isArray(launchPacketArtifact.failureCodes) && launchPacketArtifact.failureCodes.includes("binding_source_sha_mismatch"), true);
});

test("release promotion guard e2e: production gate collaboration report path mismatch fails closed", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-promotion-e2e-path-mismatch-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const roots = await seedPromotionGuardUpstreamArtifacts(tmpRoot);
  await writeJson(path.join(roots.testsRoot, "production", "production-cutover-gate.json"), {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true, requiredChecks: 10, passedChecks: 10 },
    checks: [
      {
        id: "nooterra_verified_collaboration",
        status: "passed",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate-v2.json"
      },
      {
        id: "openclaw_substrate_demo_lineage_verified",
        status: "passed"
      },
      {
        id: "openclaw_substrate_demo_transcript_verified",
        status: "passed"
      },
      {
        id: "session_stream_conformance_verified",
        status: "passed"
      },
      {
        id: "settlement_dispute_arbitration_lifecycle_verified",
        status: "passed"
      },
      {
        id: "checkpoint_grant_binding_verified",
        status: "passed"
      },
      {
        id: "work_order_metering_durability_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_js_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_py_verified",
        status: "passed"
      },
      {
        id: "sdk_python_contract_freeze_verified",
        status: "passed"
      }
    ]
  });

  const materialize = runNodeScript(
    "scripts/ci/materialize-release-promotion-guard-inputs.mjs",
    [
      "--tests-root",
      roots.testsRoot,
      "--go-live-root",
      roots.goLiveRoot,
      "--release-gate-root",
      roots.releaseGateRoot,
      "--report",
      "artifacts/gates/release-promotion-guard-input-materialization.json"
    ],
    { cwd: tmpRoot }
  );
  assert.equal(
    materialize.status,
    0,
    `materialization expected success\nstdout:\n${materialize.stdout}\n\nstderr:\n${materialize.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard-input-materialization.json"),
    "path-mismatch-release-promotion-guard-input-materialization.json"
  );

  const promotionGuard = runNodeScript(
    "scripts/ci/run-release-promotion-guard.mjs",
    [
      "--kernel-gate",
      "artifacts/gates/kernel-v0-ship-gate.json",
      "--production-gate",
      "artifacts/gates/production-cutover-gate.json",
      "--offline-parity-gate",
      "artifacts/gates/offline-verification-parity-gate.json",
      "--onboarding-host-success-gate",
      "artifacts/gates/onboarding-host-success-gate.json",
      "--go-live-gate",
      "artifacts/gates/s13-go-live-gate.json",
      "--launch-packet",
      "artifacts/gates/s13-launch-cutover-packet.json",
      "--baseline-evidence",
      "artifacts/ops/hosted-baseline-release-gate.json",
      "--promotion-ref",
      "commit_e2e_release_promotion_guard_path_mismatch",
      "--now",
      "2026-02-25T18:32:00.000Z",
      "--report",
      "artifacts/gates/release-promotion-guard.json"
    ],
    { cwd: tmpRoot }
  );

  assert.equal(
    promotionGuard.status,
    1,
    `promotion guard expected fail-closed exit\nstdout:\n${promotionGuard.stdout}\n\nstderr:\n${promotionGuard.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"),
    "path-mismatch-release-promotion-guard.json"
  );

  const guardReport = JSON.parse(await fs.readFile(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "utf8"));
  assert.equal(guardReport.schemaVersion, "ReleasePromotionGuardReport.v1");
  assert.equal(guardReport.verdict.ok, false);
  assert.equal(guardReport.verdict.status, "fail");

  const bindingCheck = Array.isArray(guardReport.bindingChecks)
    ? guardReport.bindingChecks.find((row) => row.id === "launch_packet_nooterra_verified_collaboration_binding")
    : null;
  assert.ok(bindingCheck, "expected launch packet collaboration binding check row");
  assert.equal(bindingCheck.ok, false);
  assert.equal(
    Array.isArray(bindingCheck.failureCodes) && bindingCheck.failureCodes.includes("production_gate_binding_path_mismatch"),
    true
  );

  const launchPacketArtifact = Array.isArray(guardReport.artifacts)
    ? guardReport.artifacts.find((row) => row.id === "launch_cutover_packet")
    : null;
  assert.ok(launchPacketArtifact, "expected launch_cutover_packet artifact row");
  assert.equal(launchPacketArtifact.status, "failed");
  assert.equal(
    Array.isArray(launchPacketArtifact.failureCodes) && launchPacketArtifact.failureCodes.includes("production_gate_binding_path_mismatch"),
    true
  );
});

test("release promotion guard e2e: production gate collaboration check not passed fails closed", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-promotion-e2e-check-not-passed-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const roots = await seedPromotionGuardUpstreamArtifacts(tmpRoot);
  await writeJson(path.join(roots.testsRoot, "production", "production-cutover-gate.json"), {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true, requiredChecks: 10, passedChecks: 9 },
    checks: [
      {
        id: "nooterra_verified_collaboration",
        status: "failed",
        reportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json"
      },
      {
        id: "openclaw_substrate_demo_lineage_verified",
        status: "passed"
      },
      {
        id: "openclaw_substrate_demo_transcript_verified",
        status: "passed"
      },
      {
        id: "session_stream_conformance_verified",
        status: "passed"
      },
      {
        id: "settlement_dispute_arbitration_lifecycle_verified",
        status: "passed"
      },
      {
        id: "checkpoint_grant_binding_verified",
        status: "passed"
      },
      {
        id: "work_order_metering_durability_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_js_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_py_verified",
        status: "passed"
      },
      {
        id: "sdk_python_contract_freeze_verified",
        status: "passed"
      }
    ]
  });

  const materialize = runNodeScript(
    "scripts/ci/materialize-release-promotion-guard-inputs.mjs",
    [
      "--tests-root",
      roots.testsRoot,
      "--go-live-root",
      roots.goLiveRoot,
      "--release-gate-root",
      roots.releaseGateRoot,
      "--report",
      "artifacts/gates/release-promotion-guard-input-materialization.json"
    ],
    { cwd: tmpRoot }
  );
  assert.equal(
    materialize.status,
    0,
    `materialization expected success\nstdout:\n${materialize.stdout}\n\nstderr:\n${materialize.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard-input-materialization.json"),
    "check-not-passed-release-promotion-guard-input-materialization.json"
  );

  const promotionGuard = runNodeScript(
    "scripts/ci/run-release-promotion-guard.mjs",
    [
      "--kernel-gate",
      "artifacts/gates/kernel-v0-ship-gate.json",
      "--production-gate",
      "artifacts/gates/production-cutover-gate.json",
      "--offline-parity-gate",
      "artifacts/gates/offline-verification-parity-gate.json",
      "--onboarding-host-success-gate",
      "artifacts/gates/onboarding-host-success-gate.json",
      "--go-live-gate",
      "artifacts/gates/s13-go-live-gate.json",
      "--launch-packet",
      "artifacts/gates/s13-launch-cutover-packet.json",
      "--baseline-evidence",
      "artifacts/ops/hosted-baseline-release-gate.json",
      "--promotion-ref",
      "commit_e2e_release_promotion_guard_check_not_passed",
      "--now",
      "2026-02-25T18:33:00.000Z",
      "--report",
      "artifacts/gates/release-promotion-guard.json"
    ],
    { cwd: tmpRoot }
  );

  assert.equal(
    promotionGuard.status,
    1,
    `promotion guard expected fail-closed exit\nstdout:\n${promotionGuard.stdout}\n\nstderr:\n${promotionGuard.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"),
    "check-not-passed-release-promotion-guard.json"
  );

  const guardReport = JSON.parse(await fs.readFile(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "utf8"));
  assert.equal(guardReport.schemaVersion, "ReleasePromotionGuardReport.v1");
  assert.equal(guardReport.verdict.ok, false);
  assert.equal(guardReport.verdict.status, "fail");

  const bindingCheck = Array.isArray(guardReport.bindingChecks)
    ? guardReport.bindingChecks.find((row) => row.id === "launch_packet_nooterra_verified_collaboration_binding")
    : null;
  assert.ok(bindingCheck, "expected launch packet collaboration binding check row");
  assert.equal(bindingCheck.ok, false);
  assert.equal(
    Array.isArray(bindingCheck.failureCodes) && bindingCheck.failureCodes.includes("production_gate_binding_check_not_passed"),
    true
  );

  const launchPacketArtifact = Array.isArray(guardReport.artifacts)
    ? guardReport.artifacts.find((row) => row.id === "launch_cutover_packet")
    : null;
  assert.ok(launchPacketArtifact, "expected launch_cutover_packet artifact row");
  assert.equal(launchPacketArtifact.status, "failed");
  assert.equal(
    Array.isArray(launchPacketArtifact.failureCodes) && launchPacketArtifact.failureCodes.includes("production_gate_binding_check_not_passed"),
    true
  );
});

test("release promotion guard e2e: production gate collaboration check missing fails closed", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-promotion-e2e-check-missing-"));
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const roots = await seedPromotionGuardUpstreamArtifacts(tmpRoot);
  await writeJson(path.join(roots.testsRoot, "production", "production-cutover-gate.json"), {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true, requiredChecks: 10, passedChecks: 9 },
    checks: [
      {
        id: "mcp_host_runtime_smoke",
        status: "passed"
      },
      {
        id: "openclaw_substrate_demo_lineage_verified",
        status: "passed"
      },
      {
        id: "openclaw_substrate_demo_transcript_verified",
        status: "passed"
      },
      {
        id: "session_stream_conformance_verified",
        status: "passed"
      },
      {
        id: "settlement_dispute_arbitration_lifecycle_verified",
        status: "passed"
      },
      {
        id: "checkpoint_grant_binding_verified",
        status: "passed"
      },
      {
        id: "work_order_metering_durability_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_js_verified",
        status: "passed"
      },
      {
        id: "sdk_acs_smoke_py_verified",
        status: "passed"
      },
      {
        id: "sdk_python_contract_freeze_verified",
        status: "passed"
      }
    ]
  });

  const materialize = runNodeScript(
    "scripts/ci/materialize-release-promotion-guard-inputs.mjs",
    [
      "--tests-root",
      roots.testsRoot,
      "--go-live-root",
      roots.goLiveRoot,
      "--release-gate-root",
      roots.releaseGateRoot,
      "--report",
      "artifacts/gates/release-promotion-guard-input-materialization.json"
    ],
    { cwd: tmpRoot }
  );
  assert.equal(
    materialize.status,
    0,
    `materialization expected success\nstdout:\n${materialize.stdout}\n\nstderr:\n${materialize.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard-input-materialization.json"),
    "check-missing-release-promotion-guard-input-materialization.json"
  );

  const promotionGuard = runNodeScript(
    "scripts/ci/run-release-promotion-guard.mjs",
    [
      "--kernel-gate",
      "artifacts/gates/kernel-v0-ship-gate.json",
      "--production-gate",
      "artifacts/gates/production-cutover-gate.json",
      "--offline-parity-gate",
      "artifacts/gates/offline-verification-parity-gate.json",
      "--onboarding-host-success-gate",
      "artifacts/gates/onboarding-host-success-gate.json",
      "--go-live-gate",
      "artifacts/gates/s13-go-live-gate.json",
      "--launch-packet",
      "artifacts/gates/s13-launch-cutover-packet.json",
      "--baseline-evidence",
      "artifacts/ops/hosted-baseline-release-gate.json",
      "--promotion-ref",
      "commit_e2e_release_promotion_guard_check_missing",
      "--now",
      "2026-02-25T18:34:00.000Z",
      "--report",
      "artifacts/gates/release-promotion-guard.json"
    ],
    { cwd: tmpRoot }
  );

  assert.equal(
    promotionGuard.status,
    1,
    `promotion guard expected fail-closed exit\nstdout:\n${promotionGuard.stdout}\n\nstderr:\n${promotionGuard.stderr}`
  );
  await exportE2eArtifact(
    path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"),
    "check-missing-release-promotion-guard.json"
  );

  const guardReport = JSON.parse(await fs.readFile(path.join(tmpRoot, "artifacts", "gates", "release-promotion-guard.json"), "utf8"));
  assert.equal(guardReport.schemaVersion, "ReleasePromotionGuardReport.v1");
  assert.equal(guardReport.verdict.ok, false);
  assert.equal(guardReport.verdict.status, "fail");

  const bindingCheck = Array.isArray(guardReport.bindingChecks)
    ? guardReport.bindingChecks.find((row) => row.id === "launch_packet_nooterra_verified_collaboration_binding")
    : null;
  assert.ok(bindingCheck, "expected launch packet collaboration binding check row");
  assert.equal(bindingCheck.ok, false);
  assert.equal(
    Array.isArray(bindingCheck.failureCodes) && bindingCheck.failureCodes.includes("production_gate_binding_check_missing"),
    true
  );

  const launchPacketArtifact = Array.isArray(guardReport.artifacts)
    ? guardReport.artifacts.find((row) => row.id === "launch_cutover_packet")
    : null;
  assert.ok(launchPacketArtifact, "expected launch_cutover_packet artifact row");
  assert.equal(launchPacketArtifact.status, "failed");
  assert.equal(
    Array.isArray(launchPacketArtifact.failureCodes) && launchPacketArtifact.failureCodes.includes("production_gate_binding_check_missing"),
    true
  );
});

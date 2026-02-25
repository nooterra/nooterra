import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();

function runMaterialize(args = [], env = {}) {
  return spawnSync(process.execPath, ["scripts/ci/materialize-release-promotion-guard-inputs.mjs", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });
}

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedUpstreamArtifacts(root) {
  const testsRoot = path.join(root, "tests");
  const goLiveRoot = path.join(root, "go-live");
  const releaseGateRoot = path.join(root, "release-gate");

  await writeJson(path.join(testsRoot, "a", "kernel-v0-ship-gate.json"), {
    schemaVersion: "KernelV0ShipGateReport.v1",
    verdict: { ok: true }
  });
  await writeJson(path.join(testsRoot, "b", "production-cutover-gate.json"), {
    schemaVersion: "ProductionCutoverGateReport.v1",
    checks: [
      { id: "settld_verified_collaboration", status: "passed", reportPath: "artifacts/gates/settld-verified-collaboration-gate.json" },
      { id: "openclaw_substrate_demo_lineage_verified", status: "passed" },
      { id: "openclaw_substrate_demo_transcript_verified", status: "passed" }
    ],
    verdict: { ok: true }
  });
  await writeJson(path.join(testsRoot, "c", "offline-verification-parity-gate.json"), {
    schemaVersion: "OfflineVerificationParityGateReport.v1",
    verdict: { ok: true }
  });
  await writeJson(path.join(testsRoot, "d", "onboarding-host-success-gate.json"), {
    schemaVersion: "OnboardingHostSuccessGateReport.v1",
    verdict: { ok: true }
  });

  await writeJson(path.join(goLiveRoot, "a", "s13-go-live-gate.json"), {
    schemaVersion: "GoLiveGateReport.v1",
    verdict: { ok: true }
  });
  await writeJson(path.join(goLiveRoot, "a", "s13-launch-cutover-packet.json"), {
    schemaVersion: "LaunchCutoverPacket.v1",
    sources: {
      settldVerifiedCollaborationGateReportPath: "artifacts/gates/settld-verified-collaboration-gate.json"
    },
    verdict: { ok: true }
  });
  await writeJson(path.join(goLiveRoot, "a", "settld-verified-collaboration-gate.json"), {
    schemaVersion: "SettldVerifiedGateReport.v1",
    level: "collaboration",
    ok: true,
    summary: { totalChecks: 1, passedChecks: 1, failedChecks: 0 }
  });

  await writeJson(path.join(releaseGateRoot, "x", "hosted-baseline-release-gate.json"), {
    type: "HostedBaselineEvidence.v1",
    v: 1,
    status: "pass",
    failures: []
  });

  return { testsRoot, goLiveRoot, releaseGateRoot };
}

test("release promotion input materialization: copies required artifacts and emits pass report", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-materialize-pass-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const roots = await seedUpstreamArtifacts(path.join(tmpDir, "upstream"));
  const reportPath = path.join(tmpDir, "artifacts", "gates", "release-promotion-guard-input-materialization.json");

  const result = runMaterialize([
    "--tests-root",
    roots.testsRoot,
    "--go-live-root",
    roots.goLiveRoot,
    "--release-gate-root",
    roots.releaseGateRoot,
    "--report",
    reportPath
  ]);

  assert.equal(result.status, 0, `expected success\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.schemaVersion, "ReleasePromotionGuardInputMaterializationReport.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.verdict.failedFiles, 0);
  assert.equal(Array.isArray(report.files), true);
  assert.equal(report.files.length, 8);
  for (const row of report.files) {
    assert.equal(row.status, "passed");
    assert.match(String(row.sourceSha256 ?? ""), /^[a-f0-9]{64}$/);
    assert.match(String(row.destinationSha256 ?? ""), /^[a-f0-9]{64}$/);
    assert.equal(row.sourceSha256, row.destinationSha256);
    const copied = await fs.readFile(row.destinationPath, "utf8");
    assert.ok(copied.length > 0);
  }
});

test("release promotion input materialization: fails closed when required artifact is missing", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-materialize-missing-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const roots = await seedUpstreamArtifacts(path.join(tmpDir, "upstream"));
  await fs.rm(path.join(roots.goLiveRoot, "a", "settld-verified-collaboration-gate.json"), { force: true });

  const reportPath = path.join(tmpDir, "artifacts", "gates", "release-promotion-guard-input-materialization.json");
  const result = runMaterialize([
    "--tests-root",
    roots.testsRoot,
    "--go-live-root",
    roots.goLiveRoot,
    "--release-gate-root",
    roots.releaseGateRoot,
    "--report",
    reportPath
  ]);

  assert.equal(result.status, 1, `expected fail-closed\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.verdict.ok, false);
  const missing = report.files.find((row) => row.id === "settld_verified_collaboration_gate");
  assert.ok(missing);
  assert.equal(missing.status, "failed");
  assert.equal(missing.failureCodes.includes("artifact_missing"), true);
});

test("release promotion input materialization: fails closed when required artifact is ambiguous", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-materialize-ambiguous-"));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const roots = await seedUpstreamArtifacts(path.join(tmpDir, "upstream"));
  await writeJson(path.join(roots.testsRoot, "duplicate", "kernel-v0-ship-gate.json"), {
    schemaVersion: "KernelV0ShipGateReport.v1",
    verdict: { ok: true }
  });

  const reportPath = path.join(tmpDir, "artifacts", "gates", "release-promotion-guard-input-materialization.json");
  const result = runMaterialize([
    "--tests-root",
    roots.testsRoot,
    "--go-live-root",
    roots.goLiveRoot,
    "--release-gate-root",
    roots.releaseGateRoot,
    "--report",
    reportPath
  ]);

  assert.equal(result.status, 1, `expected fail-closed\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.verdict.ok, false);
  const ambiguous = report.files.find((row) => row.id === "kernel_v0_ship_gate");
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, "failed");
  assert.equal(ambiguous.failureCodes.includes("artifact_ambiguous"), true);
});

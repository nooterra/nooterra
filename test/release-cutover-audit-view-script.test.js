import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCutoverAuditView, parseArgs } from "../scripts/release/build-cutover-audit-view.mjs";

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredCheckRows(statusesById) {
  const ids = [
    "nooterra_verified_collaboration",
    "openclaw_substrate_demo_lineage_verified",
    "openclaw_substrate_demo_transcript_verified",
    "checkpoint_grant_binding_verified",
    "work_order_metering_durability_verified",
    "sdk_acs_smoke_js_verified",
    "sdk_acs_smoke_py_verified",
    "sdk_python_contract_freeze_verified"
  ];
  return ids.map((id) => ({ id, status: statusesById[id] ?? "failed" }));
}

async function seedInputs(root, { launchOverrides } = {}) {
  const productionGatePath = path.join(root, "artifacts/gates/production-cutover-gate.json");
  const requiredChecksPath = path.join(root, "artifacts/gates/production-cutover-required-checks.json");
  const launchPacketPath = path.join(root, "artifacts/gates/s13-launch-cutover-packet.json");
  const outPath = path.join(root, "artifacts/gates/release-cutover-audit-view.json");

  const statusesById = {
    nooterra_verified_collaboration: "passed",
    openclaw_substrate_demo_lineage_verified: "passed",
    openclaw_substrate_demo_transcript_verified: "passed",
    checkpoint_grant_binding_verified: "passed",
    work_order_metering_durability_verified: "passed",
    sdk_acs_smoke_js_verified: "passed",
    sdk_acs_smoke_py_verified: "passed",
    sdk_python_contract_freeze_verified: "passed"
  };

  await writeJson(productionGatePath, {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true, requiredChecks: 8, passedChecks: 8 },
    checks: requiredCheckRows(statusesById)
  });

  await writeJson(requiredChecksPath, {
    schemaVersion: "ProductionCutoverRequiredChecksAssertion.v1",
    ok: true,
    summary: { requiredChecks: 8, passedChecks: 8, failedChecks: 0 },
    checks: requiredCheckRows(statusesById).map((row) => ({ ...row, ok: row.status === "passed" }))
  });

  const launchPacket = {
    schemaVersion: "LaunchCutoverPacket.v1",
    requiredCutoverChecks: {
      schemaVersion: "ProductionCutoverRequiredChecksSummary.v1",
      sourceReportPath: "artifacts/gates/nooterra-verified-collaboration-gate.json",
      sourceReportSchemaVersion: "NooterraVerifiedGateReport.v1",
      sourceReportOk: true,
      checks: requiredCheckRows(statusesById).map((row) => ({ ...row, ok: row.status === "passed" })),
      summary: { requiredChecks: 8, passedChecks: 8, failedChecks: 0 }
    },
    verdict: { ok: true, requiredChecks: 1, passedChecks: 1 }
  };
  await writeJson(launchPacketPath, launchOverrides ? { ...launchPacket, ...launchOverrides(launchPacket) } : launchPacket);

  return { productionGatePath, requiredChecksPath, launchPacketPath, outPath };
}

test("release cutover audit view parser: supports explicit args", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(
    [
      "--production-gate",
      "artifacts/gates/production-cutover-gate.json",
      "--required-checks",
      "artifacts/gates/production-cutover-required-checks.json",
      "--launch-packet",
      "artifacts/gates/s13-launch-cutover-packet.json",
      "--out",
      "artifacts/gates/release-cutover-audit-view.json",
      "--now",
      "2026-02-26T00:00:00.000Z"
    ],
    {},
    cwd
  );

  assert.equal(args.productionGatePath, path.resolve(cwd, "artifacts/gates/production-cutover-gate.json"));
  assert.equal(args.requiredChecksPath, path.resolve(cwd, "artifacts/gates/production-cutover-required-checks.json"));
  assert.equal(args.launchPacketPath, path.resolve(cwd, "artifacts/gates/s13-launch-cutover-packet.json"));
  assert.equal(args.outPath, path.resolve(cwd, "artifacts/gates/release-cutover-audit-view.json"));
  assert.equal(args.nowIso, "2026-02-26T00:00:00.000Z");
});

test("release cutover audit view: passes when all sources agree and are passed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-cutover-audit-pass-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const paths = await seedInputs(root);

  const report = await buildCutoverAuditView({
    productionGatePath: paths.productionGatePath,
    requiredChecksPath: paths.requiredChecksPath,
    launchPacketPath: paths.launchPacketPath,
    outPath: paths.outPath,
    nowIso: "2026-02-26T01:00:00.000Z"
  });

  assert.equal(report.schemaVersion, "ReleaseCutoverAuditView.v1");
  assert.equal(report.verdict.ok, true);
  assert.equal(report.verdict.status, "pass");
  assert.equal(report.summary.requiredChecks, 8);
  assert.equal(report.summary.passedChecks, 8);
  assert.equal(report.summary.failedChecks, 0);
  assert.equal(report.requiredChecks.every((row) => row.ok === true), true);
});

test("release cutover audit view: fails closed on launch summary status mismatch", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-cutover-audit-mismatch-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const paths = await seedInputs(root, {
    launchOverrides: (packet) => ({
      requiredCutoverChecks: {
        ...packet.requiredCutoverChecks,
        checks: packet.requiredCutoverChecks.checks.map((row) =>
          row.id === "sdk_python_contract_freeze_verified" ? { ...row, status: "failed", ok: false } : row
        ),
        summary: { requiredChecks: 8, passedChecks: 7, failedChecks: 1 }
      }
    })
  });

  const report = await buildCutoverAuditView({
    productionGatePath: paths.productionGatePath,
    requiredChecksPath: paths.requiredChecksPath,
    launchPacketPath: paths.launchPacketPath,
    outPath: paths.outPath,
    nowIso: "2026-02-26T01:00:00.000Z"
  });

  assert.equal(report.verdict.ok, false);
  assert.equal(report.verdict.status, "fail");
  const row = report.requiredChecks.find((check) => check.id === "sdk_python_contract_freeze_verified");
  assert.ok(row);
  assert.equal(row.parityOk, false);
  assert.equal(row.failureCodes.includes("status_mismatch"), true);
});

test("release cutover audit view: fails closed when launch packet is missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-release-cutover-audit-missing-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const paths = await seedInputs(root);
  await fs.rm(paths.launchPacketPath, { force: true });

  const report = await buildCutoverAuditView({
    productionGatePath: paths.productionGatePath,
    requiredChecksPath: paths.requiredChecksPath,
    launchPacketPath: paths.launchPacketPath,
    outPath: paths.outPath,
    nowIso: "2026-02-26T01:00:00.000Z"
  });

  assert.equal(report.verdict.ok, false);
  assert.equal(report.verdict.status, "fail");
  const loadIssue = report.blockingIssues.find((issue) => issue.id === "launch_packet_load");
  assert.ok(loadIssue);
  assert.equal(loadIssue.code, "file_missing");
});

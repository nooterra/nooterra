import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertProductionCutoverRequiredChecks,
  parseArgs
} from "../scripts/ci/assert-production-cutover-required-checks.mjs";

async function writeJson(pathname, value) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("production cutover required checks parser: defaults and explicit checks", () => {
  const cwd = "/tmp/nooterra";
  const defaults = parseArgs([], {}, cwd);
  assert.deepEqual(defaults.requiredCheckIds, [
    "nooterra_verified_collaboration",
    "openclaw_substrate_demo_lineage_verified",
    "openclaw_substrate_demo_transcript_verified",
    "session_stream_conformance_verified",
    "settlement_dispute_arbitration_lifecycle_verified",
    "checkpoint_grant_binding_verified",
    "work_order_metering_durability_verified",
    "ns3_evidence_binding_coverage_verified",
    "sdk_acs_smoke_js_verified",
    "sdk_acs_smoke_py_verified",
    "sdk_python_contract_freeze_verified"
  ]);

  const args = parseArgs(
    ["--in", "artifacts/gates/prod.json", "--required-check", "check_a", "--required-check", "check_b"],
    {},
    cwd
  );
  assert.equal(args.inputPath, path.resolve(cwd, "artifacts/gates/prod.json"));
  assert.deepEqual(args.requiredCheckIds, ["check_a", "check_b"]);
});

test("production cutover required checks: passes when collaboration, lineage, transcript, session stream conformance, settlement/dispute lifecycle, checkpoint binding, metering durability, ns3 evidence coverage, sdk smokes, and Python contract freeze are present and passed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-prod-required-checks-pass-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const inputPath = path.join(root, "artifacts", "gates", "production-cutover-gate.json");
  const outPath = path.join(root, "artifacts", "gates", "production-cutover-required-checks.json");
  await writeJson(inputPath, {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true },
    checks: [
      { id: "nooterra_verified_collaboration", status: "passed" },
      { id: "openclaw_substrate_demo_lineage_verified", status: "passed" },
      { id: "openclaw_substrate_demo_transcript_verified", status: "passed" },
      { id: "session_stream_conformance_verified", status: "passed" },
      { id: "settlement_dispute_arbitration_lifecycle_verified", status: "passed" },
      { id: "checkpoint_grant_binding_verified", status: "passed" },
      { id: "work_order_metering_durability_verified", status: "passed" },
      { id: "ns3_evidence_binding_coverage_verified", status: "passed" },
      { id: "sdk_acs_smoke_js_verified", status: "passed" },
      { id: "sdk_acs_smoke_py_verified", status: "passed" },
      { id: "sdk_python_contract_freeze_verified", status: "passed" }
    ]
  });

  const report = await assertProductionCutoverRequiredChecks({
    inputPath,
    jsonOutPath: outPath,
    requiredCheckIds: [
      "nooterra_verified_collaboration",
      "openclaw_substrate_demo_lineage_verified",
      "openclaw_substrate_demo_transcript_verified",
      "session_stream_conformance_verified",
      "settlement_dispute_arbitration_lifecycle_verified",
      "checkpoint_grant_binding_verified",
      "work_order_metering_durability_verified",
      "ns3_evidence_binding_coverage_verified",
      "sdk_acs_smoke_js_verified",
      "sdk_acs_smoke_py_verified",
      "sdk_python_contract_freeze_verified"
    ]
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.requiredChecks, 11);
  assert.equal(report.summary.passedChecks, 11);
  assert.equal(report.summary.failedChecks, 0);
  assert.equal(report.gateChecks.length, 1);
  assert.equal(report.gateChecks[0].id, "acs_critical_path_checks_present");
  assert.equal(report.gateChecks[0].ok, true);
  assert.deepEqual(report.gateChecks[0].details.missingCheckIds, []);

  const written = JSON.parse(await fs.readFile(outPath, "utf8"));
  assert.equal(written.schemaVersion, "ProductionCutoverRequiredChecksAssertion.v1");
  assert.equal(written.ok, true);
});

test("production cutover required checks: fails closed when ns3 evidence binding coverage check is missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-prod-required-checks-missing-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const inputPath = path.join(root, "artifacts", "gates", "production-cutover-gate.json");
  await writeJson(inputPath, {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true },
    checks: [{ id: "nooterra_verified_collaboration", status: "passed" }]
  });

  const report = await assertProductionCutoverRequiredChecks({
    inputPath,
    jsonOutPath: null,
    requiredCheckIds: [
      "nooterra_verified_collaboration",
      "openclaw_substrate_demo_lineage_verified",
      "openclaw_substrate_demo_transcript_verified",
      "session_stream_conformance_verified",
      "settlement_dispute_arbitration_lifecycle_verified",
      "checkpoint_grant_binding_verified",
      "work_order_metering_durability_verified",
      "ns3_evidence_binding_coverage_verified",
      "sdk_acs_smoke_js_verified",
      "sdk_acs_smoke_py_verified",
      "sdk_python_contract_freeze_verified"
    ]
  });
  assert.equal(report.ok, false);
  const ns3Coverage = report.checks.find((row) => row.id === "ns3_evidence_binding_coverage_verified");
  assert.ok(ns3Coverage);
  assert.equal(ns3Coverage.present, false);
  assert.equal(ns3Coverage.failureCode, "required_check_missing");
  assert.equal(report.gateChecks[0].id, "acs_critical_path_checks_present");
  assert.equal(report.gateChecks[0].ok, false);
  assert.equal(report.gateChecks[0].failureCode, "acs_critical_path_check_missing");
  assert.deepEqual(report.gateChecks[0].details.missingCheckIds, ["sdk_acs_smoke_js_verified", "sdk_acs_smoke_py_verified"]);
  assert.equal(report.failureCodes.includes("acs_critical_path_check_missing"), true);
  assert.equal(report.blockingIssues.some((issue) => issue.code === "acs_critical_path_check_missing"), true);
});

test("production cutover required checks: fails closed when required ACS critical-path checks are missing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-prod-required-checks-acs-missing-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const inputPath = path.join(root, "artifacts", "gates", "production-cutover-gate.json");
  await writeJson(inputPath, {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true },
    checks: [
      { id: "nooterra_verified_collaboration", status: "passed" },
      { id: "openclaw_substrate_demo_lineage_verified", status: "passed" },
      { id: "openclaw_substrate_demo_transcript_verified", status: "passed" },
      { id: "session_stream_conformance_verified", status: "passed" },
      { id: "settlement_dispute_arbitration_lifecycle_verified", status: "passed" },
      { id: "checkpoint_grant_binding_verified", status: "passed" },
      { id: "work_order_metering_durability_verified", status: "passed" },
      { id: "ns3_evidence_binding_coverage_verified", status: "passed" },
      { id: "sdk_acs_smoke_js_verified", status: "passed" },
      { id: "sdk_python_contract_freeze_verified", status: "passed" }
    ]
  });

  const report = await assertProductionCutoverRequiredChecks({
    inputPath,
    jsonOutPath: null,
    requiredCheckIds: [
      "nooterra_verified_collaboration",
      "openclaw_substrate_demo_lineage_verified",
      "openclaw_substrate_demo_transcript_verified",
      "session_stream_conformance_verified",
      "settlement_dispute_arbitration_lifecycle_verified",
      "checkpoint_grant_binding_verified",
      "work_order_metering_durability_verified",
      "ns3_evidence_binding_coverage_verified",
      "sdk_acs_smoke_js_verified",
      "sdk_acs_smoke_py_verified",
      "sdk_python_contract_freeze_verified"
    ]
  });
  assert.equal(report.ok, false);
  assert.equal(report.gateChecks[0].id, "acs_critical_path_checks_present");
  assert.equal(report.gateChecks[0].ok, false);
  assert.equal(report.gateChecks[0].failureCode, "acs_critical_path_check_missing");
  assert.deepEqual(report.gateChecks[0].details.missingCheckIds, ["sdk_acs_smoke_py_verified"]);
  assert.equal(report.failureCodes.includes("acs_critical_path_check_missing"), true);
  assert.equal(report.blockingIssues.some((issue) => issue.checkId === "acs_critical_path_checks_present"), true);
});

test("production cutover required checks: appends markdown summary when GITHUB_STEP_SUMMARY is set", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-prod-required-checks-summary-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const inputPath = path.join(root, "artifacts", "gates", "production-cutover-gate.json");
  const summaryPath = path.join(root, "step-summary.md");
  await writeJson(inputPath, {
    schemaVersion: "ProductionCutoverGateReport.v1",
    verdict: { ok: true },
    checks: [
      { id: "nooterra_verified_collaboration", status: "passed" },
      { id: "openclaw_substrate_demo_lineage_verified", status: "failed" },
      { id: "openclaw_substrate_demo_transcript_verified", status: "passed" },
      { id: "session_stream_conformance_verified", status: "passed" },
      { id: "settlement_dispute_arbitration_lifecycle_verified", status: "passed" },
      { id: "checkpoint_grant_binding_verified", status: "passed" },
      { id: "work_order_metering_durability_verified", status: "passed" },
      { id: "ns3_evidence_binding_coverage_verified", status: "passed" },
      { id: "sdk_acs_smoke_js_verified", status: "passed" },
      { id: "sdk_acs_smoke_py_verified", status: "passed" },
      { id: "sdk_python_contract_freeze_verified", status: "passed" }
    ]
  });

  const prev = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  t.after(() => {
    if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = prev;
  });

  const report = await assertProductionCutoverRequiredChecks({
    inputPath,
    jsonOutPath: null,
    requiredCheckIds: [
      "nooterra_verified_collaboration",
      "openclaw_substrate_demo_lineage_verified",
      "openclaw_substrate_demo_transcript_verified",
      "session_stream_conformance_verified",
      "settlement_dispute_arbitration_lifecycle_verified",
      "checkpoint_grant_binding_verified",
      "work_order_metering_durability_verified",
      "ns3_evidence_binding_coverage_verified",
      "sdk_acs_smoke_js_verified",
      "sdk_acs_smoke_py_verified",
      "sdk_python_contract_freeze_verified"
    ]
  });
  assert.equal(report.ok, false);

  const markdown = await fs.readFile(summaryPath, "utf8");
  assert.match(markdown, /Production Cutover Required Checks/);
  assert.match(markdown, /openclaw_substrate_demo_lineage_verified/);
  assert.match(markdown, /openclaw_substrate_demo_transcript_verified/);
  assert.match(markdown, /session_stream_conformance_verified/);
  assert.match(markdown, /settlement_dispute_arbitration_lifecycle_verified/);
  assert.match(markdown, /checkpoint_grant_binding_verified/);
  assert.match(markdown, /work_order_metering_durability_verified/);
  assert.match(markdown, /ns3_evidence_binding_coverage_verified/);
  assert.match(markdown, /sdk_acs_smoke_js_verified/);
  assert.match(markdown, /sdk_acs_smoke_py_verified/);
  assert.match(markdown, /sdk_python_contract_freeze_verified/);
  assert.match(markdown, /\*\*FAIL\*\*/);
});

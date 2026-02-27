import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  evaluateNs3EvidenceBindingCoverageCheck,
  evaluateGateVerdict,
  evaluateCheckpointGrantBindingCheck,
  evaluateOpenclawSubstrateDemoLineageCheck,
  evaluateOpenclawSubstrateDemoTranscriptCheck,
  evaluateSessionStreamConformanceCheck,
  evaluateSettlementDisputeArbitrationLifecycleCheck,
  evaluateSdkAcsSmokeJsCheck,
  evaluateSdkAcsSmokePyCheck,
  evaluateSdkPythonContractFreezeCheck,
  evaluatePgSubstratePrimitivesDurabilityCheck,
  evaluatePgStateCheckpointDurabilityCheck,
  evaluateWorkOrderMeteringDurabilityCheck,
  buildBlockingIssues,
  parseArgs
} from "../scripts/ci/run-production-cutover-gate.mjs";

test("production cutover gate parser: uses env default report path", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs([], { PRODUCTION_CUTOVER_GATE_REPORT_PATH: "artifacts/custom-report.json" }, cwd);
  assert.equal(args.help, false);
  assert.equal(args.mode, "local");
  assert.equal(args.reportPath, path.resolve(cwd, "artifacts/custom-report.json"));
});

test("production cutover gate parser: allows explicit --report override", () => {
  const cwd = "/tmp/nooterra";
  const args = parseArgs(["--report", "artifacts/gates/override.json"], {}, cwd);
  assert.equal(args.reportPath, path.resolve(cwd, "artifacts/gates/override.json"));
});

test("production cutover gate parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
});

test("production cutover gate parser: validates live mode required args", () => {
  assert.throws(() => parseArgs(["--mode", "live"], {}, "/tmp/nooterra"), /--base-url is required/);

  const args = parseArgs(
    ["--mode", "live", "--base-url", "https://api.nooterra.work", "--tenant-id", "tenant_prod_gate", "--ops-token", "tok_ops", "--protocol", "1.0"],
    {},
    "/tmp/nooterra"
  );
  assert.equal(args.mode, "live");
  assert.equal(args.baseUrl, "https://api.nooterra.work");
  assert.equal(args.tenantId, "tenant_prod_gate");
  assert.equal(args.opsToken, "tok_ops");
  assert.equal(args.protocol, "1.0");
});

test("production cutover gate verdict: computes pass/fail counts from status rows", () => {
  const verdict = evaluateGateVerdict([
    { id: "a", status: "passed" },
    { id: "b", status: "failed" },
    { id: "c", status: "passed" }
  ]);

  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, "fail");
  assert.equal(verdict.requiredChecks, 3);
  assert.equal(verdict.passedChecks, 2);
  assert.equal(verdict.failedChecks, 1);
});

test("production cutover gate: derives openclaw lineage check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateOpenclawSubstrateDemoLineageCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "openclaw_substrate_demo_lineage_verified",
          ok: true,
          exitCode: 0,
          command: "derive e2e_openclaw_substrate_demo sessionLineageVerified"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "openclaw_substrate_demo_lineage_verified");
});

test("production cutover gate: derives openclaw lineage check fail-closed when source check is missing", () => {
  const evaluated = evaluateOpenclawSubstrateDemoLineageCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
});

test("production cutover gate: fails openclaw lineage check when collaboration report schema is invalid", () => {
  const evaluated = evaluateOpenclawSubstrateDemoLineageCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v0",
      ok: true,
      checks: [{ id: "openclaw_substrate_demo_lineage_verified", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.failureCode, "source_report_schema_invalid");
});

test("production cutover gate: fails openclaw lineage check when collaboration report top-level verdict is not ok", () => {
  const evaluated = evaluateOpenclawSubstrateDemoLineageCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: false,
      checks: [{ id: "openclaw_substrate_demo_lineage_verified", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.failureCode, "source_report_verdict_not_ok");
});

test("production cutover gate: derives openclaw transcript check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateOpenclawSubstrateDemoTranscriptCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "openclaw_substrate_demo_transcript_verified",
          ok: true,
          exitCode: 0,
          command: "derive e2e_openclaw_substrate_demo sessionTranscriptVerified"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "openclaw_substrate_demo_transcript_verified");
});

test("production cutover gate: derives openclaw transcript check fail-closed when source check is failed", () => {
  const evaluated = evaluateOpenclawSubstrateDemoTranscriptCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "openclaw_substrate_demo_transcript_verified",
          ok: false,
          exitCode: 1,
          command: "derive e2e_openclaw_substrate_demo sessionTranscriptVerified"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.details?.sourceCheckId, "openclaw_substrate_demo_transcript_verified");
});

test("production cutover gate: derives SDK JS smoke check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateSdkAcsSmokeJsCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "e2e_js_sdk_acs_substrate_smoke",
          ok: true,
          exitCode: 0,
          command: "node --test test/api-sdk-acs-substrate-smoke.test.js"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_js_sdk_acs_substrate_smoke");
});

test("production cutover gate: derives session stream conformance check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateSessionStreamConformanceCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "e2e_session_stream_conformance_v1",
          ok: true,
          exitCode: 0,
          command: "node conformance/session-stream-v1/run.mjs --adapter-node-bin ..."
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_session_stream_conformance_v1");
});

test("production cutover gate: derives session stream conformance check fail-closed when source check is missing", () => {
  const evaluated = evaluateSessionStreamConformanceCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_session_stream_conformance_v1");
});

test("production cutover gate: derives settlement/dispute lifecycle check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateSettlementDisputeArbitrationLifecycleCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "e2e_settlement_dispute_arbitration_lifecycle_enforcement",
          ok: true,
          exitCode: 0,
          command: "node --test test/api-e2e-settlement-dispute-arbitration-lifecycle-enforcement.test.js"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_settlement_dispute_arbitration_lifecycle_enforcement");
});

test("production cutover gate: derives settlement/dispute lifecycle check fail-closed when source check is missing", () => {
  const evaluated = evaluateSettlementDisputeArbitrationLifecycleCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_settlement_dispute_arbitration_lifecycle_enforcement");
});

test("production cutover gate: derives SDK PY smoke check fail-closed when source check is missing", () => {
  const evaluated = evaluateSdkAcsSmokePyCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_python_sdk_acs_substrate_smoke");
});

test("production cutover gate: derives checkpoint grant binding check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateCheckpointGrantBindingCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "ops_agent_substrate_fast_loop_checkpoint_grant_binding",
          ok: true,
          exitCode: 0,
          command: "npm run -s test:ops:agent-substrate-fast-loop"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "ops_agent_substrate_fast_loop_checkpoint_grant_binding");
});

test("production cutover gate: derives checkpoint grant binding check fail-closed when source check is missing", () => {
  const evaluated = evaluateCheckpointGrantBindingCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "ops_agent_substrate_fast_loop_checkpoint_grant_binding");
});

test("production cutover gate: derives Python contract freeze check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateSdkPythonContractFreezeCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "e2e_python_sdk_contract_freeze",
          ok: true,
          exitCode: 0,
          command: "node --test test/api-sdk-python-contract-freeze.test.js"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_python_sdk_contract_freeze");
});

test("production cutover gate: derives Python contract freeze check fail-closed when source check is missing", () => {
  const evaluated = evaluateSdkPythonContractFreezeCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_python_sdk_contract_freeze");
});

test("production cutover gate: derives PG work order metering durability check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateWorkOrderMeteringDurabilityCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "pg_work_order_metering_durability",
          ok: true,
          exitCode: 0,
          command: "node --test test/pg-work-order-metering-durability.test.js"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "pg_work_order_metering_durability");
});

test("production cutover gate: derives PG substrate primitives durability check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluatePgSubstratePrimitivesDurabilityCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [
        { id: "mcp_host_cert_matrix", ok: true },
        {
          id: "pg_substrate_primitives_durability",
          ok: true,
          exitCode: 0,
          command: "node --test test/pg-agent-substrate-primitives-durability.test.js"
        }
      ]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.details?.sourceCheckId, "pg_substrate_primitives_durability");
});

test("production cutover gate: derives PG state checkpoint durability check fail-closed when source check is missing", () => {
  const evaluated = evaluatePgStateCheckpointDurabilityCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.failureCode, "source_check_missing");
  assert.equal(evaluated.details?.sourceCheckId, "pg_state_checkpoint_durability");
});

test("production cutover gate: derives NS3 evidence-binding coverage check as pass from coverage report verdict", () => {
  const evaluated = evaluateNs3EvidenceBindingCoverageCheck(
    {
      schemaVersion: "NooterraNs3EvidenceBindingCoverageMatrixReport.v1",
      verdict: {
        ok: true,
        status: "pass"
      }
    },
    "artifacts/gates/ns3-evidence-binding-coverage-matrix.json"
  );
  assert.equal(evaluated.status, "passed");
  assert.equal(evaluated.exitCode, 0);
  assert.equal(evaluated.failureCode, null);
  assert.equal(evaluated.details?.reportSchemaVersion, "NooterraNs3EvidenceBindingCoverageMatrixReport.v1");
  assert.equal(evaluated.details?.verdictOk, true);
});

test("production cutover gate: derives NS3 evidence-binding coverage check fail-closed when report verdict is not ok", () => {
  const evaluated = evaluateNs3EvidenceBindingCoverageCheck(
    {
      schemaVersion: "NooterraNs3EvidenceBindingCoverageMatrixReport.v1",
      verdict: {
        ok: false,
        status: "fail"
      }
    },
    "artifacts/gates/ns3-evidence-binding-coverage-matrix.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.failureCode, "ns3_coverage_report_not_ok");
});

test("production cutover gate: derives NS3 evidence-binding coverage check fail-closed when report shape is invalid", () => {
  const evaluated = evaluateNs3EvidenceBindingCoverageCheck(
    {
      schemaVersion: "NooterraNs3EvidenceBindingCoverageMatrixReport.v1"
    },
    "artifacts/gates/ns3-evidence-binding-coverage-matrix.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.failureCode, "ns3_coverage_report_invalid_shape");
});

test("production cutover gate: derives PG work order metering durability check fail-closed when source check is missing", () => {
  const evaluated = evaluateWorkOrderMeteringDurabilityCheck(
    {
      schemaVersion: "NooterraVerifiedGateReport.v1",
      ok: true,
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "pg_work_order_metering_durability");
});

test("production cutover gate: derives deterministic blocking issues from failed checks", () => {
  const issues = buildBlockingIssues([
    { id: "z_last", status: "failed", exitCode: 1, reportPath: "z.json", error: "z fail" },
    { id: "a_first", status: "failed", exitCode: 1, reportPath: "a.json", details: { message: "a fail" } },
    { id: "b_ok", status: "passed", exitCode: 0, reportPath: "b.json" },
    { id: "m_mid", status: "failed", exitCode: 1, reportPath: "m.json", failureCode: "m_failed" }
  ]);

  assert.deepEqual(
    issues.map((row) => row.checkId),
    ["a_first", "m_mid", "z_last"]
  );
  assert.equal(issues[0]?.message, "a fail");
  assert.equal(issues[1]?.failureCode, "m_failed");
  assert.equal(issues[2]?.message, "z fail");
});

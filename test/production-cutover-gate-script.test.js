import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  evaluateGateVerdict,
  evaluateCheckpointGrantBindingCheck,
  evaluateOpenclawSubstrateDemoLineageCheck,
  evaluateOpenclawSubstrateDemoTranscriptCheck,
  evaluateSessionStreamConformanceCheck,
  evaluateSdkAcsSmokeJsCheck,
  evaluateSdkAcsSmokePyCheck,
  evaluateSdkPythonContractFreezeCheck,
  evaluateWorkOrderMeteringDurabilityCheck,
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
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
});

test("production cutover gate: derives openclaw transcript check as pass from Nooterra Verified collaboration report", () => {
  const evaluated = evaluateOpenclawSubstrateDemoTranscriptCheck(
    {
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
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "e2e_session_stream_conformance_v1");
});

test("production cutover gate: derives SDK PY smoke check fail-closed when source check is missing", () => {
  const evaluated = evaluateSdkAcsSmokePyCheck(
    {
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

test("production cutover gate: derives PG work order metering durability check fail-closed when source check is missing", () => {
  const evaluated = evaluateWorkOrderMeteringDurabilityCheck(
    {
      checks: [{ id: "mcp_host_cert_matrix", ok: true }]
    },
    "artifacts/gates/nooterra-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
  assert.equal(evaluated.details?.sourceCheckId, "pg_work_order_metering_durability");
});

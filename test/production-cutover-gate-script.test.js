import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  evaluateGateVerdict,
  evaluateOpenclawSubstrateDemoLineageCheck,
  evaluateOpenclawSubstrateDemoTranscriptCheck,
  parseArgs
} from "../scripts/ci/run-production-cutover-gate.mjs";

test("production cutover gate parser: uses env default report path", () => {
  const cwd = "/tmp/settld";
  const args = parseArgs([], { PRODUCTION_CUTOVER_GATE_REPORT_PATH: "artifacts/custom-report.json" }, cwd);
  assert.equal(args.help, false);
  assert.equal(args.mode, "local");
  assert.equal(args.reportPath, path.resolve(cwd, "artifacts/custom-report.json"));
});

test("production cutover gate parser: allows explicit --report override", () => {
  const cwd = "/tmp/settld";
  const args = parseArgs(["--report", "artifacts/gates/override.json"], {}, cwd);
  assert.equal(args.reportPath, path.resolve(cwd, "artifacts/gates/override.json"));
});

test("production cutover gate parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
});

test("production cutover gate parser: validates live mode required args", () => {
  assert.throws(() => parseArgs(["--mode", "live"], {}, "/tmp/settld"), /--base-url is required/);

  const args = parseArgs(
    ["--mode", "live", "--base-url", "https://api.settld.work", "--tenant-id", "tenant_prod_gate", "--ops-token", "tok_ops", "--protocol", "1.0"],
    {},
    "/tmp/settld"
  );
  assert.equal(args.mode, "live");
  assert.equal(args.baseUrl, "https://api.settld.work");
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

test("production cutover gate: derives openclaw lineage check as pass from Settld Verified collaboration report", () => {
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
    "artifacts/gates/settld-verified-collaboration-gate.json"
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
    "artifacts/gates/settld-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.match(String(evaluated.details?.message ?? ""), /missing source check/i);
});

test("production cutover gate: derives openclaw transcript check as pass from Settld Verified collaboration report", () => {
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
    "artifacts/gates/settld-verified-collaboration-gate.json"
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
    "artifacts/gates/settld-verified-collaboration-gate.json"
  );
  assert.equal(evaluated.status, "failed");
  assert.equal(evaluated.exitCode, 1);
  assert.equal(evaluated.details?.sourceCheckId, "openclaw_substrate_demo_transcript_verified");
});

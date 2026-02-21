import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { evaluateGateVerdict, parseArgs } from "../scripts/ci/run-production-cutover-gate.mjs";

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

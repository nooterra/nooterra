import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, runGoLiveGate } from "../scripts/ci/run-go-live-gate.mjs";

test("go-live gate parser: supports bootstrap defaults and overrides", () => {
  const args = parseArgs(
    [
      "--bootstrap-local",
      "--bootstrap-base-url",
      "http://127.0.0.1:3311/",
      "--bootstrap-tenant-id",
      "tenant_override",
      "--bootstrap-ops-token",
      "ops_override",
      "--out",
      "tmp/go-live.json"
    ],
    {
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_TENANT_ID: "tenant_default",
      PROXY_OPS_TOKEN: "ops_default"
    },
    "/tmp/nooterra"
  );
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3311/");
  assert.equal(args.bootstrapTenantId, "tenant_override");
  assert.equal(args.bootstrapOpsToken, "ops_override");
  assert.equal(args.reportPath, "/tmp/nooterra/tmp/go-live.json");
});

test("go-live gate runner: auto-bootstrap injects runtime OPS_TOKEN for throughput checks", async () => {
  const runCalls = [];
  let cleanupCalled = false;
  const bootstrapFn = async ({ enabled }) => ({
    envPatch: {
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_API_KEY: "sk_test.bootstrap"
    },
    metadata: { enabled, startedLocalApi: true },
    cleanup: async () => {
      cleanupCalled = true;
    }
  });
  const runShellFn = async (command, { env }) => {
    runCalls.push({ command, env });
    return 0;
  };

  const env = {
    GO_LIVE_TEST_COMMAND: "node --test test/settlement-kernel.test.js",
    RUN_THROUGHPUT_DRILL: "1",
    RUN_INCIDENT_REHEARSAL: "1",
    ALLOW_THROUGHPUT_SKIP: "1",
    ALLOW_INCIDENT_REHEARSAL_SKIP: "1",
    GO_LIVE_AUTO_BOOTSTRAP_LOCAL: "1",
    CI: "0"
  };
  const args = parseArgs([], env, "/tmp/nooterra");
  const { report } = await runGoLiveGate(args, {
    env,
    runShellFn,
    bootstrapFn,
    loadLighthouseTrackerFn: async () => ({ ok: true, rows: [] })
  });

  assert.equal(report.verdict.ok, true);
  assert.equal(report.bootstrap.enabled, true);
  assert.equal(report.runtime.baseUrl, "http://127.0.0.1:3000");
  assert.equal(report.runtime.tenantId, "tenant_default");
  assert.equal(report.runtime.opsTokenPresent, true);
  assert.equal(cleanupCalled, true);
  assert.equal(runCalls.length, 3);

  const throughputCall = runCalls.find((row) => row.command.includes("run-10x-throughput-drill.mjs"));
  assert.ok(throughputCall, "expected throughput command invocation");
  assert.equal(throughputCall.env.OPS_TOKEN, "tok_ops");
  assert.equal(throughputCall.env.BASE_URL, "http://127.0.0.1:3000");
  assert.equal(throughputCall.env.TENANT_ID, "tenant_default");
  assert.equal(throughputCall.env.TARGET_P95_MS, "60000");
  assert.equal(throughputCall.env.MAX_FAILURE_RATE, "0.2");
});

test("go-live gate runner: does not auto-bootstrap in CI when ops token missing", async () => {
  const runCalls = [];
  let bootstrapEnabled = null;
  const bootstrapFn = async ({ enabled }) => {
    bootstrapEnabled = enabled;
    return {
      envPatch: {},
      metadata: { enabled },
      cleanup: async () => {}
    };
  };
  const env = {
    GO_LIVE_TEST_COMMAND: "node --test test/settlement-kernel.test.js",
    RUN_THROUGHPUT_DRILL: "0",
    RUN_INCIDENT_REHEARSAL: "0",
    CI: "true"
  };
  const args = parseArgs([], env, "/tmp/nooterra");
  const { report } = await runGoLiveGate(args, {
    env,
    bootstrapFn,
    runShellFn: async (command, { env: runtimeEnv }) => {
      runCalls.push({ command, env: runtimeEnv });
      return 0;
    },
    loadLighthouseTrackerFn: async () => ({ ok: true, rows: [] })
  });

  assert.equal(report.verdict.ok, true);
  assert.equal(bootstrapEnabled, false);
  assert.equal(report.bootstrap.enabled, false);
  assert.equal(runCalls.length, 1);
});

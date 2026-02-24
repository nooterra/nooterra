import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, runAgentSubstrateFastLoop } from "../scripts/ci/run-agent-substrate-fast-loop.mjs";

test("agent substrate fast loop parser: supports defaults from env", () => {
  const args = parseArgs([], {
    SETTLD_BASE_URL: "http://127.0.0.1:3100",
    SETTLD_TENANT_ID: "tenant_env",
    PROXY_OPS_TOKEN: "ops_env"
  });
  assert.equal(args.bootstrapLocal, false);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3100");
  assert.equal(args.bootstrapTenantId, "tenant_env");
  assert.equal(args.bootstrapOpsToken, "ops_env");
});

test("agent substrate fast loop parser: supports bootstrap flags", () => {
  const args = parseArgs([
    "--bootstrap-local",
    "--bootstrap-base-url=http://127.0.0.1:3200",
    "--bootstrap-tenant-id=tenant_boot",
    "--bootstrap-ops-token=ops_boot"
  ]);
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3200");
  assert.equal(args.bootstrapTenantId, "tenant_boot");
  assert.equal(args.bootstrapOpsToken, "ops_boot");
});

test("agent substrate fast loop parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/i);
});

test("agent substrate fast loop runner: applies bootstrap env patch to checks and runs cleanup", async () => {
  const seenEnv = [];
  let cleanupCalled = false;
  const bootstrapFn = async () => ({
    envPatch: {
      SETTLD_BASE_URL: "http://127.0.0.1:3000",
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test.k"
    },
    metadata: { enabled: true, startedLocalApi: true },
    cleanup: async () => {
      cleanupCalled = true;
    }
  });
  const runCheckFn = (check) => {
    seenEnv.push(check.env ?? {});
    return {
      id: check.id,
      command: check.command,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.001Z",
      ok: true,
      exitCode: 0,
      signal: null,
      stdoutPreview: "",
      stderrPreview: ""
    };
  };
  const { report } = await runAgentSubstrateFastLoop(
    {
      withPublicSmoke: false,
      bootstrapLocal: true,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops"
    },
    { runCheckFn, bootstrapFn }
  );

  assert.equal(report.ok, true);
  assert.equal(report.summary.totalChecks, 3);
  assert.equal(cleanupCalled, true);
  assert.equal(seenEnv.length, 3);
  for (const row of seenEnv) {
    assert.equal(row.SETTLD_BASE_URL, "http://127.0.0.1:3000");
    assert.equal(row.SETTLD_TENANT_ID, "tenant_default");
    assert.equal(row.SETTLD_API_KEY, "sk_test.k");
  }
});

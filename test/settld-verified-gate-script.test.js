import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, runSettldVerifiedGate } from "../scripts/ci/run-settld-verified-gate.mjs";

test("settld verified gate parser: supports help mode", () => {
  const args = parseArgs(["--help"], {}, "/tmp/settld");
  assert.equal(args.help, true);
});

test("settld verified gate parser: supports bootstrap defaults and overrides", () => {
  const args = parseArgs(
    [
      "--bootstrap-local",
      "--bootstrap-base-url",
      "http://127.0.0.1:3310/",
      "--bootstrap-tenant-id",
      "tenant_override",
      "--bootstrap-ops-token",
      "ops_override",
      "--level",
      "collaboration"
    ],
    {
      SETTLD_BASE_URL: "http://127.0.0.1:3000",
      SETTLD_TENANT_ID: "tenant_default",
      PROXY_OPS_TOKEN: "ops_default"
    },
    "/tmp/settld"
  );
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3310/");
  assert.equal(args.bootstrapTenantId, "tenant_override");
  assert.equal(args.bootstrapOpsToken, "ops_override");
  assert.equal(args.level, "collaboration");
});

test("settld verified gate parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--nope"], process.env, process.cwd()), /unknown argument/i);
});

test("settld verified gate runner: applies bootstrap env patch to checks and runs cleanup", async () => {
  const seenEnv = [];
  let cleanupCalled = false;
  const bootstrapFn = async () => ({
    envPatch: {
      SETTLD_BASE_URL: "http://127.0.0.1:3000",
      SETTLD_TENANT_ID: "tenant_default",
      SETTLD_API_KEY: "sk_test.k"
    },
    metadata: { enabled: true, startedLocalApi: false },
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
  const { report } = await runSettldVerifiedGate(
    {
      level: "core",
      out: "/tmp/settld-verified-gate.json",
      help: false,
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

import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, runAgentSubstrateFastLoop, validateSdkAcsSmokeSummary } from "../scripts/ci/run-agent-substrate-fast-loop.mjs";

test("agent substrate fast loop parser: supports defaults from env", () => {
  const args = parseArgs([], {
    NOOTERRA_BASE_URL: "http://127.0.0.1:3100",
    NOOTERRA_TENANT_ID: "tenant_env",
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
  const seenIds = [];
  let cleanupCalled = false;
  const bootstrapFn = async () => ({
    envPatch: {
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_API_KEY: "sk_test.k"
    },
    metadata: { enabled: true, startedLocalApi: true },
    cleanup: async () => {
      cleanupCalled = true;
    }
  });
  const runCheckFn = (check) => {
    seenIds.push(check.id);
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
  assert.ok(Number(report.summary.totalChecks) >= 10);
  assert.equal(cleanupCalled, true);
  assert.ok(seenEnv.length >= 10);
  assert.equal(seenIds.includes("sdk_acs_smoke_js"), true);
  assert.equal(seenIds.includes("sdk_acs_smoke_py"), true);
  assert.equal(seenIds.includes("sdk_python_collab_discovery_contract"), true);
  assert.equal(seenIds.includes("sdk_python_contract_freeze"), true);
  for (const row of seenEnv) {
    assert.equal(row.NOOTERRA_BASE_URL, "http://127.0.0.1:3000");
    assert.equal(row.NOOTERRA_TENANT_ID, "tenant_default");
    assert.equal(row.NOOTERRA_API_KEY, "sk_test.k");
  }
});

test("agent substrate fast loop contract validator: accepts expected ACS smoke summary shape", () => {
  const verdict = validateSdkAcsSmokeSummary({
    principalAgentId: "agt_principal",
    workerAgentId: "agt_worker",
    delegationGrantId: "dgrant_1",
    authorityGrantId: "agrant_1",
    workOrderId: "workord_1",
    workOrderStatus: "completed",
    completionStatus: "success",
    workOrderReceiptCount: 1,
    sessionId: "sess_1",
    sessionEventCount: 1,
    checkpointId: "chkpt_1",
    checkpointHash: "a".repeat(64),
    checkpointListCount: 1,
    checkpointDelegationGrantRef: "dgrant_1",
    checkpointAuthorityGrantRef: "agrant_1",
    attestationId: "catt_1",
    attestationRuntimeStatus: "valid",
    attestationListCount: 1,
    delegationRevokedAt: "2026-01-01T00:00:00.000Z",
    authorityRevokedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, null);
});

test("agent substrate fast loop contract validator: rejects invalid checkpoint hash", () => {
  const verdict = validateSdkAcsSmokeSummary({
    principalAgentId: "agt_principal",
    workerAgentId: "agt_worker",
    delegationGrantId: "dgrant_1",
    authorityGrantId: "agrant_1",
    workOrderId: "workord_1",
    workOrderStatus: "completed",
    completionStatus: "success",
    workOrderReceiptCount: 1,
    sessionId: "sess_1",
    sessionEventCount: 1,
    checkpointId: "chkpt_1",
    checkpointHash: "not-a-hash",
    checkpointListCount: 1,
    checkpointDelegationGrantRef: "dgrant_1",
    checkpointAuthorityGrantRef: "agrant_1",
    attestationId: "catt_1",
    attestationRuntimeStatus: "valid",
    attestationListCount: 1,
    delegationRevokedAt: "2026-01-01T00:00:00.000Z",
    authorityRevokedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(verdict.ok, false);
  assert.match(String(verdict.reason ?? ""), /checkpointHash/i);
});

test("agent substrate fast loop runner: includes pg metering durability check when DATABASE_URL is set", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://postgres:test@127.0.0.1:55432/postgres";
  const seenIds = [];
  try {
    const { report } = await runAgentSubstrateFastLoop(
      {
        withPublicSmoke: false,
        bootstrapLocal: false,
        bootstrapBaseUrl: "http://127.0.0.1:3000",
        bootstrapTenantId: "tenant_default",
        bootstrapOpsToken: "tok_ops"
      },
      {
        bootstrapFn: async () => ({
          envPatch: {},
          metadata: { enabled: false },
          cleanup: async () => {}
        }),
        runCheckFn: (check) => {
          seenIds.push(check.id);
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
        }
      }
    );
    assert.equal(report.ok, true);
    assert.equal(seenIds.includes("pg_state_checkpoints_durability"), true);
    assert.equal(seenIds.includes("pg_work_order_metering_durability"), true);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

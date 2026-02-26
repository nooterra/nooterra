import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  runAgentSubstrateAdversarialHarness
} from "../scripts/ci/run-agent-substrate-adversarial-harness.mjs";

test("agent substrate adversarial harness parser: supports help mode", () => {
  const args = parseArgs(["--help"], {}, "/tmp/nooterra");
  assert.equal(args.help, true);
});

test("agent substrate adversarial harness parser: supports profile and bootstrap overrides", () => {
  const args = parseArgs(
    [
      "--profile",
      "prompt-contagion",
      "--out",
      "artifacts/custom/adversarial.json",
      "--bootstrap-local",
      "--bootstrap-base-url",
      "http://127.0.0.1:3310/",
      "--bootstrap-tenant-id",
      "tenant_override",
      "--bootstrap-ops-token",
      "ops_override"
    ],
    {
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_TENANT_ID: "tenant_default",
      PROXY_OPS_TOKEN: "tok_ops"
    },
    "/tmp/nooterra"
  );
  assert.equal(args.profile, "prompt-contagion");
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3310/");
  assert.equal(args.bootstrapTenantId, "tenant_override");
  assert.equal(args.bootstrapOpsToken, "ops_override");
  assert.match(args.out, /artifacts\/custom\/adversarial\.json$/);
});

test("agent substrate adversarial harness parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--nope"], process.env, process.cwd()), /unknown argument/i);
});

test("agent substrate adversarial harness parser: rejects unsupported profile", () => {
  assert.throws(() => parseArgs(["--profile", "invalid"], process.env, process.cwd()), /core\|full\|prompt-contagion/i);
});

test("agent substrate adversarial harness runner: applies bootstrap env patch and runs cleanup", async () => {
  const seenEnv = [];
  let cleanupCalled = false;
  const bootstrapFn = async () => ({
    envPatch: {
      NOOTERRA_BASE_URL: "http://127.0.0.1:3000",
      NOOTERRA_TENANT_ID: "tenant_default",
      NOOTERRA_API_KEY: "sk_test.k"
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

  const { report } = await runAgentSubstrateAdversarialHarness(
    {
      profile: "core",
      out: "/tmp/agent-substrate-adversarial-harness.json",
      help: false,
      bootstrapLocal: true,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops"
    },
    { runCheckFn, bootstrapFn }
  );

  assert.equal(report.ok, true);
  assert.equal(report.schemaVersion, "AgentSubstrateAdversarialHarness.v1");
  assert.equal(typeof report.generatedAt, "string");
  assert.equal(report.summary.totalChecks, 5);
  assert.equal(cleanupCalled, true);
  assert.equal(seenEnv.length, 5);
  for (const row of seenEnv) {
    assert.equal(row.NOOTERRA_BASE_URL, "http://127.0.0.1:3000");
    assert.equal(row.NOOTERRA_TENANT_ID, "tenant_default");
    assert.equal(row.NOOTERRA_API_KEY, "sk_test.k");
  }
});

test("agent substrate adversarial harness runner: prompt-contagion profile runs targeted checks", async () => {
  const seenIds = [];
  const bootstrapFn = async () => ({
    envPatch: {},
    metadata: { enabled: false },
    cleanup: async () => {}
  });
  const runCheckFn = (check) => {
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
  };

  const { report } = await runAgentSubstrateAdversarialHarness(
    {
      profile: "prompt-contagion",
      out: "/tmp/agent-substrate-adversarial-harness-prompt.json",
      help: false,
      bootstrapLocal: false,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops"
    },
    { runCheckFn, bootstrapFn }
  );

  assert.equal(report.ok, true);
  assert.equal(report.summary.totalChecks, 2);
  assert.deepEqual(seenIds, ["prompt_contagion_forced_modes", "prompt_contagion_provenance_replay_fail_closed"]);
});

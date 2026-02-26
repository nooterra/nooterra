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
      PROXY_OPS_TOKEN: "ops_default",
      DATABASE_URL: "postgres://proxy:proxy@127.0.0.1:5432/proxy"
    },
    "/tmp/settld"
  );
  assert.equal(args.bootstrapLocal, true);
  assert.equal(args.bootstrapBaseUrl, "http://127.0.0.1:3310/");
  assert.equal(args.bootstrapTenantId, "tenant_override");
  assert.equal(args.bootstrapOpsToken, "ops_override");
  assert.equal(args.level, "collaboration");
  assert.equal(args.databaseUrl, "postgres://proxy:proxy@127.0.0.1:5432/proxy");
});

test("settld verified gate parser: rejects unknown args", () => {
  assert.throws(() => parseArgs(["--nope"], process.env, process.cwd()), /unknown argument/i);
});

test("settld verified gate parser: include-pg requires DATABASE_URL", () => {
  assert.throws(() => parseArgs(["--include-pg"], {}, process.cwd()), /requires DATABASE_URL/i);
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
      bootstrapOpsToken: "tok_ops",
      includePg: false,
      databaseUrl: ""
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

test("settld verified gate runner: collaboration level includes openclaw substrate demo check", async () => {
  const seenIds = [];
  const runCheckFn = (check) => {
    seenIds.push(check.id);
    const openclawDetails =
      check.id === "e2e_openclaw_substrate_demo"
        ? {
            sessionLineageVerified: true,
            sessionTranscriptVerified: true
          }
        : undefined;
    return {
      id: check.id,
      command: check.command,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.001Z",
      ok: true,
      exitCode: 0,
      signal: null,
      stdoutPreview: "",
      stderrPreview: "",
      details: openclawDetails
    };
  };
  const bootstrapFn = async () => ({
    envPatch: {},
    metadata: { enabled: false },
    cleanup: async () => {}
  });
  const { report } = await runSettldVerifiedGate(
    {
      level: "collaboration",
      out: "/tmp/settld-verified-gate.json",
      help: false,
      bootstrapLocal: false,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops",
      includePg: false,
      databaseUrl: ""
    },
    { runCheckFn, bootstrapFn }
  );
  assert.equal(report.ok, true);
  assert.equal(report.summary.totalChecks, 24);
  assert.equal(seenIds.includes("e2e_agent_card_stream_lifecycle"), true);
  assert.equal(seenIds.includes("e2e_trace_id_propagation"), true);
  assert.equal(seenIds.includes("e2e_task_negotiation_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_x402_agent_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_x402_quote_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_agreement_delegation_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_marketplace_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_marketplace_agreement_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_settlement_dispute_arbitration_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_tool_call_arbitration_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_grant_issue_lifecycle_enforcement"), true);
  assert.equal(seenIds.includes("e2e_ops_audit_lineage"), true);
  assert.equal(seenIds.includes("e2e_ops_audit_lineage_verify_fail_closed"), true);
  assert.equal(seenIds.includes("e2e_task_negotiation"), true);
  assert.equal(seenIds.includes("e2e_session_replay_chain_fail_closed"), true);
  assert.equal(seenIds.includes("e2e_openclaw_substrate_demo"), true);
  assert.equal(seenIds.includes("e2e_authority_grant_required"), true);
  const reportIds = report.checks.map((row) => row.id);
  assert.equal(reportIds.includes("openclaw_substrate_demo_lineage_verified"), true);
  assert.equal(reportIds.includes("openclaw_substrate_demo_transcript_verified"), true);
});

test("settld verified gate runner: include-pg appends PG durability check", async () => {
  const seenIds = [];
  const runCheckFn = (check) => {
    seenIds.push(check.id);
    const openclawDetails =
      check.id === "e2e_openclaw_substrate_demo"
        ? {
            sessionLineageVerified: true,
            sessionTranscriptVerified: true
          }
        : undefined;
    return {
      id: check.id,
      command: check.command,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.001Z",
      ok: true,
      exitCode: 0,
      signal: null,
      stdoutPreview: "",
      stderrPreview: "",
      details: openclawDetails
    };
  };
  const bootstrapFn = async () => ({
    envPatch: {},
    metadata: { enabled: false },
    cleanup: async () => {}
  });
  const { report } = await runSettldVerifiedGate(
    {
      level: "collaboration",
      out: "/tmp/settld-verified-gate.json",
      help: false,
      bootstrapLocal: false,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops",
      includePg: true,
      databaseUrl: "postgres://proxy:proxy@127.0.0.1:5432/proxy"
    },
    { runCheckFn, bootstrapFn }
  );
  assert.equal(report.ok, true);
  assert.equal(seenIds.includes("pg_substrate_primitives_durability"), true);
});

test("settld verified gate runner: guardrails level includes prompt-contagion harness", async () => {
  const seenIds = [];
  const runCheckFn = (check) => {
    seenIds.push(check.id);
    const openclawDetails =
      check.id === "e2e_openclaw_substrate_demo"
        ? {
            sessionLineageVerified: true,
            sessionTranscriptVerified: true
          }
        : undefined;
    return {
      id: check.id,
      command: check.command,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.001Z",
      ok: true,
      exitCode: 0,
      signal: null,
      stdoutPreview: "",
      stderrPreview: "",
      details: openclawDetails
    };
  };
  const bootstrapFn = async () => ({
    envPatch: {},
    metadata: { enabled: false },
    cleanup: async () => {}
  });
  const { report } = await runSettldVerifiedGate(
    {
      level: "guardrails",
      out: "/tmp/settld-verified-gate-guardrails.json",
      help: false,
      bootstrapLocal: false,
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops",
      includePg: false,
      databaseUrl: ""
    },
    { runCheckFn, bootstrapFn }
  );
  assert.equal(report.ok, true);
  assert.equal(seenIds.includes("agent_substrate_adversarial_harness"), true);
  assert.equal(seenIds.includes("agent_substrate_prompt_contagion_harness"), true);
});

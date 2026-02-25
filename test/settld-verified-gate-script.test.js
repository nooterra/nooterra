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

test("settld verified gate parser: include-pg requires DATABASE_URL", () => {
  assert.throws(() => parseArgs(["--include-pg"], { DATABASE_URL: "" }, process.cwd()), /requires DATABASE_URL/i);
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
  assert.equal(report.summary.totalChecks, 4);
  assert.equal(cleanupCalled, true);
  assert.equal(seenEnv.length, 4);
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
      bootstrapOpsToken: "tok_ops"
    },
    { runCheckFn, bootstrapFn }
  );
  assert.equal(report.ok, true);
  assert.equal(report.summary.totalChecks, 26);
  assert.equal(seenIds.includes("mcp_work_order_binding_fail_closed"), true);
  assert.equal(seenIds.includes("mcp_relationship_graph_tools"), true);
  assert.equal(seenIds.includes("mcp_interaction_graph_signer_fail_closed"), true);
  assert.equal(seenIds.includes("mcp_interaction_graph_signed_smoke"), true);
  assert.equal(seenIds.includes("mcp_work_order_binding_runtime_fail_closed"), true);
  assert.equal(seenIds.includes("e2e_public_agent_card_discovery"), true);
  assert.equal(seenIds.includes("e2e_billable_usage_events"), true);
  assert.equal(seenIds.includes("e2e_work_order_metered_settlement"), true);
  assert.equal(seenIds.includes("e2e_work_order_metered_topup_envelope_fail_closed"), true);
  assert.equal(seenIds.includes("e2e_work_order_settlement_split_binding"), true);
  assert.equal(seenIds.includes("e2e_public_relationship_summary_opt_in"), true);
  assert.equal(seenIds.includes("e2e_relationship_anti_gaming_dampening"), true);
  assert.equal(seenIds.includes("e2e_interaction_graph_pack_export"), true);
  assert.equal(seenIds.includes("e2e_interaction_graph_pack_signed_export"), true);
  assert.equal(seenIds.includes("e2e_task_negotiation"), true);
  assert.equal(seenIds.includes("e2e_session_replay_integrity"), true);
  assert.equal(seenIds.includes("e2e_prompt_contagion_guardrails"), true);
  assert.equal(seenIds.includes("e2e_x402_tainted_session_evidence_refs"), true);
  assert.equal(seenIds.includes("e2e_work_order_tainted_session_evidence_refs"), true);
  assert.equal(seenIds.includes("e2e_x402_authority_grants"), true);
  assert.equal(seenIds.includes("e2e_openclaw_substrate_demo"), true);
});

test("settld verified gate runner: collaboration level includes pg durability check when include-pg is enabled", async () => {
  const seenIds = [];
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
      includePg: true,
      databaseUrl: "postgres://proxy:proxy@127.0.0.1:5432/proxy",
      bootstrapBaseUrl: "http://127.0.0.1:3000",
      bootstrapTenantId: "tenant_default",
      bootstrapOpsToken: "tok_ops"
    },
    { runCheckFn, bootstrapFn }
  );
  assert.equal(report.ok, true);
  assert.equal(report.summary.totalChecks, 31);
  assert.equal(seenIds.includes("mcp_relationship_graph_tools"), true);
  assert.equal(seenIds.includes("mcp_interaction_graph_signer_fail_closed"), true);
  assert.equal(seenIds.includes("mcp_interaction_graph_signed_smoke"), true);
  assert.equal(seenIds.includes("e2e_public_agent_card_discovery"), true);
  assert.equal(seenIds.includes("e2e_billable_usage_events"), true);
  assert.equal(seenIds.includes("e2e_work_order_metered_settlement"), true);
  assert.equal(seenIds.includes("e2e_work_order_metered_topup_envelope_fail_closed"), true);
  assert.equal(seenIds.includes("e2e_work_order_settlement_split_binding"), true);
  assert.equal(seenIds.includes("e2e_public_relationship_summary_opt_in"), true);
  assert.equal(seenIds.includes("e2e_relationship_anti_gaming_dampening"), true);
  assert.equal(seenIds.includes("e2e_interaction_graph_pack_export"), true);
  assert.equal(seenIds.includes("e2e_interaction_graph_pack_signed_export"), true);
  assert.equal(seenIds.includes("mcp_work_order_binding_runtime_fail_closed_pg"), true);
  assert.equal(seenIds.includes("mcp_work_order_provider_binding_runtime_fail_closed_pg"), true);
  assert.equal(seenIds.includes("pg_substrate_durability"), true);
  assert.equal(seenIds.includes("pg_e2e_billable_usage_events"), true);
  assert.equal(seenIds.includes("pg_e2e_x402_authority_grant_windows"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serverSource = fs.readFileSync(
  new URL("../services/runtime/server.js", import.meta.url),
  "utf8"
);

const expectations = [
  {
    migration: "../src/db/migrations/044_worker_approval_runtime_alignment.sql",
    fragments: [
      "worker_approvals_execution_status",
      "worker_approvals_worker_decision",
      "worker_approvals_worker_matched_rule",
      "notify_approval_decided",
      "trg_approval_decided",
    ],
  },
  {
    migration: "../src/db/migrations/046_worker_runtime_state_machines.sql",
    fragments: [
      "worker_executions_status_valid",
      "worker_approvals_status_valid",
      "worker_approvals_decision_valid",
      "worker_approvals_status_decision_valid",
      "guard_worker_execution_transition",
      "trg_guard_worker_execution_transition",
      "guard_worker_approval_transition",
      "trg_guard_worker_approval_transition",
    ],
  },
  {
    migration: "../src/db/migrations/047_learning_signals_explainability.sql",
    fragments: [
      "learning_signals_worker_rule",
      "learning_signals_worker_outcome",
    ],
  },
  {
    migration: "../src/db/migrations/048_worker_tool_side_effects.sql",
    fragments: [
      "CREATE TABLE IF NOT EXISTS worker_tool_side_effects",
      "worker_tool_side_effects_worker_tool",
      "worker_tool_side_effects_tenant_tool",
      "worker_tool_side_effects_status",
    ],
  },
  {
    migration: "../src/db/migrations/049_worker_tool_side_effect_replays.sql",
    fragments: [
      "replay_count INTEGER NOT NULL DEFAULT 0",
      "last_replayed_at TIMESTAMPTZ",
      "worker_tool_side_effects_replays",
    ],
  },
  {
    migration: "../src/db/migrations/050_worker_webhook_ingress.sql",
    fragments: [
      "CREATE TABLE IF NOT EXISTS worker_webhook_ingress",
      "UNIQUE (tenant_id, worker_id, dedupe_key)",
      "worker_webhook_ingress_worker_status",
      "worker_webhook_ingress_tenant_status",
      "worker_webhook_ingress_execution",
    ],
  },
  {
    migration: "../src/db/migrations/051_tenant_worker_runtime_policies.sql",
    fragments: [
      "CREATE TABLE IF NOT EXISTS tenant_worker_runtime_policies",
      "tenant_worker_runtime_policies_policy_object",
      "tenant_worker_runtime_policies_updated_at",
    ],
  },
  {
    migration: "../src/db/migrations/052_worker_runtime_policy_overrides.sql",
    fragments: [
      "CREATE TABLE IF NOT EXISTS worker_runtime_policy_overrides",
      "worker_runtime_policy_overrides_policy_object",
      "worker_runtime_policy_overrides_worker_updated_at",
      "worker_runtime_policy_overrides_tenant_updated_at",
    ],
  },
];

test("scheduler bootstrap parity: hosted bootstrap SQL includes critical runtime objects from migrations 044-052", () => {
  for (const expectation of expectations) {
    const migrationSource = fs.readFileSync(
      new URL(expectation.migration, import.meta.url),
      "utf8"
    );
    for (const fragment of expectation.fragments) {
      assert.match(
        migrationSource,
        new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `migration ${expectation.migration} should contain ${fragment}`
      );
      assert.match(
        serverSource,
        new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `bootstrap SQL in server.js should contain ${fragment}`
      );
    }
  }
});

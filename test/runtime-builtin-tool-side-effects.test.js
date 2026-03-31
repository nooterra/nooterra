import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { executeBuiltinTool, setPool } from "../services/runtime/builtin-tools.js";

function stableJsonStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function buildSideEffectRequestHash(toolName, args) {
  return crypto.createHash("sha256")
    .update(`${toolName}\n${stableJsonStringify(args)}`)
    .digest("hex");
}

function createMockPool({ balanceUsd = 100, sideEffects = [] } = {}) {
  const state = {
    balanceUsd,
    totalSpentUsd: 0,
    sideEffects: sideEffects.map((entry) => ({ ...entry })),
    creditTransactions: [],
  };

  const query = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT id, request_hash, status, response_json, error_text, replay_count, last_replayed_at FROM worker_tool_side_effects")) {
      const [tenantId, toolName, idempotencyKey] = params;
      const row = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
    }

    if (normalized.startsWith("INSERT INTO worker_tool_side_effects")) {
      const [id, tenantId, workerId, executionId, toolName, idempotencyKey, requestHash, requestJson, target, amountUsd] = params;
      const existing = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      if (existing) {
        return { rowCount: 0, rows: [] };
      }
      state.sideEffects.push({
        id,
        tenant_id: tenantId,
        worker_id: workerId,
        execution_id: executionId,
        tool_name: toolName,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        request_json: JSON.parse(requestJson),
        status: "pending",
        target,
        amount_usd: amountUsd == null ? null : Number(amountUsd),
        provider_ref: null,
        response_json: null,
        error_text: null,
        replay_count: 0,
        last_replayed_at: null,
      });
      return { rowCount: 1, rows: [{ id }] };
    }

    if (normalized.startsWith("UPDATE worker_tool_side_effects SET status = $4")) {
      const [tenantId, toolName, idempotencyKey, status, responseJson, errorText, providerRef] = params;
      const row = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.status = status;
      row.response_json = responseJson == null ? null : JSON.parse(responseJson);
      row.error_text = errorText ?? null;
      row.provider_ref = providerRef ?? null;
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("UPDATE worker_tool_side_effects SET replay_count = COALESCE(replay_count, 0) + 1")) {
      const [tenantId, toolName, idempotencyKey] = params;
      const row = state.sideEffects.find((entry) =>
        entry.tenant_id === tenantId && entry.tool_name === toolName && entry.idempotency_key === idempotencyKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.replay_count = Number(row.replay_count || 0) + 1;
      row.last_replayed_at = new Date().toISOString();
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("SELECT COUNT(*)::int AS call_count,")) {
      const [tenantId, toolName, maybeWorkerOrTarget] = params;
      const isTargetScoped = normalized.includes("AND target = $3");
      const rows = state.sideEffects.filter((entry) => {
        if (entry.tenant_id !== tenantId) return false;
        if (entry.tool_name !== toolName) return false;
        if (entry.status !== "succeeded") return false;
        if (isTargetScoped) {
          if (maybeWorkerOrTarget && entry.target !== maybeWorkerOrTarget) return false;
        } else if (maybeWorkerOrTarget && entry.worker_id !== maybeWorkerOrTarget) {
          return false;
        }
        return true;
      });
      return {
        rowCount: 1,
        rows: [{
          call_count: rows.length,
          total_amount: rows.reduce((sum, entry) => sum + Number(entry.amount_usd || 0), 0),
        }],
      };
    }

    if (normalized.startsWith("SELECT COUNT(*)::int AS duplicate_count")) {
      const [tenantId, toolName, target, requestHash, , excludeIdempotencyKey] = params;
      const duplicateCount = state.sideEffects.filter((entry) =>
        entry.tenant_id === tenantId
        && entry.tool_name === toolName
        && entry.target === target
        && entry.request_hash === requestHash
        && entry.status === "succeeded"
        && (!excludeIdempotencyKey || entry.idempotency_key !== excludeIdempotencyKey)
      ).length;
      return {
        rowCount: 1,
        rows: [{ duplicate_count: duplicateCount }],
      };
    }

    if (normalized.startsWith("SELECT COALESCE(SUM(ABS(amount_usd)), 0) AS recent_spend")) {
      const [tenantId] = params;
      const recentSpend = state.creditTransactions
        .filter((entry) => entry.tenant_id === tenantId && entry.type === "worker_payment")
        .reduce((sum, entry) => sum + Math.abs(Number(entry.amount_usd || 0)), 0);
      return { rowCount: 1, rows: [{ recent_spend: recentSpend }] };
    }

    if (normalized === "SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1") {
      return { rowCount: 1, rows: [{ balance_usd: state.balanceUsd }] };
    }

    if (normalized.startsWith("UPDATE tenant_credits SET balance_usd = balance_usd - $2")) {
      const [, amountUsd] = params;
      state.balanceUsd -= Number(amountUsd);
      state.totalSpentUsd += Number(amountUsd);
      return { rowCount: 1, rows: [] };
    }

    if (normalized.startsWith("INSERT INTO credit_transactions")) {
      const [id, tenantId, amountUsd, description, executionId] = params;
      const type = normalized.includes("'payment_request'") ? "payment_request" : "worker_payment";
      state.creditTransactions.push({
        id,
        tenant_id: tenantId,
        amount_usd: Number(amountUsd),
        type,
        description,
        execution_id: executionId,
      });
      return { rowCount: 1, rows: [] };
    }

    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`Unhandled SQL in mock pool: ${normalized}`);
  };

  return {
    state,
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
  };
}

test("scheduler builtin side effects: make_payment is idempotent across exact replays", async () => {
  const pool = createMockPool({ balanceUsd: 100 });
  setPool(pool);

  const meta = {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_1",
    tool_call_id: "tool_payment_1",
  };
  const args = { amount_usd: 25, recipient: "Stripe", description: "API usage" };

  const first = await executeBuiltinTool("make_payment", args, meta);
  const replay = await executeBuiltinTool("make_payment", args, meta);

  assert.equal(first.success, true);
  assert.equal(first.result.idempotent_replay, false);
  assert.equal(replay.success, true);
  assert.equal(replay.result.idempotent_replay, true);
  assert.equal(replay.result.transaction_id, first.result.transaction_id);
  assert.equal(replay.result.replay_count, 1);
  assert.equal(pool.state.creditTransactions.filter((entry) => entry.type === "worker_payment").length, 1);
  assert.equal(pool.state.balanceUsd, 75);
  assert.equal(pool.state.sideEffects[0].replay_count, 1);
});

test("scheduler builtin side effects: conflicting reuse of the same idempotency key fails closed", async () => {
  const pool = createMockPool({ balanceUsd: 100 });
  setPool(pool);

  const meta = {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_1",
    tool_call_id: "tool_payment_1",
  };

  const first = await executeBuiltinTool("make_payment", {
    amount_usd: 25,
    recipient: "Stripe",
    description: "API usage",
  }, meta);
  const conflict = await executeBuiltinTool("make_payment", {
    amount_usd: 30,
    recipient: "Stripe",
    description: "Different request",
  }, meta);

  assert.equal(first.success, true);
  assert.equal(conflict.success, false);
  assert.match(conflict.error, /idempotency conflict/i);
  assert.equal(pool.state.creditTransactions.filter((entry) => entry.type === "worker_payment").length, 1);
});

test("scheduler builtin side effects: worker-level daily spend cap blocks overspend", async () => {
  const pool = createMockPool({
    balanceUsd: 100,
    sideEffects: [{
      id: "wse_existing_1",
      tenant_id: "tenant_1",
      worker_id: "worker_1",
      execution_id: "exec_prev",
      tool_name: "make_payment",
      idempotency_key: "prev-payment",
      request_hash: "hash_prev",
      request_json: { amount_usd: 90, recipient: "Vendor", description: "Earlier payment" },
      status: "succeeded",
      target: "Vendor",
      amount_usd: 90,
      provider_ref: "txn_prev",
      response_json: { transaction_id: "txn_prev", amount_usd: 90 },
      error_text: null,
    }],
  });
  setPool(pool);

  const blocked = await executeBuiltinTool("make_payment", {
    amount_usd: 20,
    recipient: "Stripe",
    description: "API usage",
  }, {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_2",
    tool_call_id: "tool_payment_2",
  });

  assert.equal(blocked.success, false);
  assert.match(blocked.error, /daily amount limit exceeded/i);
  assert.equal(pool.state.creditTransactions.length, 0);
});

test("scheduler builtin side effects: failed send_email attempts are recorded and replayed without re-execution", async () => {
  const pool = createMockPool();
  setPool(pool);

  const meta = {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_email_1",
    tool_call_id: "tool_email_1",
  };
  const args = {
    to: "alice@example.com",
    subject: "Daily report",
    body: "Hello",
  };

  const first = await executeBuiltinTool("send_email", args, meta);
  const replay = await executeBuiltinTool("send_email", args, meta);

  assert.equal(first.success, false);
  assert.match(first.error, /not configured/i);
  assert.equal(replay.success, false);
  assert.match(replay.error, /not configured/i);
  assert.equal(pool.state.sideEffects.length, 1);
  assert.equal(pool.state.sideEffects[0].status, "failed");
});

test("scheduler builtin side effects: duplicate make_payment requests are blocked across executions by the safety envelope", async () => {
  const duplicateArgs = { amount_usd: 25, recipient: "Stripe", description: "API usage" };
  const pool = createMockPool({
    balanceUsd: 500,
    sideEffects: [{
      id: "wse_dup_payment_1",
      tenant_id: "tenant_1",
      worker_id: "worker_prev",
      execution_id: "exec_prev",
      tool_name: "make_payment",
      idempotency_key: "prev-payment",
      request_hash: buildSideEffectRequestHash("make_payment", duplicateArgs),
      request_json: duplicateArgs,
      status: "succeeded",
      target: "Stripe",
      amount_usd: 25,
      provider_ref: "txn_prev",
      response_json: { transaction_id: "txn_prev", amount_usd: 25 },
      error_text: null,
    }],
  });
  setPool(pool);

  const result = await executeBuiltinTool("make_payment", duplicateArgs, {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_new",
    tool_call_id: "tool_payment_new",
  });

  assert.equal(result.success, false);
  assert.match(result.error, /duplicate safety envelope/i);
  assert.equal(pool.state.creditTransactions.length, 0);
});

test("scheduler builtin side effects: target-level payment cap blocks overspend to the same recipient", async () => {
  const pool = createMockPool({
    balanceUsd: 500,
    sideEffects: [{
      id: "wse_target_payment_1",
      tenant_id: "tenant_1",
      worker_id: "worker_prev",
      execution_id: "exec_prev",
      tool_name: "make_payment",
      idempotency_key: "prev-target-payment",
      request_hash: "hash_prev_target_payment",
      request_json: { amount_usd: 50, recipient: "Vendor A", description: "Earlier payment" },
      status: "succeeded",
      target: "Vendor A",
      amount_usd: 50,
      provider_ref: "txn_prev_target",
      response_json: { transaction_id: "txn_prev_target", amount_usd: 50 },
      error_text: null,
    }],
  });
  setPool(pool);

  const result = await executeBuiltinTool("make_payment", {
    amount_usd: 15,
    recipient: "Vendor A",
    description: "Follow-up payment",
  }, {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_target_cap",
    tool_call_id: "tool_target_cap",
    charter: {
      toolLimits: {
        make_payment: {
          maxDailySpendUsd: 500,
          maxTenantDailySpendUsd: 500,
          maxTargetDailySpendUsd: 60,
        },
      },
    },
  });

  assert.equal(result.success, false);
  assert.match(result.error, /target daily amount limit exceeded/i);
  assert.equal(pool.state.creditTransactions.length, 0);
});

test("scheduler builtin side effects: duplicate request_payment requests are blocked across executions by the safety envelope", async () => {
  const duplicateArgs = { amount_usd: 100, from: "Client A", description: "Invoice 123", due_date: "2026-04-05" };
  const pool = createMockPool({
    sideEffects: [{
      id: "wse_dup_request_1",
      tenant_id: "tenant_1",
      worker_id: "worker_prev",
      execution_id: "exec_prev_request",
      tool_name: "request_payment",
      idempotency_key: "prev-request",
      request_hash: buildSideEffectRequestHash("request_payment", duplicateArgs),
      request_json: duplicateArgs,
      status: "succeeded",
      target: "Client A",
      amount_usd: 100,
      provider_ref: "pr_prev",
      response_json: { request_id: "pr_prev", amount_usd: 100 },
      error_text: null,
    }],
  });
  setPool(pool);

  const result = await executeBuiltinTool("request_payment", duplicateArgs, {
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: "exec_new_request",
    tool_call_id: "tool_request_new",
  });

  assert.equal(result.success, false);
  assert.match(result.error, /duplicate safety envelope/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { handleWorkerRoute } from "../services/runtime/workers-api.js";

function makeReq(path, headers = {}) {
  const req = Readable.from([]);
  req.method = "GET";
  req.url = path;
  req.headers = headers;
  return req;
}

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    writeHead(status, nextHeaders) {
      this.statusCode = status;
      for (const [key, value] of Object.entries(nextHeaders || {})) {
        headers.set(String(key).toLowerCase(), String(value));
      }
    },
    end(payload = "") {
      this.body = String(payload);
      this.ended = true;
    },
  };
}

function createPool() {
  const worker = { id: "worker_1", name: "Alpha Worker" };
  const execution = {
    id: "exec_1",
    worker_id: "worker_1",
    trigger_type: "manual",
    status: "failed",
    model: "openai/gpt-4.1-mini",
    started_at: "2026-03-29T12:00:00.000Z",
    completed_at: "2026-03-29T12:05:00.000Z",
    tokens_in: 10,
    tokens_out: 32,
    cost_usd: 0.125,
    rounds: 2,
    tool_calls: 1,
    result: "done",
    error: "verification failed",
    activity: [
      { type: "start", timestamp: "2026-03-29T12:00:00.000Z" },
      { type: "error", timestamp: "2026-03-29T12:05:00.000Z", message: "verification failed" },
    ],
    receipt: {
      executionId: "exec_1",
      interruption: { code: "charter_blocked", detail: "approval denied" },
      verificationReport: {
        businessOutcome: "failed",
        assertions: [
          { type: "no_errors_in_log", passed: false, evidence: "verification failed" },
        ],
      },
    },
    metadata: { source: "test" },
  };
  const approvals = [
    {
      id: "appr_1",
      execution_id: "exec_1",
      tool_name: "send_email",
      action: "Send invoice reminder",
      matched_rule: "Send invoice reminders",
      action_hash: "hash_1",
      status: "approved",
      decision: "approved",
      decided_by: "tenant_1",
      decided_at: "2026-03-29T12:01:00.000Z",
      created_at: "2026-03-29T12:00:30.000Z",
      tool_args: { to: "alice@example.com" },
    },
  ];
  const sideEffects = [
    {
      id: "wse_1",
      execution_id: "exec_1",
      tool_name: "send_email",
      idempotency_key: "idem_1",
      status: "failed",
      target: "alice@example.com",
      amount_usd: null,
      provider_ref: null,
      error_text: "Resend timeout",
      replay_count: 2,
      last_replayed_at: "2026-03-29T12:06:00.000Z",
      request_json: { to: "alice@example.com", subject: "Reminder" },
      response_json: { error: "Resend timeout" },
      created_at: "2026-03-29T12:00:20.000Z",
      updated_at: "2026-03-29T12:06:00.000Z",
    },
  ];

  return {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized === "SELECT id, name FROM workers WHERE id = $1 AND tenant_id = $2") {
        return { rowCount: 1, rows: [worker] };
      }
      if (normalized.startsWith("SELECT id, worker_id, trigger_type, status, model, started_at, completed_at,")) {
        return { rowCount: 1, rows: [execution] };
      }
      if (normalized.startsWith("SELECT id, execution_id, tool_name, action, matched_rule, action_hash, status, decision,")) {
        return { rowCount: approvals.length, rows: approvals };
      }
      if (normalized.startsWith("SELECT id, execution_id, tool_name, idempotency_key, status, target, amount_usd,")) {
        if (normalized.includes("request_json, response_json")) {
          return { rowCount: sideEffects.length, rows: sideEffects };
        }
        return {
          rowCount: sideEffects.length,
          rows: sideEffects.map(({ request_json, response_json, ...row }) => row),
        };
      }
      throw new Error(`Unhandled SQL in operator drilldown test: ${normalized}`);
    },
  };
}

test("scheduler operator drilldowns: latest execution route returns normalized execution evidence", async () => {
  const pool = createPool();
  const req = makeReq("/v1/workers/worker_1/executions/latest", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.workerName, "Alpha Worker");
  assert.equal(payload.id, "exec_1");
  assert.equal(payload.tokens, 42);
  assert.equal(payload.verificationReport.businessOutcome, "failed");
  assert.equal(payload.interruption.code, "charter_blocked");
  assert.equal(payload.approvals[0].toolArgs.to, "alice@example.com");
  assert.equal(payload.sideEffects[0].id, "wse_1");
  assert.equal(payload.sideEffects[0].requestJson.subject, "Reminder");
});

test("scheduler operator drilldowns: approvals timeline route returns execution-scoped approvals", async () => {
  const pool = createPool();
  const req = makeReq("/v1/workers/worker_1/executions/exec_1/approvals", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.workerName, "Alpha Worker");
  assert.equal(payload.executionId, "exec_1");
  assert.equal(payload.count, 1);
  assert.equal(payload.approvals[0].matchedRule, "Send invoice reminders");
});

test("scheduler operator drilldowns: worker side-effect routes return journal list and detail", async () => {
  const pool = createPool();

  const listReq = makeReq("/v1/workers/worker_1/side-effects?replayed=true&limit=5", { "x-tenant-id": "tenant_1" });
  const listRes = makeRes();
  const listUrl = new URL(listReq.url, "http://localhost");
  const listHandled = await handleWorkerRoute(listReq, listRes, pool, listUrl.pathname, listUrl.searchParams);
  assert.equal(listHandled, true);
  assert.equal(listRes.statusCode, 200);
  const listPayload = JSON.parse(listRes.body);
  assert.equal(listPayload.count, 1);
  assert.equal(listPayload.sideEffects[0].replayCount, 2);

  const detailReq = makeReq("/v1/workers/worker_1/side-effects/wse_1", { "x-tenant-id": "tenant_1" });
  const detailRes = makeRes();
  const detailUrl = new URL(detailReq.url, "http://localhost");
  const detailHandled = await handleWorkerRoute(detailReq, detailRes, pool, detailUrl.pathname, detailUrl.searchParams);
  assert.equal(detailHandled, true);
  assert.equal(detailRes.statusCode, 200);
  const detailPayload = JSON.parse(detailRes.body);
  assert.equal(detailPayload.sideEffect.idempotencyKey, "idem_1");
  assert.equal(detailPayload.sideEffect.responseJson.error, "Resend timeout");
});

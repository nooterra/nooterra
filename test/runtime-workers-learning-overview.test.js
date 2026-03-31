import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { buildPendingRiskQueue, buildTenantLearningOverview, handleWorkerRoute } from "../services/runtime/workers-api.js";

function isoHoursAgo(hours) {
  return new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
}

function sampleOverviewFixture() {
  return {
    workers: [
      {
        id: "worker_a",
        name: "Alpha Worker",
        charter: {
          askFirst: ["Send invoice reminders"],
        },
      },
      {
        id: "worker_b",
        name: "Beta Worker",
        charter: {
          askFirst: ["Refund invoices over $500"],
        },
      },
    ],
    executions: [
      {
        id: "exec_a_1",
        worker_id: "worker_a",
        status: "completed",
        started_at: "2026-03-29T12:00:00.000Z",
        receipt: {
          executionId: "exec_a_1",
          verificationReport: {
            businessOutcome: "passed",
            assertions: [{ type: "no_errors_in_log", passed: true }],
          },
        },
      },
      {
        id: "exec_b_1",
        worker_id: "worker_b",
        status: "failed",
        started_at: "2026-03-29T13:00:00.000Z",
        receipt: {
          executionId: "exec_b_1",
          interruption: { code: "charter_blocked", detail: "blocked" },
          verificationReport: {
            businessOutcome: "failed",
            assertions: [{ type: "no_errors_in_log", passed: false, evidence: "tool error" }],
          },
        },
      },
    ],
    approvals: [
      {
        worker_id: "worker_a",
        matched_rule: "Send invoice reminders",
        status: "approved",
        decision: "approved",
        created_at: isoHoursAgo(5),
      },
      {
        worker_id: "worker_b",
        matched_rule: "Refund invoices over $500",
        status: "denied",
        decision: "denied",
        created_at: isoHoursAgo(4),
      },
      {
        worker_id: "worker_b",
        tool_name: "make_payment",
        matched_rule: "Refund invoices over $500",
        status: "edited",
        decision: "edited",
        created_at: isoHoursAgo(2),
      },
    ],
    signals: [
      {
        worker_id: "worker_a",
        tool_name: "send_email",
        charter_verdict: "askFirst",
        approval_decision: "approved",
        matched_rule: "Send invoice reminders",
        tool_success: true,
        interruption_code: null,
        execution_outcome: "success",
        created_at: "2026-03-29T12:01:00.000Z",
      },
      {
        worker_id: "worker_b",
        tool_name: "make_payment",
        charter_verdict: "askFirst",
        approval_decision: "denied",
        matched_rule: "Refund invoices over $500",
        tool_success: false,
        interruption_code: "charter_blocked",
        execution_outcome: "blocked",
        created_at: "2026-03-29T13:01:00.000Z",
      },
    ],
    sideEffects: [
      {
        id: "wse_1",
        worker_id: "worker_a",
        execution_id: "exec_a_1",
        tool_name: "send_email",
        idempotency_key: "idem_a_1",
        status: "failed",
        target: "alice@example.com",
        provider_ref: null,
        error_text: "Resend email request timed out",
        replay_count: 2,
        last_replayed_at: "2026-03-29T12:05:00.000Z",
        created_at: "2026-03-29T12:00:30.000Z",
        updated_at: "2026-03-29T12:05:00.000Z",
      },
    ],
    webhookIngress: [
      {
        id: "ing_a_1",
        worker_id: "worker_a",
        execution_id: "exec_a_1",
        provider: "twilio",
        dedupe_key: "wh_a_1",
        request_path: "/v1/workers/worker_a/trigger",
        content_type: "application/x-www-form-urlencoded",
        signature_scheme: "twilio_signature_v1",
        signature_status: "verified",
        signature_error: null,
        status: "accepted",
        replay_count: 3,
        last_replayed_at: "2026-03-29T12:04:00.000Z",
        dead_letter_reason: null,
        processed_at: "2026-03-29T12:00:20.000Z",
        created_at: "2026-03-29T12:00:10.000Z",
        updated_at: "2026-03-29T12:04:00.000Z",
      },
      {
        id: "ing_b_1",
        worker_id: "worker_b",
        execution_id: null,
        provider: "generic",
        dedupe_key: "wh_b_1",
        request_path: "/v1/workers/worker_b/trigger",
        content_type: "application/json",
        signature_scheme: "hmac_sha256",
        signature_status: "rejected",
        signature_error: "signature mismatch",
        status: "dead_letter",
        replay_count: 0,
        last_replayed_at: null,
        dead_letter_reason: "signature_invalid",
        processed_at: null,
        created_at: "2026-03-29T13:00:05.000Z",
        updated_at: "2026-03-29T13:00:05.000Z",
      },
      {
        id: "ing_b_2",
        worker_id: "worker_b",
        execution_id: null,
        provider: "generic",
        dedupe_key: "wh_b_2",
        request_path: "/v1/workers/worker_b/trigger",
        content_type: "application/json",
        signature_scheme: "hmac_sha256",
        signature_status: "rejected",
        signature_error: "signature mismatch",
        status: "dead_letter",
        replay_count: 0,
        last_replayed_at: null,
        dead_letter_reason: "signature_invalid",
        processed_at: null,
        created_at: "2026-03-29T13:00:06.000Z",
        updated_at: "2026-03-29T13:00:06.000Z",
      },
      {
        id: "ing_b_3",
        worker_id: "worker_b",
        execution_id: null,
        provider: "generic",
        dedupe_key: "wh_b_3",
        request_path: "/v1/workers/worker_b/trigger",
        content_type: "application/json",
        signature_scheme: "hmac_sha256",
        signature_status: "rejected",
        signature_error: "signature mismatch",
        status: "dead_letter",
        replay_count: 0,
        last_replayed_at: null,
        dead_letter_reason: "signature_invalid",
        processed_at: null,
        created_at: "2026-03-29T13:00:07.000Z",
        updated_at: "2026-03-29T13:00:07.000Z",
      },
    ],
    workerPolicies: [],
  };
}

function makeOverviewPool(fixture, label) {
  return {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized === "SELECT policy, updated_at, updated_by FROM tenant_worker_runtime_policies WHERE tenant_id = $1") {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.startsWith("SELECT id, name, charter FROM workers")) {
        return { rowCount: fixture.workers.length, rows: fixture.workers };
      }
      if (normalized.startsWith("SELECT id, worker_id, status, started_at, completed_at, receipt FROM worker_executions")) {
        return { rowCount: fixture.executions.length, rows: fixture.executions };
      }
      if (normalized.startsWith("SELECT worker_id, tool_name, matched_rule, status, decision, decided_at, created_at FROM worker_approvals")) {
        return { rowCount: fixture.approvals.length, rows: fixture.approvals };
      }
      if (normalized.startsWith("SELECT worker_id, tool_name, args_hash, charter_verdict, approval_decision, matched_rule,")) {
        return { rowCount: fixture.signals.length, rows: fixture.signals };
      }
      if (normalized.startsWith("SELECT id, worker_id, execution_id, tool_name, idempotency_key, status, target, amount_usd,")) {
        return { rowCount: fixture.sideEffects.length, rows: fixture.sideEffects };
      }
      if (normalized.startsWith("SELECT id, worker_id, execution_id, provider, dedupe_key, request_path, content_type,")) {
        return { rowCount: fixture.webhookIngress.length, rows: fixture.webhookIngress };
      }
      if (normalized.startsWith("SELECT worker_id, policy, updated_at, updated_by FROM worker_runtime_policy_overrides")) {
        return { rowCount: fixture.workerPolicies.length, rows: fixture.workerPolicies };
      }
      throw new Error(`Unhandled SQL in ${label}: ${normalized}`);
    },
  };
}

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

test("scheduler workers learning overview: aggregates worker risk, verifier failures, and side-effect replays", () => {
  const fixture = sampleOverviewFixture();
  const overview = buildTenantLearningOverview({
    ...fixture,
    lookbackDays: 30,
  });

  assert.equal(overview.summary.workersEvaluated, 2);
  assert.equal(overview.summary.promotionCandidates, 0);
  assert.equal(overview.summary.unstableRules, 1);
  assert.equal(overview.summary.verifierFailures, 1);
  assert.equal(overview.summary.sideEffects.failed, 1);
  assert.equal(overview.summary.sideEffects.replayCount, 2);
  assert.equal(overview.summary.webhookIngress.deadLetters, 3);
  assert.equal(overview.summary.webhookIngress.replayCount, 3);
  assert.equal(overview.summary.webhookAnomalies, 3);
  assert.equal(overview.summary.approvalAnomalies, 1);
  assert.equal(overview.workers[0].workerId, "worker_b");
  const workerA = overview.workers.find((worker) => worker.workerId === "worker_a");
  const workerB = overview.workers.find((worker) => worker.workerId === "worker_b");
  assert.equal(workerA.sideEffects.replayCount, 2);
  assert.equal(workerA.webhookIngress.replayCount, 3);
  assert.equal(workerA.webhookAnomalies.length, 1);
  assert.equal(workerB.webhookAnomalies.length, 2);
  assert.equal(workerB.approvalAnomalies.length, 1);
  assert.equal(overview.recentSideEffectReplays[0].workerId, "worker_a");
  assert.equal(overview.recentVerifierFailures[0].workerId, "worker_b");
  assert.equal(overview.recentWebhookDeadLetters[0].workerId, "worker_b");
  assert.equal(overview.recentWebhookReplays[0].workerId, "worker_a");
  assert.equal(overview.recentWebhookAnomalies[0].kind, "repeated_signature_failures");
  assert.equal(overview.recentApprovalAnomalies[0].workerId, "worker_b");
  assert.equal(overview.topUnstableRules[0].rule, "Refund invoices over $500");
});

test("scheduler workers pending risk queue: prioritizes workers needing operator attention", () => {
  const fixture = sampleOverviewFixture();
  const overview = buildTenantLearningOverview({
    ...fixture,
    lookbackDays: 30,
  });
  const queue = buildPendingRiskQueue(overview, { limit: 10 });

  assert.equal(queue.count, 2);
  assert.equal(queue.items[0].workerId, "worker_b");
  assert.match(queue.items[0].reasons.join(" | "), /verifier failure/i);
  assert.match(queue.items[0].reasons.join(" | "), /dead-lettered webhook/i);
  assert.match(queue.items[0].reasons.join(" | "), /webhook anomaly alert/i);
  assert.match(queue.items[0].reasons.join(" | "), /approval anomaly alert/i);
  assert.match(queue.items[0].reasons.join(" | "), /unstable charter rule/i);
  assert.equal(queue.items[1].workerId, "worker_a");
  assert.match(queue.items[1].reasons.join(" | "), /failed side effect/i);
  assert.match(queue.items[1].reasons.join(" | "), /replayed side effect/i);
  assert.match(queue.items[1].reasons.join(" | "), /replayed webhook delivery/i);
  assert.match(queue.items[1].reasons.join(" | "), /webhook anomaly alert/i);
});

test("scheduler workers learning overview route: returns tenant-wide explainability summary", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "overview route test");

  const req = makeReq("/v1/workers/learning/overview?days=14", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.lookbackDays, 14);
  assert.equal(payload.summary.workersEvaluated, 2);
  assert.equal(payload.summary.sideEffects.replayCount, 2);
  assert.equal(payload.summary.webhookIngress.deadLetters, 3);
  assert.equal(payload.summary.webhookAnomalies, 3);
  assert.equal(payload.summary.approvalAnomalies, 1);
  assert.equal(payload.recentSideEffectFailures[0].error, "Resend email request timed out");
  assert.equal(payload.recentWebhookDeadLetters[0].deadLetterReason, "signature_invalid");
  assert.equal(payload.recentWebhookAnomalies[0].kind, "repeated_signature_failures");
  assert.equal(payload.recentApprovalAnomalies[0].workerId, "worker_b");
});

test("scheduler workers verification failures route: returns recent verifier failures", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "verification failures route test");

  const req = makeReq("/v1/workers/verification/failures?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 1);
  assert.equal(payload.failures[0].workerId, "worker_b");
  assert.equal(payload.failures[0].businessOutcome, "failed");
});

test("scheduler workers side-effect replay route: returns recent replayed outbound side effects", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "side-effect replay route test");

  const req = makeReq("/v1/workers/side-effects/replays?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 1);
  assert.equal(payload.replays[0].workerId, "worker_a");
  assert.equal(payload.replays[0].replayCount, 2);
});

test("scheduler workers risk queue route: returns workers sorted by risk score", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "risk queue route test");

  const req = makeReq("/v1/workers/risk/queue?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 2);
  assert.equal(payload.items[0].workerId, "worker_b");
  assert.equal(payload.items[1].workerId, "worker_a");
  assert.equal(payload.items[0].deadLetteredWebhooks, 3);
  assert.equal(payload.items[0].webhookAnomalies, 2);
  assert.equal(payload.items[0].approvalAnomalies, 1);
  assert.equal(payload.items[1].replayedWebhooks, 1);
  assert.equal(payload.items[1].webhookAnomalies, 1);
});

test("scheduler workers webhook dead-letter route: returns recent dead-lettered inbound deliveries", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "webhook dead-letter route test");

  const req = makeReq("/v1/workers/webhooks/dead-letters?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 3);
  assert.equal(payload.deadLetters[0].workerId, "worker_b");
  assert.equal(payload.deadLetters[0].deadLetterReason, "signature_invalid");
});

test("scheduler workers webhook replay route: returns recent replayed inbound deliveries", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "webhook replay route test");

  const req = makeReq("/v1/workers/webhooks/replays?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 1);
  assert.equal(payload.replays[0].workerId, "worker_a");
  assert.equal(payload.replays[0].replayCount, 3);
});

test("scheduler workers webhook anomaly route: returns recent inbound anomaly alerts", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "webhook anomaly route test");

  const req = makeReq("/v1/workers/webhooks/anomalies?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 3);
  assert.equal(payload.anomalies[0].kind, "repeated_signature_failures");
  assert.equal(payload.anomalies[0].workerId, "worker_b");
});

test("scheduler workers approval anomaly route: returns recent approval anomaly alerts", async () => {
  const fixture = sampleOverviewFixture();
  const pool = makeOverviewPool(fixture, "approval anomaly route test");

  const req = makeReq("/v1/workers/approvals/anomalies?limit=5", { "x-tenant-id": "tenant_1" });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.count, 1);
  assert.equal(payload.anomalies[0].workerId, "worker_b");
  assert.equal(payload.anomalies[0].kind, "approval_thrash");
  assert.match(payload.anomalies[0].reason, /negative approval/i);
});

test("scheduler workers learning overview: worker runtime policy overrides affect anomaly thresholds", () => {
  const fixture = sampleOverviewFixture();
  fixture.workerPolicies = [{
    worker_id: "worker_b",
    policy: {
      version: 1,
      approvals: {
        restrictThreshold: 3,
      },
      webhooks: {
        thresholds: {
          signatureFailuresPerProvider: 4,
        },
      },
    },
    updated_at: "2026-03-31T14:00:00.000Z",
    updated_by: "ops@example.com",
  }];

  const overview = buildTenantLearningOverview({
    ...fixture,
    runtimePolicy: {},
    lookbackDays: 30,
  });

  const workerB = overview.workers.find((worker) => worker.workerId === "worker_b");
  assert.equal(workerB.approvalAnomalies.length, 0);
  assert.equal(workerB.webhookAnomalies.length, 1);
  assert.equal(workerB.runtimePolicy.workerOverride, true);
  assert.equal(overview.summary.approvalAnomalies, 0);
});

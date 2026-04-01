import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";

import { handleWorkerRoute } from "../services/runtime/workers-api.js";
import {
  normalizeWorkerWebhookEvent,
  parseWorkerWebhookPayload,
  resolveWebhookEnforcementDecision,
  summarizeWebhookAnomalies,
  verifyWorkerWebhookRequest,
} from "../services/runtime/webhook-ingress.js";

function makeReq(method, path, body = "", headers = {}) {
  const req = Readable.from(body ? [body] : []);
  req.method = method;
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

function createTimestampedSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function createTwilioSignature(secret, url, params) {
  const pairs = Object.entries(params).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const byKey = leftKey.localeCompare(rightKey);
    if (byKey !== 0) return byKey;
    return String(leftValue).localeCompare(String(rightValue));
  });
  const payload = `${url}${pairs.map(([key, value]) => `${key}${value}`).join("")}`;
  return crypto
    .createHmac("sha1", secret)
    .update(payload)
    .digest("base64");
}

function createTriggerPool({ workerStatus = "ready", triggers = null, seedIngress = [], runtimePolicy = null } = {}) {
  const state = {
    worker: {
      id: "worker_1",
      name: "Inbound Worker",
      model: "openai/gpt-4.1-mini",
      status: workerStatus,
      triggers: triggers ?? {
        webhook: {
          signatureMode: "hmac-sha256",
          signatureSecret: "whsec_test_1",
          dedupeKeyField: "event.id",
        },
      },
    },
    ingress: seedIngress.map((entry) => ({ ...entry })),
    executions: [],
    runtimePolicy,
    workerRuntimePolicy: null,
  };

  function normalize(sql) {
    return String(sql).replace(/\s+/g, " ").trim();
  }

  function mapIngress(row) {
    return {
      ...row,
      headers_json: row.headers_json,
      payload_json: row.payload_json,
    };
  }

  async function query(sql, params = []) {
    const statement = normalize(sql);

    if (statement === "SELECT id, model, status, triggers FROM workers WHERE id = $1 AND tenant_id = $2") {
      return {
        rowCount: 1,
        rows: [{
          id: state.worker.id,
          model: state.worker.model,
          status: state.worker.status,
          triggers: state.worker.triggers,
        }],
      };
    }

    if (statement === "SELECT policy, updated_at, updated_by FROM tenant_worker_runtime_policies WHERE tenant_id = $1") {
      return state.runtimePolicy
        ? {
          rowCount: 1,
          rows: [state.runtimePolicy],
        }
        : { rowCount: 0, rows: [] };
    }

    if (statement === "SELECT policy, updated_at, updated_by FROM worker_runtime_policy_overrides WHERE tenant_id = $1 AND worker_id = $2") {
      return state.workerRuntimePolicy
        ? {
          rowCount: 1,
          rows: [state.workerRuntimePolicy],
        }
        : { rowCount: 0, rows: [] };
    }

    if (statement === "SELECT id, name FROM workers WHERE id = $1 AND tenant_id = $2") {
      return {
        rowCount: 1,
        rows: [{ id: state.worker.id, name: state.worker.name }],
      };
    }

    if (statement.startsWith("UPDATE workers SET")) {
      state.worker.status = "paused";
      return { rowCount: 1, rows: [{ id: state.worker.id, status: state.worker.status }] };
    }

    if (statement.startsWith("SELECT id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,")) {
      if (statement.includes("AND provider = $3") && statement.includes("AND created_at >= $4")) {
        const [workerId, tenantId, provider] = params;
        const rows = state.ingress
          .filter((entry) =>
            entry.worker_id === workerId
            && entry.tenant_id === tenantId
            && entry.provider === provider
          )
          .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
        return { rowCount: rows.length, rows: rows.map(mapIngress) };
      }

      if (statement.includes("WHERE worker_id = $1 AND tenant_id = $2 AND dedupe_key = $3")) {
        const [workerId, tenantId, dedupeKey] = params;
        const row = state.ingress.find((entry) =>
          entry.worker_id === workerId && entry.tenant_id === tenantId && entry.dedupe_key === dedupeKey
        );
        return { rowCount: row ? 1 : 0, rows: row ? [mapIngress(row)] : [] };
      }

      if (statement.includes("WHERE id = $1 AND worker_id = $2 AND tenant_id = $3")) {
        const [ingressId, workerId, tenantId] = params;
        const row = state.ingress.find((entry) =>
          entry.id === ingressId && entry.worker_id === workerId && entry.tenant_id === tenantId
        );
        return { rowCount: row ? 1 : 0, rows: row ? [mapIngress(row)] : [] };
      }

      if (statement.includes("WHERE worker_id = $1 AND tenant_id = $2")) {
        const [workerId, tenantId] = params;
        const rows = state.ingress
          .filter((entry) => entry.worker_id === workerId && entry.tenant_id === tenantId)
          .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
        return { rowCount: rows.length, rows: rows.map(mapIngress) };
      }
    }

    if (statement.startsWith("INSERT INTO worker_webhook_ingress")) {
      const [
        id,
        tenantId,
        workerId,
        provider,
        dedupeKey,
        requestPath,
        contentType,
        signatureScheme,
        signatureStatus,
        signatureError,
        status,
        headersJson,
        payloadJson,
        rawBody,
        deadLetterReason,
      ] = params;

      const existing = state.ingress.find((entry) =>
        entry.worker_id === workerId && entry.tenant_id === tenantId && entry.dedupe_key === dedupeKey
      );
      if (existing) return { rowCount: 0, rows: [] };

      const now = new Date().toISOString();
      const row = {
        id,
        tenant_id: tenantId,
        worker_id: workerId,
        execution_id: null,
        provider,
        dedupe_key: dedupeKey,
        request_path: requestPath,
        content_type: contentType,
        signature_scheme: signatureScheme,
        signature_status: signatureStatus,
        signature_error: signatureError,
        status,
        headers_json: JSON.parse(headersJson),
        payload_json: payloadJson == null ? null : JSON.parse(payloadJson),
        raw_body: rawBody,
        replay_count: 0,
        last_replayed_at: null,
        dead_letter_reason: deadLetterReason,
        created_at: now,
        updated_at: now,
        processed_at: null,
      };
      state.ingress.push(row);
      return { rowCount: 1, rows: [mapIngress(row)] };
    }

    if (statement.startsWith("UPDATE worker_webhook_ingress SET replay_count = COALESCE(replay_count, 0) + 1")) {
      const [workerId, tenantId, dedupeKey] = params;
      const row = state.ingress.find((entry) =>
        entry.worker_id === workerId && entry.tenant_id === tenantId && entry.dedupe_key === dedupeKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.replay_count = Number(row.replay_count || 0) + 1;
      row.last_replayed_at = new Date().toISOString();
      row.updated_at = row.last_replayed_at;
      return { rowCount: 1, rows: [mapIngress(row)] };
    }

    if (statement.startsWith("UPDATE worker_webhook_ingress SET execution_id = $4")) {
      const [workerId, tenantId, dedupeKey, executionId] = params;
      const row = state.ingress.find((entry) =>
        entry.worker_id === workerId && entry.tenant_id === tenantId && entry.dedupe_key === dedupeKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.execution_id = executionId;
      row.processed_at = new Date().toISOString();
      row.updated_at = row.processed_at;
      return { rowCount: 1, rows: [mapIngress(row)] };
    }

    if (statement.startsWith("UPDATE worker_webhook_ingress SET status = 'dead_letter'")) {
      const [workerId, tenantId, dedupeKey, signatureError, deadLetterReason] = params;
      const row = state.ingress.find((entry) =>
        entry.worker_id === workerId && entry.tenant_id === tenantId && entry.dedupe_key === dedupeKey
      );
      if (!row) return { rowCount: 0, rows: [] };
      row.status = "dead_letter";
      row.signature_error = signatureError ?? row.signature_error;
      row.dead_letter_reason = deadLetterReason ?? row.dead_letter_reason;
      row.updated_at = new Date().toISOString();
      return { rowCount: 1, rows: [mapIngress(row)] };
    }

    if (statement.startsWith("INSERT INTO worker_executions")) {
      const [id, workerId, tenantId, triggerType, model, startedAt, activityJson, metadataJson] = params;
      const row = {
        id,
        worker_id: workerId,
        tenant_id: tenantId,
        trigger_type: triggerType,
        status: "queued",
        model,
        started_at: startedAt,
        activity: JSON.parse(activityJson),
        metadata: JSON.parse(metadataJson),
      };
      state.executions.push(row);
      return { rowCount: 1, rows: [row] };
    }

    throw new Error(`Unhandled SQL in webhook ingress test: ${statement}`);
  }

  return { state, query };
}

test("scheduler webhook ingress helpers: generic and Twilio signatures verify with stable payload parsing", () => {
  const genericBody = JSON.stringify({ event: { id: "evt_1" }, payload: { ok: true } });
  const genericTimestamp = Math.floor(Date.now() / 1000);
  const genericSignature = createTimestampedSignature("whsec_generic", genericTimestamp, genericBody);
  const genericPayload = parseWorkerWebhookPayload(genericBody, "application/json");

  const generic = verifyWorkerWebhookRequest({
    rawBody: genericBody,
    payload: genericPayload,
    headers: {
      "x-nooterra-timestamp": String(genericTimestamp),
      "x-nooterra-signature": genericSignature,
    },
    config: {
      webhook: {
        signatureMode: "hmac-sha256",
        signatureSecret: "whsec_generic",
      },
    },
    req: { url: "/v1/workers/worker_1/trigger", headers: {} },
  });
  assert.equal(generic.scheme, "hmac-sha256");
  assert.equal(generic.status, "verified");

  const twilioParams = {
    Body: "Hello there",
    From: "+15551234567",
    MessageSid: "SM123",
  };
  const twilioBody = new URLSearchParams(twilioParams).toString();
  const twilioUrl = "https://example.com/v1/workers/worker_1/trigger";
  const twilioSignature = createTwilioSignature("twilio_token", twilioUrl, twilioParams);
  const twilioPayload = parseWorkerWebhookPayload(twilioBody, "application/x-www-form-urlencoded");
  const twilio = verifyWorkerWebhookRequest({
    rawBody: twilioBody,
    payload: twilioPayload,
    headers: {
      "x-twilio-signature": twilioSignature,
    },
    config: {
      webhook: {
        provider: "twilio",
        signatureSecret: "twilio_token",
        publicUrl: twilioUrl,
      },
    },
    req: { url: "/v1/workers/worker_1/trigger", headers: {} },
  });
  assert.equal(twilio.scheme, "twilio");
  assert.equal(twilio.status, "verified");
});

test("scheduler webhook ingress helpers: normalize Twilio and email-style inbound payloads", () => {
  const twilioEvent = normalizeWorkerWebhookEvent({
    payload: {
      Body: "Hello there",
      From: "+15551234567",
      To: "+15557654321",
      MessageSid: "SM123",
    },
    config: { webhook: { provider: "twilio" } },
    contentType: "application/x-www-form-urlencoded",
  });
  assert.equal(twilioEvent.channel, "sms");
  assert.equal(twilioEvent.eventType, "sms_received");
  assert.equal(twilioEvent.id, "SM123");
  assert.equal(twilioEvent.from.address, "+15551234567");
  assert.equal(twilioEvent.to[0].address, "+15557654321");

  const emailEvent = normalizeWorkerWebhookEvent({
    payload: {
      type: "email.received",
      data: {
        from: "Alice Example <alice@example.com>",
        to: ["support@example.com"],
        subject: "Need help",
        text: "Can you call me back?",
        messageId: "msg_123",
      },
    },
    config: { webhook: { provider: "resend" } },
    contentType: "application/json",
  });
  assert.equal(emailEvent.channel, "email");
  assert.equal(emailEvent.eventType, "email.received");
  assert.equal(emailEvent.id, "msg_123");
  assert.equal(emailEvent.from.address, "alice@example.com");
  assert.equal(emailEvent.to[0].address, "support@example.com");
  assert.equal(emailEvent.subject, "Need help");
});

test("scheduler webhook ingress helpers: summarize deterministic anomaly thresholds", () => {
  const anomalies = summarizeWebhookAnomalies([
    {
      provider: "twilio",
      status: "dead_letter",
      dead_letter_reason: "signature_invalid",
      signature_status: "rejected",
      signature_error: "signature mismatch",
      replay_count: 0,
      updated_at: "2026-03-31T10:00:00.000Z",
    },
    {
      provider: "twilio",
      status: "dead_letter",
      dead_letter_reason: "signature_invalid",
      signature_status: "rejected",
      signature_error: "signature mismatch",
      replay_count: 0,
      updated_at: "2026-03-31T10:01:00.000Z",
    },
    {
      provider: "twilio",
      status: "dead_letter",
      dead_letter_reason: "signature_invalid",
      signature_status: "rejected",
      signature_error: "signature mismatch",
      replay_count: 0,
      updated_at: "2026-03-31T10:02:00.000Z",
    },
    {
      provider: "resend",
      status: "accepted",
      replay_count: 3,
      updated_at: "2026-03-31T10:03:00.000Z",
    },
  ]);

  assert.equal(anomalies.length, 3);
  assert.equal(anomalies[0].kind, "repeated_signature_failures");
  assert.equal(anomalies[1].kind, "dead_letter_burst");
  assert.equal(anomalies[2].kind, "replay_spike");
});

test("scheduler webhook ingress helpers: map anomalies to deterministic enforcement decisions", () => {
  const autoPause = resolveWebhookEnforcementDecision([
    {
      provider: "twilio",
      status: "dead_letter",
      dead_letter_reason: "signature_invalid",
      signature_status: "rejected",
      signature_error: "signature mismatch",
      replay_count: 0,
      updated_at: "2026-03-31T10:00:00.000Z",
    },
    {
      provider: "twilio",
      status: "dead_letter",
      dead_letter_reason: "signature_invalid",
      signature_status: "rejected",
      signature_error: "signature mismatch",
      replay_count: 0,
      updated_at: "2026-03-31T10:01:00.000Z",
    },
    {
      provider: "twilio",
      status: "dead_letter",
      dead_letter_reason: "signature_invalid",
      signature_status: "rejected",
      signature_error: "signature mismatch",
      replay_count: 0,
      updated_at: "2026-03-31T10:02:00.000Z",
    },
  ]);
  assert.equal(autoPause.action, "auto_pause");
  assert.equal(autoPause.statusCode, 423);

  const cooldown = resolveWebhookEnforcementDecision([
    {
      provider: "resend",
      status: "accepted",
      replay_count: 3,
      updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  assert.equal(cooldown.action, "cooldown");
  assert.equal(cooldown.statusCode, 429);

  const forceApproval = resolveWebhookEnforcementDecision([
    {
      provider: "resend",
      status: "accepted",
      replay_count: 3,
      updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
  ]);
  assert.equal(forceApproval.action, "force_approval");
  assert.equal(forceApproval.forceApprovalReentry, true);
});

test("scheduler webhook ingress helpers: tenant overrides can lower replay thresholds", () => {
  const decision = resolveWebhookEnforcementDecision([
    {
      provider: "resend",
      status: "accepted",
      replay_count: 2,
      updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ], {
    policy: {
      thresholds: {
        replayCountPerProvider: 2,
        replayedDeliveriesPerProvider: 1,
      },
      enforcement: {
        cooldownMinutes: 10,
      },
    },
  });

  assert.equal(decision.action, "cooldown");
  assert.equal(decision.anomalies[0].kind, "replay_spike");
});

test("scheduler webhook ingress route: signed webhook is accepted once and replayed safely", async () => {
  const pool = createTriggerPool();
  const rawBody = JSON.stringify({
    event: { id: "evt_accepted_1" },
    payload: { customer: "alice@example.com" },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createTimestampedSignature("whsec_test_1", timestamp, rawBody);

  const firstReq = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(timestamp),
    "x-nooterra-signature": signature,
  });
  const firstRes = makeRes();
  const firstUrl = new URL(firstReq.url, "http://localhost");
  const firstHandled = await handleWorkerRoute(firstReq, firstRes, pool, firstUrl.pathname, firstUrl.searchParams);
  assert.equal(firstHandled, true);
  assert.equal(firstRes.statusCode, 202);
  const firstPayload = JSON.parse(firstRes.body);
  assert.ok(firstPayload.executionId);
  assert.ok(firstPayload.ingressId);

  const duplicateReq = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(timestamp),
    "x-nooterra-signature": signature,
  });
  const duplicateRes = makeRes();
  const duplicateUrl = new URL(duplicateReq.url, "http://localhost");
  await handleWorkerRoute(duplicateReq, duplicateRes, pool, duplicateUrl.pathname, duplicateUrl.searchParams);
  assert.equal(duplicateRes.statusCode, 200);
  const duplicatePayload = JSON.parse(duplicateRes.body);
  assert.equal(duplicatePayload.duplicate, true);
  assert.equal(duplicatePayload.executionId, firstPayload.executionId);
  assert.equal(duplicatePayload.ingress.replayCount, 1);

  const listReq = makeReq("GET", "/v1/workers/worker_1/webhooks?limit=5", "", {
    "x-tenant-id": "tenant_1",
  });
  const listRes = makeRes();
  const listUrl = new URL(listReq.url, "http://localhost");
  await handleWorkerRoute(listReq, listRes, pool, listUrl.pathname, listUrl.searchParams);
  assert.equal(listRes.statusCode, 200);
  const listPayload = JSON.parse(listRes.body);
  assert.equal(listPayload.count, 1);
  assert.equal(listPayload.ingress[0].executionId, firstPayload.executionId);

  const detailReq = makeReq("GET", `/v1/workers/worker_1/webhooks/${encodeURIComponent(firstPayload.ingressId)}`, "", {
    "x-tenant-id": "tenant_1",
  });
  const detailRes = makeRes();
  const detailUrl = new URL(detailReq.url, "http://localhost");
  await handleWorkerRoute(detailReq, detailRes, pool, detailUrl.pathname, detailUrl.searchParams);
  assert.equal(detailRes.statusCode, 200);
  const detailPayload = JSON.parse(detailRes.body);
  assert.equal(detailPayload.ingress.payload.event.id, "evt_accepted_1");
  assert.equal(detailPayload.ingress.headers["x-nooterra-signature"], signature);
  assert.equal(detailPayload.ingress.normalizedEvent.eventType, "webhook_received");
  assert.equal(pool.state.executions[0].metadata.webhookEvent.id, "evt_accepted_1");
});

test("scheduler webhook ingress route: invalid signature is dead-lettered with replay-safe evidence", async () => {
  const pool = createTriggerPool();
  const rawBody = JSON.stringify({
    event: { id: "evt_bad_sig_1" },
    payload: { customer: "bob@example.com" },
  });

  const req = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-nooterra-signature": "bad_signature",
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 403);
  assert.equal(pool.state.ingress.length, 1);
  assert.equal(pool.state.ingress[0].status, "dead_letter");
  assert.equal(pool.state.ingress[0].dead_letter_reason, "signature_invalid");
});

test("scheduler webhook ingress route: malformed JSON is captured as a dead letter", async () => {
  const pool = createTriggerPool({
    triggers: {
      webhook: {
        signatureMode: "none",
        dedupeKeyField: "event.id",
      },
    },
  });

  const rawBody = '{"event":{"id":"evt_bad_json"';
  const req = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 400);
  assert.equal(pool.state.ingress.length, 1);
  assert.equal(pool.state.ingress[0].status, "dead_letter");
  assert.equal(pool.state.ingress[0].dead_letter_reason, "payload_invalid");
  assert.equal(pool.state.ingress[0].raw_body, rawBody);
});

test("scheduler webhook ingress route: signature failure burst auto-pauses the worker", async () => {
  const seedIngress = [1, 2].map((index) => ({
    id: `ing_seed_sig_${index}`,
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: null,
    provider: "generic",
    dedupe_key: `seed_sig_${index}`,
    request_path: "/v1/workers/worker_1/trigger",
    content_type: "application/json",
    signature_scheme: "hmac-sha256",
    signature_status: "rejected",
    signature_error: "signature mismatch",
    status: "dead_letter",
    headers_json: {},
    payload_json: { event: { id: `evt_seed_${index}` } },
    raw_body: JSON.stringify({ event: { id: `evt_seed_${index}` } }),
    replay_count: 0,
    last_replayed_at: null,
    dead_letter_reason: "signature_invalid",
    created_at: `2026-03-31T10:0${index}:00.000Z`,
    updated_at: `2026-03-31T10:0${index}:00.000Z`,
    processed_at: null,
  }));
  const pool = createTriggerPool({ seedIngress });
  const rawBody = JSON.stringify({ event: { id: "evt_bad_sig_2" } });

  const req = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-nooterra-signature": "bad_signature",
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(res.statusCode, 423);
  assert.equal(pool.state.worker.status, "paused");
  const payload = JSON.parse(res.body);
  assert.equal(payload.enforcement.action, "auto_pause");
});

test("scheduler webhook ingress route: tenant runtime policy overrides apply to webhook enforcement", async () => {
  const seedIngress = [{
    id: "ing_seed_sig_policy",
    tenant_id: "tenant_1",
    worker_id: "worker_1",
    execution_id: null,
    provider: "generic",
    dedupe_key: "seed_sig_policy",
    request_path: "/v1/workers/worker_1/trigger",
    content_type: "application/json",
    signature_scheme: "hmac-sha256",
    signature_status: "rejected",
    signature_error: "signature mismatch",
    status: "dead_letter",
    headers_json: {},
    payload_json: { event: { id: "evt_seed_policy" } },
    raw_body: JSON.stringify({ event: { id: "evt_seed_policy" } }),
    replay_count: 0,
    last_replayed_at: null,
    dead_letter_reason: "signature_invalid",
    created_at: "2026-03-31T10:00:00.000Z",
    updated_at: "2026-03-31T10:00:00.000Z",
    processed_at: null,
  }];
  const pool = createTriggerPool({
    seedIngress,
    runtimePolicy: {
      policy: {
        version: 1,
        webhooks: {
          thresholds: {
            signatureFailuresPerProvider: 2,
          },
        },
      },
      updated_at: "2026-03-31T11:00:00.000Z",
      updated_by: "ops@example.com",
    },
  });
  const rawBody = JSON.stringify({ event: { id: "evt_bad_sig_policy" } });

  const req = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-nooterra-signature": "bad_signature",
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(res.statusCode, 423);
  const payload = JSON.parse(res.body);
  assert.equal(payload.enforcement.action, "auto_pause");
  assert.match(payload.enforcement.reason, /signature failures reached 2/i);
});

test("scheduler webhook ingress route: replay spike enters provider cooldown", async () => {
  const pool = createTriggerPool({
    seedIngress: [
      {
        id: "ing_seed_replay_1",
        tenant_id: "tenant_1",
        worker_id: "worker_1",
        execution_id: "exec_seed_1",
        provider: "generic",
        dedupe_key: "seed_replay_1",
        request_path: "/v1/workers/worker_1/trigger",
        content_type: "application/json",
        signature_scheme: "hmac-sha256",
        signature_status: "verified",
        signature_error: null,
        status: "accepted",
        headers_json: {},
        payload_json: { event: { id: "evt_seed_replay_1" } },
        raw_body: JSON.stringify({ event: { id: "evt_seed_replay_1" } }),
        replay_count: 3,
        last_replayed_at: new Date(Date.now() - 60 * 1000).toISOString(),
        dead_letter_reason: null,
        created_at: new Date(Date.now() - 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
        processed_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    ],
  });
  const rawBody = JSON.stringify({ event: { id: "evt_cooldown_1" } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createTimestampedSignature("whsec_test_1", timestamp, rawBody);

  const req = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(timestamp),
    "x-nooterra-signature": signature,
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(res.statusCode, 429);
  assert.equal(pool.state.executions.length, 0);
  const payload = JSON.parse(res.body);
  assert.equal(payload.enforcement.action, "cooldown");
  assert.equal(payload.ingress.deadLetterReason, "webhook_provider_cooldown");
});

test("scheduler webhook ingress route: stale replay spike forces approval re-entry on queued execution", async () => {
  const staleReplayTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const pool = createTriggerPool({
    seedIngress: [
      {
        id: "ing_seed_replay_2",
        tenant_id: "tenant_1",
        worker_id: "worker_1",
        execution_id: "exec_seed_2",
        provider: "generic",
        dedupe_key: "seed_replay_2",
        request_path: "/v1/workers/worker_1/trigger",
        content_type: "application/json",
        signature_scheme: "hmac-sha256",
        signature_status: "verified",
        signature_error: null,
        status: "accepted",
        headers_json: {},
        payload_json: { event: { id: "evt_seed_replay_2" } },
        raw_body: JSON.stringify({ event: { id: "evt_seed_replay_2" } }),
        replay_count: 3,
        last_replayed_at: staleReplayTimestamp,
        dead_letter_reason: null,
        created_at: staleReplayTimestamp,
        updated_at: staleReplayTimestamp,
        processed_at: staleReplayTimestamp,
      },
    ],
  });
  const rawBody = JSON.stringify({ event: { id: "evt_force_approval_1" } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createTimestampedSignature("whsec_test_1", timestamp, rawBody);

  const req = makeReq("POST", "/v1/workers/worker_1/trigger", rawBody, {
    "content-type": "application/json",
    "x-tenant-id": "tenant_1",
    "x-nooterra-timestamp": String(timestamp),
    "x-nooterra-signature": signature,
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(res.statusCode, 202);
  assert.equal(pool.state.executions.length, 1);
  assert.equal(pool.state.executions[0].metadata.forceApprovalReentry, true);
  assert.equal(pool.state.executions[0].metadata.webhookPolicyCode, "webhook_force_approval_reentry");
});

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

function withEnv(key, value) {
  const prev = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
  if (value === undefined || value === null) delete process.env[key];
  else process.env[key] = String(value);
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `product_event_agent_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_product_event_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertAgentCard(api, { agentId, capabilities, visibility = "public" }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": `product_event_card_${agentId}` },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities,
      visibility,
      host: { runtime: "nooterra" },
      priceHint: { amountCents: 500, currency: "USD", unit: "task" }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      amountCents,
      currency: "USD"
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createCompletedRun(api, { payerAgentId, payeeAgentId, runId, amountCents, idempotencyPrefix }) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: { "x-idempotency-key": `${idempotencyPrefix}_create` },
    body: {
      runId,
      taskType: "support_followup",
      settlement: {
        payerAgentId,
        amountCents,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const prev = created.json?.run?.lastChainHash;
  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-idempotency-key": `${idempotencyPrefix}_complete`,
      ...(prev ? { "x-proxy-expected-prev-chain-hash": prev } : {})
    },
    body: {
      type: "RUN_COMPLETED",
      payload: {
        outputRef: `artifact://runs/${runId}/output.json`
      }
    }
  });
  assert.equal(completed.statusCode, 201, completed.body);
}

test("API e2e: router launch emits approval-required buyer notification when approval is persisted", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    await registerAgent(api, {
      agentId: "agt_product_event_router_poster",
      capabilities: ["capability://workflow.orchestrator"]
    });
    await registerAgent(api, {
      agentId: "agt_product_event_router_worker",
      capabilities: ["capability://code.generation"]
    });
    await upsertAgentCard(api, {
      agentId: "agt_product_event_router_worker",
      capabilities: ["capability://code.generation"]
    });

    const blocked = await request(api, {
      method: "POST",
      path: "/router/launch",
      headers: { "x-idempotency-key": "router_launch_notify_approval_1" },
      body: {
        text: "Implement the feature.",
        posterAgentId: "agt_product_event_router_poster",
        scope: "public",
        budgetCents: 125_000,
        currency: "USD",
        approvalMode: "require",
        approvalPolicy: {
          requireApprovalAboveCents: 100_000,
          strictEvidenceRefs: true
        },
        taskOverrides: {
          t_implement: {
            rfqId: "rfq_product_event_router_1"
          }
        }
      }
    });

    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json?.code, "HUMAN_APPROVAL_REQUIRED");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://onboarding.nooterra.test/v1/tenants/tenant_default/settings/buyer-notifications/product-event/send"
    );
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["x-proxy-tenant-id"], "tenant_default");
    assert.equal(calls[0].headers["x-proxy-ops-token"], "tok_ops");
    assert.equal(calls[0].body?.payload?.eventType, "approval.required");
    assert.equal(calls[0].body?.payload?.itemRef?.requestId, blocked.json?.details?.approvalRequest?.requestId);
    assert.equal(
      calls[0].body?.payload?.deepLinkPath,
      `/approvals?requestId=${encodeURIComponent(blocked.json?.details?.approvalRequest?.requestId)}`
    );
    assert.equal(
      calls[0].body?.token,
      `notif_approval_${sha256Hex(
        `${blocked.json?.details?.approvalRequest?.requestId}\n${blocked.json?.details?.approvalRequest?.requestHash}`
      ).slice(0, 24)}`
    );
  } finally {
    restore();
  }
});

test("API e2e: work-order completion emits receipt-ready buyer notification with deterministic token", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    await registerAgent(api, { agentId: "agt_product_event_workorder_principal" });
    await registerAgent(api, {
      agentId: "agt_product_event_workorder_worker",
      capabilities: ["capability://code.review"]
    });

    const created = await request(api, {
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "work_order_notify_create_1" },
      body: {
        workOrderId: "workord_product_event_1",
        principalAgentId: "agt_product_event_workorder_principal",
        subAgentId: "agt_product_event_workorder_worker",
        requiredCapability: "capability://code.review",
        pricing: {
          model: "fixed",
          amountCents: 50_000,
          currency: "USD"
        }
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const completed = await request(api, {
      method: "POST",
      path: "/work-orders/workord_product_event_1/complete",
      headers: { "x-idempotency-key": "work_order_notify_complete_1" },
      body: {
        receiptId: "worec_product_event_1",
        outputs: { summary: "Completed the code review." },
        evidenceRefs: ["artifact://evidence/worec_product_event_1"]
      }
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://onboarding.nooterra.test/v1/tenants/tenant_default/settings/buyer-notifications/product-event/send"
    );
    assert.equal(calls[0].body?.payload?.eventType, "receipt.ready");
    assert.equal(calls[0].body?.payload?.itemRef?.receiptId, completed.json?.completionReceipt?.receiptId);
    assert.equal(
      calls[0].body?.payload?.deepLinkPath,
      `/receipts?selectedReceiptId=${encodeURIComponent(completed.json?.completionReceipt?.receiptId)}`
    );
    assert.equal(
      calls[0].body?.token,
      `notif_receipt_${sha256Hex(
        `${completed.json?.completionReceipt?.receiptId}\n${completed.json?.completionReceipt?.receiptHash}`
      ).slice(0, 24)}`
    );
  } finally {
    restore();
  }
});

test("API e2e: product-event emission failures do not block work-order completion", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async () => {
        throw new Error("notification upstream offline");
      }
    });

    await registerAgent(api, { agentId: "agt_product_event_fail_principal" });
    await registerAgent(api, {
      agentId: "agt_product_event_fail_worker",
      capabilities: ["capability://code.review"]
    });

    const created = await request(api, {
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": "work_order_notify_create_2" },
      body: {
        workOrderId: "workord_product_event_2",
        principalAgentId: "agt_product_event_fail_principal",
        subAgentId: "agt_product_event_fail_worker",
        requiredCapability: "capability://code.review",
        pricing: {
          model: "fixed",
          amountCents: 50_000,
          currency: "USD"
        }
      }
    });
    assert.equal(created.statusCode, 201, created.body);

    const completed = await request(api, {
      method: "POST",
      path: "/work-orders/workord_product_event_2/complete",
      headers: { "x-idempotency-key": "work_order_notify_complete_2" },
      body: {
        receiptId: "worec_product_event_2",
        outputs: { summary: "Completed the code review." },
        evidenceRefs: ["artifact://evidence/worec_product_event_2"]
      }
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(completed.json?.completionReceipt?.receiptId, "worec_product_event_2");
  } finally {
    restore();
  }
});

test("API e2e: run status transitions emit run.update notifications without heartbeat spam", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    const { agentId } = await registerAgent(api, { agentId: "agt_product_event_run_agent", capabilities: [] }).then(() => ({
      agentId: "agt_product_event_run_agent"
    }));

    const created = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs`,
      headers: { "x-idempotency-key": "run_notify_create_1" },
      body: {
        runId: "run_notify_1",
        taskType: "comparison"
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    let prev = created.json?.run?.lastChainHash;

    const started = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/run_notify_1/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": prev,
        "x-idempotency-key": "run_notify_started_1"
      },
      body: {
        type: "RUN_STARTED",
        payload: { startedBy: "scheduler" }
      }
    });
    assert.equal(started.statusCode, 201, started.body);
    prev = started.json?.run?.lastChainHash;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body?.payload?.eventType, "run.update");
    assert.equal(calls[0].body?.payload?.itemRef?.runId, "run_notify_1");
    assert.equal(calls[0].body?.payload?.deepLinkPath, "/runs/run_notify_1");
    assert.equal(calls[0].body?.token, `notif_run_${sha256Hex("run_notify_1\nrunning").slice(0, 24)}`);

    const heartbeat = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/run_notify_1/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": prev,
        "x-idempotency-key": "run_notify_heartbeat_1"
      },
      body: {
        type: "RUN_HEARTBEAT",
        payload: { stage: "collecting", progressPct: 50 }
      }
    });
    assert.equal(heartbeat.statusCode, 201, heartbeat.body);
    prev = heartbeat.json?.run?.lastChainHash;
    assert.equal(calls.length, 1);

    const completed = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/run_notify_1/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": prev,
        "x-idempotency-key": "run_notify_completed_1"
      },
      body: {
        type: "RUN_COMPLETED",
        payload: {
          outputRef: "artifact://runs/run_notify_1/output.json",
          metrics: { latencyMs: 320 }
        }
      }
    });
    assert.equal(completed.statusCode, 201, completed.body);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body?.payload?.eventType, "run.update");
    assert.equal(calls[1].body?.payload?.itemRef?.runId, "run_notify_1");
    assert.equal(calls[1].body?.token, `notif_run_${sha256Hex("run_notify_1\ncompleted").slice(0, 24)}`);
  } finally {
    restore();
  }
});

test("API e2e: run action-required events emit information-required notifications before terminal completion", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    const agentId = "agt_product_event_action_required_agent";
    await registerAgent(api, { agentId, capabilities: [] });

    const created = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs`,
      headers: { "x-idempotency-key": "run_action_required_notify_create_1" },
      body: {
        runId: "run_action_required_notify_1",
        taskType: "support_followup"
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    let prev = created.json?.run?.lastChainHash;

    const started = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_notify_1/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": prev,
        "x-idempotency-key": "run_action_required_notify_started_1"
      },
      body: {
        type: "RUN_STARTED",
        payload: { startedBy: "scheduler" }
      }
    });
    assert.equal(started.statusCode, 201, started.body);
    prev = started.json?.run?.lastChainHash;
    assert.equal(calls.length, 1);
    calls.length = 0;

    const paused = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_notify_1/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": prev,
        "x-idempotency-key": "run_action_required_notify_pause_1"
      },
      body: {
        type: "RUN_ACTION_REQUIRED",
        payload: {
          code: "needs_user_document",
          title: "Upload the invoice",
          detail: "Nooterra needs the original invoice before it can continue this refund follow-up.",
          requestedFields: ["invoice_number"],
          requestedEvidenceKinds: ["invoice_pdf"]
        }
      }
    });
    assert.equal(paused.statusCode, 201, paused.body);
    prev = paused.json?.run?.lastChainHash;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body?.payload?.eventType, "information.required");
    assert.equal(calls[0].body?.payload?.itemRef?.runId, "run_action_required_notify_1");
    assert.equal(calls[0].body?.payload?.deepLinkPath, "/runs/run_action_required_notify_1");
    assert.equal(
      calls[0].body?.token,
      `notif_information_${sha256Hex(`run_action_required_notify_1\nneeds_user_document\n${paused.json?.run?.actionRequired?.requestedAt}`).slice(0, 24)}`
    );
    calls.length = 0;

    const resumed = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/run_action_required_notify_1/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": prev,
        "x-idempotency-key": "run_action_required_notify_resume_1"
      },
      body: {
        type: "RUN_HEARTBEAT",
        payload: {
          stage: "resumed_after_user_input",
          progressPct: 70
        }
      }
    });
    assert.equal(resumed.statusCode, 201, resumed.body);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("API e2e: phase1 unresolved user-input runs emit information-required notifications", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    await registerAgent(api, {
      agentId: "agt_product_event_info_poster",
      capabilities: ["capability://workflow.orchestrator"]
    });
    await registerAgent(api, {
      agentId: "agt_product_event_info_worker",
      capabilities: ["capability://consumer.support.follow_up"]
    });
    await registerAgent(api, {
      agentId: "agt_product_event_info_operator",
      capabilities: ["capability://workflow.orchestrator"]
    });
    await upsertAgentCard(api, {
      agentId: "agt_product_event_info_worker",
      capabilities: ["capability://consumer.support.follow_up"]
    });
    await creditWallet(api, {
      agentId: "agt_product_event_info_poster",
      amountCents: 20_000,
      idempotencyKey: "wallet_credit_product_event_info_poster"
    });

    const launch = await request(api, {
      method: "POST",
      path: "/router/launch",
      headers: { "x-idempotency-key": "router_launch_notify_info_1" },
      body: {
        text: "Track down why my refund never arrived and keep following up until it's resolved.",
        posterAgentId: "agt_product_event_info_poster",
        productSurface: "consumer_shell",
        scope: "public",
        budgetCents: 5000,
        currency: "USD",
        taskOverrides: {
          t_support: { rfqId: "rfq_product_event_info_support" }
        }
      }
    });
    assert.equal(launch.statusCode, 201, launch.body);

    const bid = await request(api, {
      method: "POST",
      path: "/marketplace/rfqs/rfq_product_event_info_support/bids",
      headers: { "x-idempotency-key": "bid_product_event_info_support_1" },
      body: {
        bidId: "bid_product_event_info_support_1",
        bidderAgentId: "agt_product_event_info_worker",
        amountCents: 1400,
        currency: "USD",
        etaSeconds: 900
      }
    });
    assert.equal(bid.statusCode, 201, bid.body);

    const dispatch = await request(api, {
      method: "POST",
      path: "/router/dispatch",
      headers: { "x-idempotency-key": "router_dispatch_notify_info_1" },
      body: {
        launchId: launch.json?.launch?.launchId,
        acceptedByAgentId: "agt_product_event_info_operator"
      }
    });
    assert.equal(dispatch.statusCode, 200, dispatch.body);
    const accepted = dispatch.json?.results?.find((row) => row.taskId === "t_support");
    assert.equal(accepted?.state, "accepted");
    assert.ok(typeof accepted?.runId === "string" && accepted.runId.length > 0);
    assert.ok(typeof accepted?.run?.lastChainHash === "string" && accepted.run.lastChainHash.length > 0);

    calls.length = 0;

    const completed = await request(api, {
      method: "POST",
      path: `/agents/${encodeURIComponent("agt_product_event_info_worker")}/runs/${encodeURIComponent(accepted.runId)}/events`,
      headers: {
        "x-idempotency-key": "run_notify_information_required_1",
        "x-proxy-expected-prev-chain-hash": accepted.run.lastChainHash
      },
      body: {
        type: "RUN_COMPLETED",
        payload: {
          outputRef: `artifact://runs/${accepted.runId}/output.json`,
          metrics: {
            phase1CompletionState: "needs_user_document",
            phase1EvidenceKinds: ["ticket_reference", "message_log"]
          }
        }
      }
    });
    assert.equal(completed.statusCode, 201, completed.body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body?.payload?.eventType, "information.required");
    assert.equal(calls[0].body?.payload?.itemRef?.runId, accepted.runId);
    assert.equal(calls[0].body?.payload?.deepLinkPath, `/runs/${accepted.runId}`);
    assert.equal(
      calls[0].body?.token,
      `notif_information_${sha256Hex(`${accepted.runId}\nneeds_user_document`).slice(0, 24)}`
    );
  } finally {
    restore();
  }
});

test("API e2e: dispute lifecycle emits dispute.update notifications for open, escalation, and resolution", async () => {
  const restore = withEnv("PROXY_ONBOARDING_BASE_URL", "https://onboarding.nooterra.test");
  const calls = [];
  try {
    const api = createApi({
      store: createStore(),
      opsToken: "tok_ops",
      fetchFn: async (url, init = {}) => {
        calls.push({
          url: String(url),
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          body: init.body ? JSON.parse(init.body) : null
        });
        return new Response(JSON.stringify({ ok: true, delivery: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    });

    const payerAgentId = "agt_product_event_dispute_payer";
    const payeeAgentId = "agt_product_event_dispute_payee";
    await registerAgent(api, { agentId: payerAgentId });
    await registerAgent(api, { agentId: payeeAgentId });
    await creditWallet(api, {
      agentId: payerAgentId,
      amountCents: 25_000,
      idempotencyKey: "wallet_credit_product_event_dispute_1"
    });
    await createCompletedRun(api, {
      payerAgentId,
      payeeAgentId,
      runId: "run_notify_dispute_1",
      amountCents: 2_400,
      idempotencyPrefix: "run_notify_dispute_1"
    });
    calls.length = 0;

    const opened = await request(api, {
      method: "POST",
      path: "/runs/run_notify_dispute_1/dispute/open",
      headers: { "x-idempotency-key": "run_notify_dispute_open_1" },
      body: {
        disputeId: "dsp_notify_1",
        reason: "Need a refund review.",
        openedByAgentId: payerAgentId
      }
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body?.payload?.eventType, "dispute.update");
    assert.equal(calls[0].body?.payload?.itemRef?.disputeId, "dsp_notify_1");
    assert.equal(calls[0].body?.payload?.itemRef?.runId, "run_notify_dispute_1");
    assert.equal(calls[0].body?.payload?.deepLinkPath, "/disputes?selectedDisputeId=dsp_notify_1");
    assert.equal(
      calls[0].body?.token,
      `notif_dispute_${sha256Hex(`dsp_notify_1\nopen\n${opened.json?.settlement?.disputeOpenedAt ?? ""}\n`).slice(0, 24)}`
    );

    const escalated = await request(api, {
      method: "POST",
      path: "/runs/run_notify_dispute_1/dispute/escalate",
      headers: { "x-idempotency-key": "run_notify_dispute_escalate_1" },
      body: {
        disputeId: "dsp_notify_1",
        escalationLevel: "l2_arbiter",
        escalatedByAgentId: payerAgentId,
        reason: "Counterparty did not resolve it."
      }
    });
    assert.equal(escalated.statusCode, 200, escalated.body);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body?.payload?.eventType, "dispute.update");
    assert.equal(calls[1].body?.payload?.itemRef?.disputeId, "dsp_notify_1");
    assert.equal(calls[1].body?.payload?.deepLinkPath, "/disputes?selectedDisputeId=dsp_notify_1");
    assert.equal(
      calls[1].body?.token,
      `notif_dispute_${sha256Hex("dsp_notify_1\nescalate\nl2_arbiter\n").slice(0, 24)}`
    );

    const closed = await request(api, {
      method: "POST",
      path: "/runs/run_notify_dispute_1/dispute/close",
      headers: { "x-idempotency-key": "run_notify_dispute_close_1" },
      body: {
        disputeId: "dsp_notify_1",
        closedByAgentId: payeeAgentId,
        resolutionOutcome: "accepted",
        resolutionSummary: "Counterparty accepted the refund request.",
        resolutionReleaseRatePct: 100
      }
    });
    assert.equal(closed.statusCode, 200, closed.body);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body?.payload?.eventType, "dispute.update");
    assert.equal(calls[2].body?.payload?.itemRef?.disputeId, "dsp_notify_1");
    assert.equal(calls[2].body?.payload?.deepLinkPath, "/disputes?selectedDisputeId=dsp_notify_1");
    assert.equal(
      calls[2].body?.token,
      `notif_dispute_${sha256Hex("dsp_notify_1\nclose\naccepted\n").slice(0, 24)}`
    );
  } finally {
    restore();
  }
});

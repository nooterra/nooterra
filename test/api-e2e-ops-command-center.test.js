import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, agentId) {
  const keypair = createEd25519Keypair();
  const res = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_command_center" },
      publicKeyPem: keypair.publicKeyPem,
      capabilities: ["translate"]
    }
  });
  assert.equal(res.statusCode, 201);
}

test("API e2e: /ops/network/command-center summarizes reliability, settlement, dispute, and revenue signals", async () => {
  const api = createApi({
    opsTokens: ["tok_opsr:ops_read", "tok_opsw:ops_write"].join(";"),
    exportDestinations: {
      tenant_default: [
        {
          destinationId: "dest_cc_alerts",
          url: "https://example.invalid/command-center-alerts",
          secret: "sek_cc_alerts",
          artifactTypes: ["CommandCenterAlert.v1"]
        }
      ]
    }
  });

  await registerAgent(api, "agt_cc_poster");
  await registerAgent(api, "agt_cc_bidder");
  await registerAgent(api, "agt_cc_operator");

  const credit = await request(api, {
    method: "POST",
    path: "/agents/agt_cc_poster/wallet/credit",
    headers: { "x-idempotency-key": "cc_credit_1" },
    body: { amountCents: 5000, currency: "USD" }
  });
  assert.equal(credit.statusCode, 201);

  const rfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "cc_rfq_1" },
    body: {
      rfqId: "rfq_cc_1",
      title: "Command center test task",
      capability: "translate",
      posterAgentId: "agt_cc_poster",
      budgetCents: 2500,
      currency: "USD"
    }
  });
  assert.equal(rfq.statusCode, 201);

  const bid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_cc_1/bids",
    headers: { "x-idempotency-key": "cc_bid_1" },
    body: {
      bidId: "bid_cc_1",
      bidderAgentId: "agt_cc_bidder",
      amountCents: 2000,
      currency: "USD",
      etaSeconds: 1200
    }
  });
  assert.equal(bid.statusCode, 201);

  const accept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_cc_1/accept",
    headers: { "x-idempotency-key": "cc_accept_1" },
    body: {
      bidId: "bid_cc_1",
      acceptedByAgentId: "agt_cc_operator"
    }
  });
  assert.equal(accept.statusCode, 200);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId.length > 0);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent("agt_cc_bidder")}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": "cc_run_complete_1"
    },
    body: {
      eventId: "ev_cc_run_complete_1",
      type: "RUN_COMPLETED",
      at: "2026-02-07T00:00:00.000Z",
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201);

  const completionSettlementStatus = String(complete.json?.settlement?.status ?? "");
  if (completionSettlementStatus === "locked") {
    const resolve = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
      headers: { "x-idempotency-key": "cc_resolve_1" },
      body: {
        status: "released",
        releaseRatePct: 100,
        resolvedByAgentId: "agt_cc_operator",
        reason: "manual approval"
      }
    });
    assert.equal(resolve.statusCode, 200);
    assert.equal(resolve.json?.settlement?.status, "released");
  } else {
    assert.equal(completionSettlementStatus, "released");
  }

  const openDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-idempotency-key": "cc_dispute_open_1" },
    body: {
      disputeId: "dsp_cc_1",
      disputeType: "quality",
      disputePriority: "normal",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: "agt_cc_operator",
      reason: "needs review"
    }
  });
  assert.equal(openDispute.statusCode, 200);
  assert.equal(openDispute.json?.settlement?.disputeStatus, "open");

  const commandCenter = await request(api, {
    method: "GET",
    path: "/ops/network/command-center?windowHours=24&disputeSlaHours=1&transactionFeeBps=100",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(commandCenter.statusCode, 200);
  assert.equal(commandCenter.json?.ok, true);
  assert.equal(commandCenter.json?.tenantId, "tenant_default");
  assert.ok(typeof commandCenter.json?.commandCenter?.generatedAt === "string");
  assert.ok(commandCenter.json?.commandCenter?.reliability?.backlog);
  assert.ok(commandCenter.json?.commandCenter?.settlement?.resolvedCount >= 1);
  assert.ok(commandCenter.json?.commandCenter?.settlement?.releasedAmountCents >= 2000);
  assert.equal(typeof commandCenter.json?.commandCenter?.settlement?.kernelVerificationErrorCount, "number");
  assert.ok(Array.isArray(commandCenter.json?.commandCenter?.settlement?.kernelVerificationErrorCountsByCode));
  assert.ok(commandCenter.json?.commandCenter?.disputes?.openCount >= 1);
  assert.ok(commandCenter.json?.commandCenter?.revenue?.estimatedTransactionFeesCentsInWindow >= 20);
  assert.ok(commandCenter.json?.commandCenter?.trust?.totalAgents >= 3);

  const alerts = await request(api, {
    method: "GET",
    path: "/ops/network/command-center?windowHours=24&disputeSlaHours=1&transactionFeeBps=100&emitAlerts=true&persistAlerts=true&httpServerErrorRateThresholdPct=0&deliveryDlqThreshold=0&disputeOverSlaThreshold=0&determinismRejectThreshold=0",
    headers: { "x-proxy-ops-token": "tok_opsw" }
  });
  assert.equal(alerts.statusCode, 200);
  assert.equal(alerts.json?.ok, true);
  assert.equal(typeof alerts.json?.alerts?.evaluatedCount, "number");
  assert.ok(alerts.json?.alerts?.evaluatedCount >= 1);
  assert.ok(alerts.json?.alerts?.breachCount >= 1);
  assert.ok(alerts.json?.alerts?.emittedCount >= 1);
  assert.equal(alerts.json?.alerts?.emittedCount, (alerts.json?.alerts?.emitted ?? []).length);

  const emittedArtifacts = (await api.store.listArtifacts({ tenantId: "tenant_default" })).filter(
    (a) => a?.artifactType === "CommandCenterAlert.v1"
  );
  assert.ok(emittedArtifacts.length >= alerts.json?.alerts?.emittedCount);

  const deliveries = (await api.store.listDeliveries({ tenantId: "tenant_default" })).filter(
    (d) => d?.artifactType === "CommandCenterAlert.v1"
  );
  assert.ok(deliveries.length >= alerts.json?.alerts?.emittedCount);
});

test("API e2e: command-center emits case-level over-SLA arbitration alerts with case identifiers", async () => {
  let nowAt = "2026-02-07T00:00:00.000Z";
  const api = createApi({
    now: () => nowAt,
    opsTokens: ["tok_opsr:ops_read", "tok_opsw:ops_write"].join(";"),
    exportDestinations: {
      tenant_default: [
        {
          destinationId: "dest_cc_case_alerts",
          url: "https://example.invalid/command-center-case-alerts",
          secret: "sek_cc_case_alerts",
          artifactTypes: ["CommandCenterAlert.v1"]
        }
      ]
    }
  });

  await registerAgent(api, "agt_cc_case_poster");
  await registerAgent(api, "agt_cc_case_bidder");
  await registerAgent(api, "agt_cc_case_operator");
  await registerAgent(api, "agt_cc_case_arbiter");

  const credit = await request(api, {
    method: "POST",
    path: "/agents/agt_cc_case_poster/wallet/credit",
    headers: { "x-idempotency-key": "cc_case_credit_1" },
    body: { amountCents: 5000, currency: "USD" }
  });
  assert.equal(credit.statusCode, 201);

  const rfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "cc_case_rfq_1" },
    body: {
      rfqId: "rfq_cc_case_1",
      title: "Command center arbitration case alert test task",
      capability: "translate",
      posterAgentId: "agt_cc_case_poster",
      budgetCents: 2500,
      currency: "USD"
    }
  });
  assert.equal(rfq.statusCode, 201);

  const bid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_cc_case_1/bids",
    headers: { "x-idempotency-key": "cc_case_bid_1" },
    body: {
      bidId: "bid_cc_case_1",
      bidderAgentId: "agt_cc_case_bidder",
      amountCents: 2000,
      currency: "USD",
      etaSeconds: 1200
    }
  });
  assert.equal(bid.statusCode, 201);

  const accept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_cc_case_1/accept",
    headers: { "x-idempotency-key": "cc_case_accept_1" },
    body: {
      bidId: "bid_cc_case_1",
      acceptedByAgentId: "agt_cc_case_operator"
    }
  });
  assert.equal(accept.statusCode, 200);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId.length > 0);

  const complete = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent("agt_cc_case_bidder")}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-expected-prev-chain-hash": accept.json?.run?.lastChainHash,
      "x-idempotency-key": "cc_case_run_complete_1"
    },
    body: {
      eventId: "ev_cc_case_run_complete_1",
      type: "RUN_COMPLETED",
      at: nowAt,
      payload: {
        outputRef: `evidence://${runId}/output.json`,
        metrics: { settlementReleaseRatePct: 100 }
      }
    }
  });
  assert.equal(complete.statusCode, 201);

  const completionSettlementStatus = String(complete.json?.settlement?.status ?? "");
  if (completionSettlementStatus === "locked") {
    const resolve = await request(api, {
      method: "POST",
      path: `/runs/${encodeURIComponent(runId)}/settlement/resolve`,
      headers: { "x-idempotency-key": "cc_case_resolve_1" },
      body: {
        status: "released",
        releaseRatePct: 100,
        resolvedByAgentId: "agt_cc_case_operator",
        reason: "manual approval"
      }
    });
    assert.equal(resolve.statusCode, 200);
    assert.equal(resolve.json?.settlement?.status, "released");
  } else {
    assert.equal(completionSettlementStatus, "released");
  }

  const openDispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: { "x-idempotency-key": "cc_case_dispute_open_1" },
    body: {
      disputeId: "dsp_cc_case_1",
      disputeType: "quality",
      disputePriority: "high",
      disputeChannel: "counterparty",
      escalationLevel: "l1_counterparty",
      openedByAgentId: "agt_cc_case_operator",
      reason: "needs arbitration"
    }
  });
  assert.equal(openDispute.statusCode, 200);
  assert.equal(openDispute.json?.settlement?.disputeStatus, "open");

  const openArbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: { "x-idempotency-key": "cc_case_arbitration_open_1" },
    body: {
      disputeId: "dsp_cc_case_1",
      caseId: "arb_case_cc_1",
      arbiterAgentId: "agt_cc_case_arbiter"
    }
  });
  assert.equal(openArbitration.statusCode, 201);
  assert.equal(openArbitration.json?.arbitrationCase?.caseId, "arb_case_cc_1");

  nowAt = "2026-02-07T03:30:00.000Z";
  const alerts = await request(api, {
    method: "GET",
    path: "/ops/network/command-center?windowHours=24&disputeSlaHours=1&emitAlerts=true&persistAlerts=true&httpClientErrorRateThresholdPct=999&httpServerErrorRateThresholdPct=999&deliveryDlqThreshold=999&disputeOverSlaThreshold=1&determinismRejectThreshold=999",
    headers: { "x-proxy-ops-token": "tok_opsw" }
  });
  assert.equal(alerts.statusCode, 200);
  assert.equal(alerts.json?.ok, true);
  assert.ok((alerts.json?.commandCenter?.disputes?.overSlaCases ?? []).length >= 1);

  const emittedArtifacts = (await api.store.listArtifacts({ tenantId: "tenant_default" }))
    .filter((a) => a?.artifactType === "CommandCenterAlert.v1");
  const caseAlert = emittedArtifacts.find((artifact) => {
    const alert = artifact?.alert;
    return alert?.alertType === "dispute_case_over_sla" && alert?.dimensions?.caseId === "arb_case_cc_1";
  });
  assert.ok(caseAlert);
  assert.equal(caseAlert?.alert?.dimensions?.runId, runId);
  assert.equal(caseAlert?.alert?.dimensions?.disputeId, "dsp_cc_case_1");
  assert.equal(caseAlert?.alert?.dimensions?.priority, "high");
});

test("API e2e: command-center surfaces settlement kernel verification errors by code and emits code-scoped alerts", async () => {
  const api = createApi({
    opsTokens: ["tok_opsr:ops_read", "tok_opsw:ops_write"].join(";"),
    exportDestinations: {
      tenant_default: [
        {
          destinationId: "dest_cc_kernel_alerts",
          url: "https://example.invalid/command-center-kernel-alerts",
          secret: "sek_cc_kernel_alerts",
          artifactTypes: ["CommandCenterAlert.v1"]
        }
      ]
    }
  });

  await registerAgent(api, "agt_cc_kernel_poster");
  await registerAgent(api, "agt_cc_kernel_bidder");
  await registerAgent(api, "agt_cc_kernel_operator");

  const credit = await request(api, {
    method: "POST",
    path: "/agents/agt_cc_kernel_poster/wallet/credit",
    headers: { "x-idempotency-key": "cc_kernel_credit_1" },
    body: { amountCents: 5000, currency: "USD" }
  });
  assert.equal(credit.statusCode, 201);

  const rfq = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs",
    headers: { "x-idempotency-key": "cc_kernel_rfq_1" },
    body: {
      rfqId: "rfq_cc_kernel_1",
      title: "Command center kernel code counter test RFQ",
      capability: "translate",
      posterAgentId: "agt_cc_kernel_poster",
      budgetCents: 2500,
      currency: "USD"
    }
  });
  assert.equal(rfq.statusCode, 201);

  const bid = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_cc_kernel_1/bids",
    headers: { "x-idempotency-key": "cc_kernel_bid_1" },
    body: {
      bidId: "bid_cc_kernel_1",
      bidderAgentId: "agt_cc_kernel_bidder",
      amountCents: 2000,
      currency: "USD",
      etaSeconds: 1200
    }
  });
  assert.equal(bid.statusCode, 201);

  const accept = await request(api, {
    method: "POST",
    path: "/marketplace/rfqs/rfq_cc_kernel_1/accept",
    headers: { "x-idempotency-key": "cc_kernel_accept_1" },
    body: {
      bidId: "bid_cc_kernel_1",
      acceptedByAgentId: "agt_cc_kernel_operator"
    }
  });
  assert.equal(accept.statusCode, 200);
  const runId = String(accept.json?.run?.runId ?? "");
  assert.ok(runId.length > 0);

  const settlementStoreKey = `tenant_default\n${runId}`;
  const storedSettlement = api.store.agentRunSettlements.get(settlementStoreKey);
  assert.ok(storedSettlement);
  assert.ok(storedSettlement?.decisionTrace?.settlementReceipt);

  api.store.agentRunSettlements.set(settlementStoreKey, {
    ...storedSettlement,
    decisionTrace: {
      ...storedSettlement.decisionTrace,
      settlementReceipt: {
        ...storedSettlement.decisionTrace.settlementReceipt,
        decisionRef: {
          ...storedSettlement.decisionTrace.settlementReceipt.decisionRef,
          decisionHash: "f".repeat(64)
        }
      }
    }
  });

  const alerts = await request(api, {
    method: "GET",
    path:
      "/ops/network/command-center?windowHours=24&disputeSlaHours=24&emitAlerts=true&persistAlerts=true&httpClientErrorRateThresholdPct=999&httpServerErrorRateThresholdPct=999&deliveryDlqThreshold=999&disputeOverSlaThreshold=999&determinismRejectThreshold=999&kernelVerificationErrorThreshold=1",
    headers: { "x-proxy-ops-token": "tok_opsw" }
  });
  assert.equal(alerts.statusCode, 200);
  assert.equal(alerts.json?.ok, true);
  assert.ok(Number(alerts.json?.commandCenter?.settlement?.kernelVerificationErrorCount ?? 0) >= 1);
  const codeCounts = Array.isArray(alerts.json?.commandCenter?.settlement?.kernelVerificationErrorCountsByCode)
    ? alerts.json.commandCenter.settlement.kernelVerificationErrorCountsByCode
    : [];
  const receiptHashMismatch = codeCounts.find((row) => row?.code === "settlement_receipt_hash_mismatch");
  assert.ok(receiptHashMismatch);
  assert.ok(Number(receiptHashMismatch?.count ?? 0) >= 1);

  const emitted = Array.isArray(alerts.json?.alerts?.emitted) ? alerts.json.alerts.emitted : [];
  assert.ok(
    emitted.some((row) => row?.alertType === "settlement_kernel_verification_error_code"),
    "expected settlement kernel code alert to be emitted"
  );

  const emittedArtifacts = (await api.store.listArtifacts({ tenantId: "tenant_default" })).filter(
    (artifact) =>
      artifact?.artifactType === "CommandCenterAlert.v1" &&
      artifact?.alert?.alertType === "settlement_kernel_verification_error_code"
  );
  assert.ok(emittedArtifacts.length >= 1);
  assert.ok(emittedArtifacts.some((artifact) => artifact?.alert?.dimensions?.code === "settlement_receipt_hash_mismatch"));
});

test("API e2e: /ops/network/command-center/workspace returns reliability+safety workspace JSON", async () => {
  const nowAt = "2026-02-07T12:00:00.000Z";
  const api = createApi({
    now: () => nowAt,
    opsTokens: ["tok_opsr:ops_read", "tok_opsw:ops_write"].join(";")
  });

  await registerAgent(api, "agt_cc_ws_operator");

  const workspace = await request(api, {
    method: "GET",
    path:
      "/ops/network/command-center/workspace?windowHours=24&disputeSlaHours=24&transactionFeeBps=100&deliveryDlqThreshold=0",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.equal(workspace.json?.ok, true);
  assert.equal(workspace.json?.tenantId, "tenant_default");
  assert.equal(workspace.json?.workspace?.schemaVersion, "OpsNetworkCommandCenterWorkspace.v1");
  assert.equal(workspace.json?.workspace?.generatedAt, nowAt);
  assert.equal(workspace.json?.workspace?.parameters?.windowHours, 24);
  assert.equal(workspace.json?.workspace?.parameters?.disputeSlaHours, 24);
  assert.equal(workspace.json?.workspace?.parameters?.transactionFeeBps, 100);
  assert.ok(workspace.json?.workspace?.reliability?.backlog);
  assert.ok(workspace.json?.workspace?.safety?.determinism);
  assert.ok(Array.isArray(workspace.json?.workspace?.safety?.alerts?.breaches));
  assert.equal(workspace.json?.workspace?.safety?.alerts?.thresholds?.deliveryDlqThreshold, 0);
  assert.equal(workspace.json?.workspace?.links?.summary, "/ops/network/command-center");
  assert.equal(workspace.json?.workspace?.links?.status, "/ops/status");
});

test("API e2e: command-center workspace fails closed when a dependency is unavailable", async () => {
  const api = createApi({
    opsTokens: "tok_opsr:ops_read"
  });

  api.store.listArbitrationCases = async () => {
    throw new TypeError("arbitration cases not supported for this store");
  };

  const workspace = await request(api, {
    method: "GET",
    path: "/ops/network/command-center/workspace",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(workspace.statusCode, 501, workspace.body);
  assert.equal(workspace.json?.code, "COMMAND_CENTER_DEPENDENCY_UNAVAILABLE");
  assert.match(String(workspace.json?.error ?? ""), /dependencies unavailable/i);

  const summary = await request(api, {
    method: "GET",
    path: "/ops/network/command-center",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(summary.statusCode, 200, summary.body);
  assert.equal(summary.json?.ok, true);
});

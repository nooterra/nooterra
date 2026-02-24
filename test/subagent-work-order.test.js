import test from "node:test";
import assert from "node:assert/strict";

import {
  SUB_AGENT_COMPLETION_STATUS,
  SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS,
  SUB_AGENT_WORK_ORDER_STATUS,
  acceptSubAgentWorkOrderV1,
  appendSubAgentWorkOrderProgressV1,
  buildSubAgentCompletionReceiptV1,
  buildSubAgentWorkOrderV1,
  completeSubAgentWorkOrderV1,
  settleSubAgentWorkOrderV1,
  validateSubAgentCompletionReceiptV1,
  validateSubAgentWorkOrderV1
} from "../src/core/subagent-work-order.js";

test("sub-agent work order: deterministic completion receipt hash", () => {
  const workOrder = buildSubAgentWorkOrderV1({
    workOrderId: "workord_det_1",
    tenantId: "tenant_default",
    principalAgentId: "agt_principal_1",
    subAgentId: "agt_worker_1",
    requiredCapability: "code.generation",
    specification: { prompt: "deterministic" },
    pricing: { model: "fixed", amountCents: 123, currency: "USD" },
    createdAt: "2026-02-23T00:00:00.000Z"
  });

  const receiptA = buildSubAgentCompletionReceiptV1({
    receiptId: "worec_det_1",
    tenantId: "tenant_default",
    workOrder,
    status: SUB_AGENT_COMPLETION_STATUS.SUCCESS,
    outputs: { artifactRef: "artifact://out/1" },
    metrics: { tokensIn: 100, tokensOut: 200 },
    evidenceRefs: ["artifact://out/1"],
    deliveredAt: "2026-02-23T00:01:00.000Z"
  });

  const receiptB = buildSubAgentCompletionReceiptV1({
    receiptId: "worec_det_1",
    tenantId: "tenant_default",
    workOrder,
    status: SUB_AGENT_COMPLETION_STATUS.SUCCESS,
    outputs: { artifactRef: "artifact://out/1" },
    metrics: { tokensIn: 100, tokensOut: 200 },
    evidenceRefs: ["artifact://out/1"],
    deliveredAt: "2026-02-23T00:01:00.000Z"
  });

  assert.equal(receiptA.receiptHash, receiptB.receiptHash);
  assert.equal(receiptA.receiptHash.length, 64);
  assert.equal(validateSubAgentCompletionReceiptV1(receiptA), true);
});

test("sub-agent work order: lifecycle transitions", () => {
  const created = buildSubAgentWorkOrderV1({
    workOrderId: "workord_flow_1",
    tenantId: "tenant_default",
    principalAgentId: "agt_principal_1",
    subAgentId: "agt_worker_1",
    requiredCapability: "code.generation",
    specification: { prompt: "Implement parser" },
    pricing: { model: "fixed", amountCents: 500, currency: "USD" },
    createdAt: "2026-02-23T00:00:00.000Z"
  });
  assert.equal(created.status, SUB_AGENT_WORK_ORDER_STATUS.CREATED);

  const accepted = acceptSubAgentWorkOrderV1({
    workOrder: created,
    acceptedByAgentId: "agt_worker_1",
    acceptedAt: "2026-02-23T00:02:00.000Z"
  });
  assert.equal(accepted.status, SUB_AGENT_WORK_ORDER_STATUS.ACCEPTED);

  const working = appendSubAgentWorkOrderProgressV1({
    workOrder: accepted,
    progressId: "prog_1",
    eventType: "progress",
    message: "done 50%",
    percentComplete: 50,
    evidenceRefs: ["artifact://progress/1"],
    at: "2026-02-23T00:03:00.000Z"
  });
  assert.equal(working.status, SUB_AGENT_WORK_ORDER_STATUS.WORKING);
  assert.equal(working.progressEvents.length, 1);

  const receipt = buildSubAgentCompletionReceiptV1({
    receiptId: "worec_flow_1",
    tenantId: "tenant_default",
    workOrder: working,
    status: SUB_AGENT_COMPLETION_STATUS.SUCCESS,
    evidenceRefs: ["artifact://result/1"],
    deliveredAt: "2026-02-23T00:04:00.000Z"
  });

  const completed = completeSubAgentWorkOrderV1({
    workOrder: working,
    completionReceipt: receipt,
    completedAt: "2026-02-23T00:05:00.000Z"
  });
  assert.equal(completed.status, SUB_AGENT_WORK_ORDER_STATUS.COMPLETED);
  assert.equal(completed.completionReceiptId, "worec_flow_1");

  const settled = settleSubAgentWorkOrderV1({
    workOrder: completed,
    completionReceiptId: "worec_flow_1",
    settlement: {
      status: SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS.RELEASED,
      x402GateId: "x402gate_flow_1",
      x402RunId: "run_flow_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_flow_1"
    },
    settledAt: "2026-02-23T00:06:00.000Z"
  });
  assert.equal(settled.status, SUB_AGENT_WORK_ORDER_STATUS.SETTLED);
  assert.equal(settled.settlement?.status, SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS.RELEASED);
  assert.equal(validateSubAgentWorkOrderV1(settled), true);
});

test("sub-agent work order: fail-closed on invalid transitions", () => {
  const created = buildSubAgentWorkOrderV1({
    workOrderId: "workord_fail_1",
    tenantId: "tenant_default",
    principalAgentId: "agt_principal_1",
    subAgentId: "agt_worker_1",
    requiredCapability: "code.generation",
    specification: { prompt: "invalid transitions" },
    pricing: { model: "fixed", amountCents: 500, currency: "USD" },
    createdAt: "2026-02-23T00:00:00.000Z"
  });

  assert.throws(() =>
    settleSubAgentWorkOrderV1({
      workOrder: created,
      completionReceiptId: "worec_missing",
      settlement: {
        status: SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS.RELEASED,
        x402GateId: "x402gate_fail_1",
        x402RunId: "run_fail_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_fail_1"
      },
      settledAt: "2026-02-23T00:01:00.000Z"
    })
  );

  assert.throws(() =>
    appendSubAgentWorkOrderProgressV1({
      workOrder: created,
      progressId: "prog_bad",
      percentComplete: 101,
      at: "2026-02-23T00:01:00.000Z"
    })
  );
});

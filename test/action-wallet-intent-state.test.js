import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_WALLET_INTENT_STATE,
  InvalidActionWalletIntentTransitionError,
  assertActionWalletIntentTransitionSequence,
  deriveActionWalletIntentState,
  hasActionWalletIntentEvidenceSubmission,
  transitionActionWalletIntentState
} from "../src/core/action-wallet-intent-state.js";
import {
  SUB_AGENT_COMPLETION_STATUS,
  SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS,
  SUB_AGENT_WORK_ORDER_STATUS
} from "../src/core/subagent-work-order.js";

test("action-wallet intent state machine: happy path reaches completed", () => {
  const finalState = assertActionWalletIntentTransitionSequence({
    state: null,
    path: [
      ACTION_WALLET_INTENT_STATE.DRAFT,
      ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED,
      ACTION_WALLET_INTENT_STATE.APPROVED,
      ACTION_WALLET_INTENT_STATE.EXECUTING,
      ACTION_WALLET_INTENT_STATE.EVIDENCE_SUBMITTED,
      ACTION_WALLET_INTENT_STATE.VERIFYING,
      ACTION_WALLET_INTENT_STATE.COMPLETED
    ]
  });
  assert.equal(finalState, ACTION_WALLET_INTENT_STATE.COMPLETED);
});

test("action-wallet intent state machine: invalid transition fails closed", () => {
  assert.throws(
    () =>
      transitionActionWalletIntentState({
        state: ACTION_WALLET_INTENT_STATE.DRAFT,
        nextState: ACTION_WALLET_INTENT_STATE.EXECUTING,
        actionIntentId: "aint_invalid_1"
      }),
    (error) =>
      error instanceof InvalidActionWalletIntentTransitionError &&
      error.code === "TRANSITION_ILLEGAL" &&
      /draft -> executing/.test(error.message)
  );
});

test("action-wallet intent state machine: evidence submission is derived from progress events", () => {
  assert.equal(
    hasActionWalletIntentEvidenceSubmission({
      workOrder: {
        progressEvents: [
          {
            progressId: "wprog_1",
            eventType: "evidence_submitted",
            evidenceRefs: ["artifact://receipt/1"],
            at: "2026-03-09T00:00:00.000Z"
          }
        ]
      }
    }),
    true
  );
});

test("action-wallet intent state machine: derived state follows approval and work-order substrate", () => {
  assert.equal(deriveActionWalletIntentState({}), ACTION_WALLET_INTENT_STATE.DRAFT);
  assert.equal(
    deriveActionWalletIntentState({ approvalRequest: { requestId: "apr_1" } }),
    ACTION_WALLET_INTENT_STATE.APPROVAL_REQUIRED
  );
  assert.equal(
    deriveActionWalletIntentState({ approvalRequest: { requestId: "apr_1" }, approvalDecision: { approved: true } }),
    ACTION_WALLET_INTENT_STATE.APPROVED
  );
  assert.equal(
    deriveActionWalletIntentState({
      approvalRequest: { requestId: "apr_1" },
      approvalDecision: { approved: true },
      workOrder: { status: SUB_AGENT_WORK_ORDER_STATUS.WORKING, progressEvents: [] }
    }),
    ACTION_WALLET_INTENT_STATE.EXECUTING
  );
  assert.equal(
    deriveActionWalletIntentState({
      approvalRequest: { requestId: "apr_1" },
      approvalDecision: { approved: true },
      workOrder: {
        status: SUB_AGENT_WORK_ORDER_STATUS.WORKING,
        progressEvents: [{ progressId: "wprog_1", eventType: "evidence_submitted", evidenceRefs: ["artifact://1"], at: "2026-03-09T00:00:00.000Z" }]
      }
    }),
    ACTION_WALLET_INTENT_STATE.EVIDENCE_SUBMITTED
  );
  assert.equal(
    deriveActionWalletIntentState({
      workOrder: { status: SUB_AGENT_WORK_ORDER_STATUS.COMPLETED },
      completionReceipt: { status: SUB_AGENT_COMPLETION_STATUS.SUCCESS }
    }),
    ACTION_WALLET_INTENT_STATE.COMPLETED
  );
  assert.equal(
    deriveActionWalletIntentState({
      workOrder: { status: SUB_AGENT_WORK_ORDER_STATUS.FAILED },
      completionReceipt: { status: SUB_AGENT_COMPLETION_STATUS.FAILED }
    }),
    ACTION_WALLET_INTENT_STATE.FAILED
  );
  assert.equal(
    deriveActionWalletIntentState({
      workOrder: {
        status: SUB_AGENT_WORK_ORDER_STATUS.SETTLED,
        settlement: { status: SUB_AGENT_WORK_ORDER_SETTLEMENT_STATUS.REFUNDED }
      }
    }),
    ACTION_WALLET_INTENT_STATE.REFUNDED
  );
  assert.equal(
    deriveActionWalletIntentState({
      workOrder: { status: SUB_AGENT_WORK_ORDER_STATUS.DISPUTED },
      disputeStatus: "opened"
    }),
    ACTION_WALLET_INTENT_STATE.DISPUTED
  );
  assert.equal(
    deriveActionWalletIntentState({ approvalRequest: { requestId: "apr_1" }, approvalDecision: { approved: false } }),
    ACTION_WALLET_INTENT_STATE.CANCELLED
  );
});

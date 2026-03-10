import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_WALLET_APPROVAL_STATE,
  InvalidActionWalletApprovalTransitionError,
  assertActionWalletApprovalTransitionSequence,
  deriveActionWalletApprovalState,
  getActionWalletApprovalRevocation,
  transitionActionWalletApprovalState
} from "../src/core/action-wallet-approval-state.js";

function buildApprovalRequest({
  requestId = "apr_state_1",
  decisionTimeoutAt = null
} = {}) {
  return {
    schemaVersion: "ApprovalRequest.v1",
    requestId,
    envelopeRef: {
      envelopeId: "aenv_state_1",
      envelopeHash: "a".repeat(64)
    },
    requestedBy: "agt_host_state_1",
    requestedAt: "2026-03-09T00:00:00.000Z",
    actionRef: {
      actionId: "act_state_1",
      sha256: "b".repeat(64)
    },
    approvalPolicy:
      decisionTimeoutAt === null
        ? null
        : {
            requireApprovalAboveCents: 0,
            strictEvidenceRefs: true,
            decisionTimeoutAt
          },
    requestHash: "c".repeat(64)
  };
}

function buildApprovalDecision({
  approved = true,
  revokedAt = null
} = {}) {
  return {
    schemaVersion: "ApprovalDecision.v1",
    decisionId: "adec_state_1",
    requestId: "apr_state_1",
    envelopeHash: "a".repeat(64),
    actionId: "act_state_1",
    actionSha256: "b".repeat(64),
    decidedBy: "human.ops",
    decidedAt: "2026-03-09T00:01:00.000Z",
    approved,
    expiresAt: null,
    evidenceRefs: [],
    binding: null,
    metadata:
      revokedAt === null
        ? null
        : {
            approvalLifecycle: {
              revokedAt,
              revocationReasonCode: "USER_REVOKED"
            }
          },
    decisionHash: "d".repeat(64)
  };
}

test("action-wallet approval state machine: happy path reaches approved then revoked", () => {
  const finalState = assertActionWalletApprovalTransitionSequence({
    state: null,
    path: [
      ACTION_WALLET_APPROVAL_STATE.PENDING,
      ACTION_WALLET_APPROVAL_STATE.APPROVED,
      ACTION_WALLET_APPROVAL_STATE.REVOKED
    ]
  });
  assert.equal(finalState, ACTION_WALLET_APPROVAL_STATE.REVOKED);
});

test("action-wallet approval state machine: invalid transition fails closed", () => {
  assert.throws(
    () =>
      transitionActionWalletApprovalState({
        state: ACTION_WALLET_APPROVAL_STATE.PENDING,
        nextState: ACTION_WALLET_APPROVAL_STATE.REVOKED,
        requestId: "apr_invalid_1"
      }),
    (error) =>
      error instanceof InvalidActionWalletApprovalTransitionError &&
      error.code === "TRANSITION_ILLEGAL" &&
      /pending -> revoked/.test(error.message)
  );
});

test("action-wallet approval state machine: derivation covers pending approved denied expired revoked", () => {
  const approvalRequest = buildApprovalRequest({ decisionTimeoutAt: "2026-03-09T00:05:00.000Z" });

  assert.equal(
    deriveActionWalletApprovalState({
      approvalRequest,
      approvalDecision: null,
      nowAt: "2026-03-09T00:04:59.000Z"
    }),
    ACTION_WALLET_APPROVAL_STATE.PENDING
  );

  assert.equal(
    deriveActionWalletApprovalState({
      approvalRequest,
      approvalDecision: buildApprovalDecision({ approved: true }),
      nowAt: "2026-03-09T00:04:59.000Z"
    }),
    ACTION_WALLET_APPROVAL_STATE.APPROVED
  );

  assert.equal(
    deriveActionWalletApprovalState({
      approvalRequest,
      approvalDecision: buildApprovalDecision({ approved: false }),
      nowAt: "2026-03-09T00:04:59.000Z"
    }),
    ACTION_WALLET_APPROVAL_STATE.DENIED
  );

  assert.equal(
    deriveActionWalletApprovalState({
      approvalRequest,
      approvalDecision: null,
      nowAt: "2026-03-09T00:05:00.000Z"
    }),
    ACTION_WALLET_APPROVAL_STATE.EXPIRED
  );

  assert.equal(
    deriveActionWalletApprovalState({
      approvalRequest,
      approvalDecision: buildApprovalDecision({ approved: true, revokedAt: "2026-03-09T00:06:00.000Z" }),
      nowAt: "2026-03-09T00:06:01.000Z"
    }),
    ACTION_WALLET_APPROVAL_STATE.REVOKED
  );
});

test("action-wallet approval state machine: revocation markers are explicit and deterministic", () => {
  assert.deepEqual(
    getActionWalletApprovalRevocation({
      approvalDecision: buildApprovalDecision({ approved: true, revokedAt: "2026-03-09T00:06:00.000Z" })
    }),
    {
      revokedAt: "2026-03-09T00:06:00.000Z",
      revocationReasonCode: "USER_REVOKED"
    }
  );
});

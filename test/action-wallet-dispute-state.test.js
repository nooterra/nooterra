import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_WALLET_DISPUTE_STATE,
  deriveActionWalletDisputeState,
  normalizeActionWalletDisputeState
} from "../src/core/action-wallet-dispute-state.js";

test("deriveActionWalletDisputeState maps open disputes with no arbitration to opened", () => {
  assert.equal(
    deriveActionWalletDisputeState({
      settlement: {
        disputeStatus: "open",
        disputeOpenedAt: "2026-03-08T16:20:00.000Z",
        status: "released"
      }
    }),
    ACTION_WALLET_DISPUTE_STATE.OPENED
  );
});

test("deriveActionWalletDisputeState maps arbitration without evidence to awaiting_evidence", () => {
  assert.equal(
    deriveActionWalletDisputeState({
      settlement: {
        disputeStatus: "open",
        disputeOpenedAt: "2026-03-08T16:20:00.000Z",
        status: "released"
      },
      arbitrationCase: {
        caseId: "arb_case_wallet_1",
        status: "under_review",
        evidenceRefs: []
      }
    }),
    ACTION_WALLET_DISPUTE_STATE.AWAITING_EVIDENCE
  );
});

test("deriveActionWalletDisputeState maps arbitration with evidence to triaged", () => {
  assert.equal(
    deriveActionWalletDisputeState({
      settlement: {
        disputeStatus: "open",
        disputeOpenedAt: "2026-03-08T16:20:00.000Z",
        status: "released",
        disputeContext: {
          evidenceRefs: ["artifact://receipt.png"]
        }
      },
      arbitrationCase: {
        caseId: "arb_case_wallet_2",
        status: "under_review",
        evidenceRefs: []
      }
    }),
    ACTION_WALLET_DISPUTE_STATE.TRIAGED
  );
});

test("deriveActionWalletDisputeState maps refunded terminal disputes to refunded", () => {
  assert.equal(
    deriveActionWalletDisputeState({
      settlement: {
        disputeStatus: "closed",
        disputeClosedAt: "2026-03-08T17:00:00.000Z",
        status: "refunded",
        disputeResolution: {
          outcome: "accepted"
        }
      }
    }),
    ACTION_WALLET_DISPUTE_STATE.REFUNDED
  );
});

test("deriveActionWalletDisputeState maps rejected terminal disputes to denied", () => {
  assert.equal(
    deriveActionWalletDisputeState({
      settlement: {
        disputeStatus: "closed",
        disputeClosedAt: "2026-03-08T17:00:00.000Z",
        status: "released",
        disputeResolution: {
          outcome: "rejected"
        }
      }
    }),
    ACTION_WALLET_DISPUTE_STATE.DENIED
  );
});

test("deriveActionWalletDisputeState maps non-refund terminal closures to resolved", () => {
  assert.equal(
    deriveActionWalletDisputeState({
      settlement: {
        disputeStatus: "closed",
        disputeClosedAt: "2026-03-08T17:00:00.000Z",
        status: "released",
        disputeResolution: {
          outcome: "accepted"
        }
      }
    }),
    ACTION_WALLET_DISPUTE_STATE.RESOLVED
  );
});

test("normalizeActionWalletDisputeState rejects unknown states fail-closed", () => {
  assert.throws(
    () => normalizeActionWalletDisputeState("open"),
    /status must be one of opened\|triaged\|awaiting_evidence\|refunded\|denied\|resolved/
  );
});

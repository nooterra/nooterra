import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";
import {
  buildAgreementDelegationV1,
  cascadeSettlementCheck,
  refundUnwindCheck
} from "../../src/core/agreement-delegation.js";
import {
  buildSettlementDecisionRecordV2,
  buildSettlementReceiptV1,
  verifySettlementKernelArtifacts
} from "../../src/core/settlement-kernel.js";

const tenantId = "tenant_demo_3hop";
const currency = "USD";
const createdAt = "2026-02-01T00:00:00.000Z";
const settledAt = "2026-02-01T00:10:00.000Z";
const refundedAt = "2026-02-01T00:20:00.000Z";

const agreementA = sha256Hex("agreement:A");
const agreementB = sha256Hex("agreement:B");
const agreementC = sha256Hex("agreement:C");

const delegationAB = buildAgreementDelegationV1({
  delegationId: "dlg_ab_demo",
  tenantId,
  parentAgreementHash: agreementA,
  childAgreementHash: agreementB,
  delegatorAgentId: "agt_A",
  delegateeAgentId: "agt_B",
  budgetCapCents: 20_000,
  currency,
  delegationDepth: 1,
  maxDelegationDepth: 3,
  ancestorChain: [agreementA],
  createdAt
});

const delegationBC = buildAgreementDelegationV1({
  delegationId: "dlg_bc_demo",
  tenantId,
  parentAgreementHash: agreementB,
  childAgreementHash: agreementC,
  delegatorAgentId: "agt_B",
  delegateeAgentId: "agt_C",
  budgetCapCents: 15_000,
  currency,
  delegationDepth: 2,
  maxDelegationDepth: 3,
  ancestorChain: [agreementA, agreementB],
  createdAt
});

const settlePlan = cascadeSettlementCheck({
  delegations: [delegationAB, delegationBC],
  fromChildHash: agreementC
});

const unwindPlan = refundUnwindCheck({
  delegations: [delegationAB, delegationBC],
  fromParentHash: agreementA
});

const grossRevenueCents = 10_000;
const cToBCents = 3_500;
const bToACents = 1_200;
const unwindRefundCents = 900;

const settlePayouts = {
  agt_A: bToACents,
  agt_B: cToBCents - bToACents,
  agt_C: grossRevenueCents - cToBCents
};

const unwindRefunds = {
  agt_A: unwindRefundCents,
  agt_B: unwindRefundCents,
  agt_C: unwindRefundCents
};

const finalPayouts = {
  agt_A: settlePayouts.agt_A - unwindRefundCents,
  agt_B: settlePayouts.agt_B - unwindRefundCents,
  agt_C: settlePayouts.agt_C - unwindRefundCents
};

const settlementSettle = {
  runId: "run_demo_3hop_settle",
  settlementId: "setl_demo_3hop_settle",
  status: "released",
  decisionTrace: {}
};

const settleDecision = buildSettlementDecisionRecordV2({
  decisionId: "dec_demo_3hop_settle",
  tenantId,
  runId: settlementSettle.runId,
  settlementId: settlementSettle.settlementId,
  agreementId: agreementC,
  decisionStatus: "auto_resolved",
  decisionMode: "automatic",
  verificationStatus: "green",
  policyHashUsed: "1".repeat(64),
  verificationMethodHashUsed: "2".repeat(64),
  policyRef: {
    policyHash: "1".repeat(64),
    verificationMethodHash: "2".repeat(64)
  },
  verifierRef: {
    verifierId: "settld.demo",
    verifierVersion: "v1",
    verifierHash: "3".repeat(64),
    modality: "deterministic"
  },
  runStatus: "completed",
  runLastEventId: "ev_demo_3hop_settle",
  runLastChainHash: "4".repeat(64),
  resolutionEventId: "res_demo_3hop_settle",
  decidedAt: settledAt
});

const settleReceipt = buildSettlementReceiptV1({
  receiptId: "rcpt_demo_3hop_settle",
  tenantId,
  runId: settlementSettle.runId,
  settlementId: settlementSettle.settlementId,
  decisionRecord: settleDecision,
  status: "released",
  amountCents: grossRevenueCents,
  releasedAmountCents: grossRevenueCents,
  refundedAmountCents: 0,
  releaseRatePct: 100,
  currency,
  runStatus: "completed",
  resolutionEventId: "res_demo_3hop_settle",
  settledAt,
  createdAt: settledAt
});
settlementSettle.decisionTrace = { decisionRecord: settleDecision, settlementReceipt: settleReceipt };
const settleVerification = verifySettlementKernelArtifacts({ settlement: settlementSettle, runId: settlementSettle.runId });

const settlementUnwind = {
  runId: "run_demo_3hop_unwind",
  settlementId: "setl_demo_3hop_unwind",
  status: "refunded",
  decisionTrace: {}
};

const unwindDecision = buildSettlementDecisionRecordV2({
  decisionId: "dec_demo_3hop_unwind",
  tenantId,
  runId: settlementUnwind.runId,
  settlementId: settlementUnwind.settlementId,
  agreementId: agreementA,
  decisionStatus: "auto_resolved",
  decisionMode: "automatic",
  decisionReason: "refund_unwind",
  verificationStatus: "green",
  policyHashUsed: "5".repeat(64),
  verificationMethodHashUsed: "6".repeat(64),
  policyRef: {
    policyHash: "5".repeat(64),
    verificationMethodHash: "6".repeat(64)
  },
  verifierRef: {
    verifierId: "settld.demo",
    verifierVersion: "v1",
    verifierHash: "7".repeat(64),
    modality: "deterministic"
  },
  runStatus: "completed",
  runLastEventId: "ev_demo_3hop_unwind",
  runLastChainHash: "8".repeat(64),
  resolutionEventId: "res_demo_3hop_unwind",
  decidedAt: refundedAt
});

const unwindReceipt = buildSettlementReceiptV1({
  receiptId: "rcpt_demo_3hop_unwind",
  tenantId,
  runId: settlementUnwind.runId,
  settlementId: settlementUnwind.settlementId,
  decisionRecord: unwindDecision,
  status: "refunded",
  amountCents: unwindRefundCents,
  releasedAmountCents: 0,
  refundedAmountCents: unwindRefundCents,
  releaseRatePct: 0,
  currency,
  runStatus: "completed",
  resolutionEventId: "res_demo_3hop_unwind",
  settledAt: refundedAt,
  createdAt: refundedAt
});
settlementUnwind.decisionTrace = { decisionRecord: unwindDecision, settlementReceipt: unwindReceipt };
const unwindVerification = verifySettlementKernelArtifacts({ settlement: settlementUnwind, runId: settlementUnwind.runId });

const lineage = {
  rootAgreementHash: agreementA,
  chain: [agreementA, agreementB, agreementC],
  delegationHashes: [delegationAB.delegationHash, delegationBC.delegationHash],
  settleParentAgreementHashes: settlePlan.parentAgreementHashes,
  unwindChildAgreementHashes: unwindPlan.childAgreementHashes
};

const report = {
  schemaVersion: "CompositionalSettlementDemo.v1",
  tenantId,
  createdAt,
  lineage,
  decisionHashes: {
    settle: settleDecision.decisionHash,
    unwind: unwindDecision.decisionHash
  },
  receiptHashes: {
    settle: settleReceipt.receiptHash,
    unwind: unwindReceipt.receiptHash
  },
  settlePayouts,
  finalRefunds: unwindRefunds,
  finalPayouts,
  verification: {
    settle: settleVerification.valid === true,
    unwind: unwindVerification.valid === true
  }
};

const reportJson = canonicalJsonStringify(report);
const reportHash = sha256Hex(reportJson);

console.log(`[demo] lineage: ${agreementA.slice(0, 10)} -> ${agreementB.slice(0, 10)} -> ${agreementC.slice(0, 10)}`);
console.log(`[demo] settle decisionHash=${settleDecision.decisionHash}`);
console.log(`[demo] unwind decisionHash=${unwindDecision.decisionHash}`);
console.log(`[demo] final payouts cents=${JSON.stringify(finalPayouts)}`);
console.log(`[demo] final refunds cents=${JSON.stringify(unwindRefunds)}`);
console.log(`REPORT_JSON:${reportJson}`);
console.log(`PASS demo=compositional-settlement-3hop reportHash=${reportHash}`);

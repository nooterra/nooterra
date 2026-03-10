import { normalizeForCanonicalJson } from "./canonical-json.js";
import { validateTaskWalletV1 } from "./task-wallet.js";

export const TASK_WALLET_SPEND_PLAN_SCHEMA_VERSION = "TaskWalletSpendPlan.v1";

export const TASK_WALLET_CONSUMER_SPEND_RAIL = Object.freeze({
  STRIPE_ISSUING_TASK_WALLET: "stripe_issuing_task_wallet",
  NO_DIRECT_CONSUMER_SPEND: "no_direct_consumer_spend"
});

export const TASK_WALLET_PLATFORM_SETTLEMENT_RAIL = Object.freeze({
  STRIPE_CONNECT_MARKETPLACE_SPLIT: "stripe_connect_marketplace_split"
});

export const TASK_WALLET_MACHINE_SPEND_RAIL = Object.freeze({
  X402_OPTIONAL_LATER: "x402_optional_later"
});

export const TASK_WALLET_AUTHORIZATION_PATTERN = Object.freeze({
  TASK_SCOPED_VIRTUAL_CARD: "task_scoped_virtual_card",
  APPROVAL_AT_BOUNDARY: "approval_at_boundary",
  OPERATOR_SUPERVISED_CHECKOUT: "operator_supervised_checkout",
  NO_DIRECT_CONSUMER_SPEND: "no_direct_consumer_spend"
});

export const TASK_WALLET_FINALIZATION_RULE = Object.freeze({
  EVIDENCE_REQUIRED_BEFORE_FINALIZE: "evidence_required_before_finalize",
  PLATFORM_FINALIZE_WITHOUT_EVIDENCE: "platform_finalize_without_evidence"
});

export const TASK_WALLET_REFUND_MODE = Object.freeze({
  PLATFORM_REFUND_AND_DISPUTE: "platform_refund_and_dispute",
  NO_REFUNDS: "no_refunds"
});

function hasPositiveSpendCap(taskWallet) {
  return Number.isSafeInteger(Number(taskWallet?.maxSpendCents)) && Number(taskWallet.maxSpendCents) > 0;
}

function hasMerchantScope(taskWallet) {
  return Array.isArray(taskWallet?.allowedMerchantScopes) && taskWallet.allowedMerchantScopes.length > 0;
}

export function buildTaskWalletSpendPlanV1(taskWallet) {
  validateTaskWalletV1(taskWallet);
  const directConsumerSpend = hasPositiveSpendCap(taskWallet) || hasMerchantScope(taskWallet);
  let authorizationPattern = TASK_WALLET_AUTHORIZATION_PATTERN.NO_DIRECT_CONSUMER_SPEND;
  if (directConsumerSpend) {
    if (taskWallet.reviewMode === "approval_at_boundary" || taskWallet.reviewMode === "human_required") {
      authorizationPattern = TASK_WALLET_AUTHORIZATION_PATTERN.APPROVAL_AT_BOUNDARY;
    } else if (taskWallet.reviewMode === "operator_supervised") {
      authorizationPattern = TASK_WALLET_AUTHORIZATION_PATTERN.OPERATOR_SUPERVISED_CHECKOUT;
    } else {
      authorizationPattern = TASK_WALLET_AUTHORIZATION_PATTERN.TASK_SCOPED_VIRTUAL_CARD;
    }
  }

  return normalizeForCanonicalJson(
    {
      schemaVersion: TASK_WALLET_SPEND_PLAN_SCHEMA_VERSION,
      walletId: taskWallet.walletId,
      tenantId: taskWallet.tenantId,
      categoryId: taskWallet.categoryId ?? null,
      consumerSpendRail: directConsumerSpend
        ? TASK_WALLET_CONSUMER_SPEND_RAIL.STRIPE_ISSUING_TASK_WALLET
        : TASK_WALLET_CONSUMER_SPEND_RAIL.NO_DIRECT_CONSUMER_SPEND,
      platformSettlementRail: TASK_WALLET_PLATFORM_SETTLEMENT_RAIL.STRIPE_CONNECT_MARKETPLACE_SPLIT,
      machineSpendRail: TASK_WALLET_MACHINE_SPEND_RAIL.X402_OPTIONAL_LATER,
      authorizationPattern,
      finalizationRule:
        taskWallet?.settlementPolicy?.requireEvidenceBeforeFinalize === false
          ? TASK_WALLET_FINALIZATION_RULE.PLATFORM_FINALIZE_WITHOUT_EVIDENCE
          : TASK_WALLET_FINALIZATION_RULE.EVIDENCE_REQUIRED_BEFORE_FINALIZE,
      refundMode:
        taskWallet?.settlementPolicy?.allowRefunds === false
          ? TASK_WALLET_REFUND_MODE.NO_REFUNDS
          : TASK_WALLET_REFUND_MODE.PLATFORM_REFUND_AND_DISPUTE,
      merchantScopeCount: Array.isArray(taskWallet.allowedMerchantScopes) ? taskWallet.allowedMerchantScopes.length : 0,
      specialistScopeCount: Array.isArray(taskWallet.allowedSpecialistProfileIds) ? taskWallet.allowedSpecialistProfileIds.length : 0,
      providerScopeCount: Array.isArray(taskWallet.allowedProviderIds) ? taskWallet.allowedProviderIds.length : 0,
      maxSpendCents: hasPositiveSpendCap(taskWallet) ? Number(taskWallet.maxSpendCents) : null,
      currency: typeof taskWallet.currency === "string" ? taskWallet.currency : null,
      reviewMode: typeof taskWallet.reviewMode === "string" ? taskWallet.reviewMode : null,
      settlementModel: typeof taskWallet?.settlementPolicy?.settlementModel === "string" ? taskWallet.settlementPolicy.settlementModel : null
    },
    { path: "$.taskWalletSpendPlan" }
  );
}

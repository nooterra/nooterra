export const BILLING_PLAN_ID = Object.freeze({
  FREE: "free",
  BUILDER: "builder",
  GROWTH: "growth",
  ENTERPRISE: "enterprise"
});

const BILLING_PLAN_CATALOG = Object.freeze({
  [BILLING_PLAN_ID.FREE]: Object.freeze({
    planId: BILLING_PLAN_ID.FREE,
    displayName: "Free",
    subscriptionCents: 0,
    includedVerifiedRunsPerMonth: 1000,
    verifiedRunOverageCents: 0,
    settledVolumeFeeBps: 0,
    arbitrationCaseFeeCents: 0,
    hardLimitVerifiedRunsPerMonth: 1000
  }),
  [BILLING_PLAN_ID.BUILDER]: Object.freeze({
    planId: BILLING_PLAN_ID.BUILDER,
    displayName: "Builder",
    subscriptionCents: 9900,
    includedVerifiedRunsPerMonth: 10_000,
    verifiedRunOverageCents: 1,
    settledVolumeFeeBps: 75,
    arbitrationCaseFeeCents: 200,
    hardLimitVerifiedRunsPerMonth: 0
  }),
  [BILLING_PLAN_ID.GROWTH]: Object.freeze({
    planId: BILLING_PLAN_ID.GROWTH,
    displayName: "Growth",
    subscriptionCents: 59_900,
    includedVerifiedRunsPerMonth: 100_000,
    verifiedRunOverageCents: 1,
    settledVolumeFeeBps: 45,
    arbitrationCaseFeeCents: 100,
    hardLimitVerifiedRunsPerMonth: 0
  }),
  [BILLING_PLAN_ID.ENTERPRISE]: Object.freeze({
    planId: BILLING_PLAN_ID.ENTERPRISE,
    displayName: "Enterprise",
    subscriptionCents: 0,
    includedVerifiedRunsPerMonth: 0,
    verifiedRunOverageCents: 0,
    settledVolumeFeeBps: 35,
    arbitrationCaseFeeCents: 0,
    hardLimitVerifiedRunsPerMonth: 0
  })
});

function assertNonNegativeSafeInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return n;
}

export function normalizeBillingPlanId(value, { allowNull = false, defaultPlan = BILLING_PLAN_ID.FREE } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (allowNull) return null;
    return normalizeBillingPlanId(defaultPlan, { allowNull: false, defaultPlan: BILLING_PLAN_ID.FREE });
  }
  const normalized = String(value).trim().toLowerCase();
  if (!(normalized in BILLING_PLAN_CATALOG)) {
    const known = Object.keys(BILLING_PLAN_CATALOG).join("|");
    throw new TypeError(`billing plan must be one of ${known}`);
  }
  return normalized;
}

export function getBillingPlanCatalog() {
  return JSON.parse(JSON.stringify(BILLING_PLAN_CATALOG));
}

export function getBillingPlanById(planId) {
  const normalizedPlanId = normalizeBillingPlanId(planId, { allowNull: false });
  return BILLING_PLAN_CATALOG[normalizedPlanId];
}

export function normalizeBillingPlanOverrides(input, { allowNull = true } = {}) {
  if (input === undefined) return undefined;
  if (input === null) return allowNull ? null : {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("billing plan overrides must be an object or null");
  }

  const out = {};
  if (Object.prototype.hasOwnProperty.call(input, "subscriptionCents")) {
    out.subscriptionCents = assertNonNegativeSafeInt(input.subscriptionCents, "billing.overrides.subscriptionCents");
  }
  if (Object.prototype.hasOwnProperty.call(input, "includedVerifiedRunsPerMonth")) {
    out.includedVerifiedRunsPerMonth = assertNonNegativeSafeInt(
      input.includedVerifiedRunsPerMonth,
      "billing.overrides.includedVerifiedRunsPerMonth"
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, "verifiedRunOverageCents")) {
    out.verifiedRunOverageCents = assertNonNegativeSafeInt(
      input.verifiedRunOverageCents,
      "billing.overrides.verifiedRunOverageCents"
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, "settledVolumeFeeBps")) {
    const bps = assertNonNegativeSafeInt(input.settledVolumeFeeBps, "billing.overrides.settledVolumeFeeBps");
    if (bps > 10_000) throw new TypeError("billing.overrides.settledVolumeFeeBps must be within 0..10000");
    out.settledVolumeFeeBps = bps;
  }
  if (Object.prototype.hasOwnProperty.call(input, "arbitrationCaseFeeCents")) {
    out.arbitrationCaseFeeCents = assertNonNegativeSafeInt(
      input.arbitrationCaseFeeCents,
      "billing.overrides.arbitrationCaseFeeCents"
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, "hardLimitVerifiedRunsPerMonth")) {
    out.hardLimitVerifiedRunsPerMonth = assertNonNegativeSafeInt(
      input.hardLimitVerifiedRunsPerMonth,
      "billing.overrides.hardLimitVerifiedRunsPerMonth"
    );
  }
  return out;
}

export function resolveBillingPlan({ planId, overrides = null, hardLimitEnforced = true } = {}) {
  const base = getBillingPlanById(planId);
  const normalizedOverrides = normalizeBillingPlanOverrides(overrides, { allowNull: true });
  const merged = normalizedOverrides ? { ...base, ...normalizedOverrides } : { ...base };
  return {
    ...merged,
    hardLimitEnforced: hardLimitEnforced !== false
  };
}

export function computeBillingEstimate({
  plan,
  usage = null
} = {}) {
  const normalizedPlan = resolveBillingPlan({
    planId: plan?.planId ?? BILLING_PLAN_ID.FREE,
    overrides: null,
    hardLimitEnforced: plan?.hardLimitEnforced !== false
  });
  const includedVerifiedRunsPerMonth = assertNonNegativeSafeInt(
    plan?.includedVerifiedRunsPerMonth ?? normalizedPlan.includedVerifiedRunsPerMonth ?? 0,
    "plan.includedVerifiedRunsPerMonth"
  );
  const verifiedRunOverageCentsPerUnit = assertNonNegativeSafeInt(
    plan?.verifiedRunOverageCents ?? normalizedPlan.verifiedRunOverageCents ?? 0,
    "plan.verifiedRunOverageCents"
  );
  const settledVolumeFeeBps = assertNonNegativeSafeInt(
    plan?.settledVolumeFeeBps ?? normalizedPlan.settledVolumeFeeBps ?? 0,
    "plan.settledVolumeFeeBps"
  );
  const arbitrationCaseFeeCents = assertNonNegativeSafeInt(
    plan?.arbitrationCaseFeeCents ?? normalizedPlan.arbitrationCaseFeeCents ?? 0,
    "plan.arbitrationCaseFeeCents"
  );
  const subscriptionCents = assertNonNegativeSafeInt(
    plan?.subscriptionCents ?? normalizedPlan.subscriptionCents ?? 0,
    "plan.subscriptionCents"
  );

  const verifiedRuns = assertNonNegativeSafeInt(usage?.verifiedRuns ?? 0, "usage.verifiedRuns");
  const settledVolumeCents = assertNonNegativeSafeInt(usage?.settledVolumeCents ?? 0, "usage.settledVolumeCents");
  const arbitrationCases = assertNonNegativeSafeInt(usage?.arbitrationCases ?? 0, "usage.arbitrationCases");

  const verifiedRunOverageUnits =
    includedVerifiedRunsPerMonth > 0 ? Math.max(0, verifiedRuns - includedVerifiedRunsPerMonth) : 0;
  const verifiedRunOverageCents = verifiedRunOverageUnits * verifiedRunOverageCentsPerUnit;
  const settledVolumeFeeCents = Math.floor((settledVolumeCents * settledVolumeFeeBps) / 10_000);
  const arbitrationFeeCents = arbitrationCases * arbitrationCaseFeeCents;
  const totalEstimatedCents = subscriptionCents + verifiedRunOverageCents + settledVolumeFeeCents + arbitrationFeeCents;

  return {
    subscriptionCents,
    includedVerifiedRunsPerMonth,
    verifiedRunOverageUnits,
    verifiedRunOverageCents,
    verifiedRunOverageCentsPerUnit,
    settledVolumeFeeBps,
    settledVolumeFeeCents,
    arbitrationCaseFeeCents,
    arbitrationFeeCents,
    totalEstimatedCents
  };
}

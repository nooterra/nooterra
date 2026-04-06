export const WORLD_BILLING_PLAN_ID = Object.freeze({
  SANDBOX: "sandbox",
  STARTER: "starter",
  GROWTH: "growth",
  FINANCE_OPS: "finance_ops",
  ENTERPRISE: "enterprise"
});

const WORLD_BILLING_PLAN_ORDER = Object.freeze([
  WORLD_BILLING_PLAN_ID.SANDBOX,
  WORLD_BILLING_PLAN_ID.STARTER,
  WORLD_BILLING_PLAN_ID.GROWTH,
  WORLD_BILLING_PLAN_ID.FINANCE_OPS,
  WORLD_BILLING_PLAN_ID.ENTERPRISE
]);

const WORLD_BILLING_PLAN_CATALOG = Object.freeze({
  [WORLD_BILLING_PLAN_ID.SANDBOX]: Object.freeze({
    planId: WORLD_BILLING_PLAN_ID.SANDBOX,
    displayName: "Sandbox",
    subscriptionCents: 0,
    checkoutEnabled: false,
    isTrial: true
  }),
  [WORLD_BILLING_PLAN_ID.STARTER]: Object.freeze({
    planId: WORLD_BILLING_PLAN_ID.STARTER,
    displayName: "Starter",
    subscriptionCents: 9_900,
    checkoutEnabled: true,
    isTrial: false
  }),
  [WORLD_BILLING_PLAN_ID.GROWTH]: Object.freeze({
    planId: WORLD_BILLING_PLAN_ID.GROWTH,
    displayName: "Growth",
    subscriptionCents: 29_900,
    checkoutEnabled: true,
    isTrial: false
  }),
  [WORLD_BILLING_PLAN_ID.FINANCE_OPS]: Object.freeze({
    planId: WORLD_BILLING_PLAN_ID.FINANCE_OPS,
    displayName: "Finance Ops",
    subscriptionCents: 79_900,
    checkoutEnabled: true,
    isTrial: false
  }),
  [WORLD_BILLING_PLAN_ID.ENTERPRISE]: Object.freeze({
    planId: WORLD_BILLING_PLAN_ID.ENTERPRISE,
    displayName: "Enterprise",
    subscriptionCents: null,
    checkoutEnabled: false,
    isTrial: false
  })
});

const WORLD_BILLING_PLAN_ALIASES = Object.freeze({
  free: WORLD_BILLING_PLAN_ID.SANDBOX,
  builder: WORLD_BILLING_PLAN_ID.STARTER,
  pro: WORLD_BILLING_PLAN_ID.GROWTH,
  scale: WORLD_BILLING_PLAN_ID.FINANCE_OPS,
  "finance-ops": WORLD_BILLING_PLAN_ID.FINANCE_OPS,
  financeops: WORLD_BILLING_PLAN_ID.FINANCE_OPS
});

const WORLD_BILLING_PLAN_ERROR_MESSAGE = `billing plan must be one of ${[
  ...WORLD_BILLING_PLAN_ORDER,
  ...Object.keys(WORLD_BILLING_PLAN_ALIASES)
].join("|")}`;

export function canonicalizeWorldBillingPlanId(
  value,
  {
    allowNull = false,
    defaultPlan = WORLD_BILLING_PLAN_ID.SANDBOX,
    preserveUnknown = false
  } = {}
) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (allowNull) return null;
    return defaultPlan;
  }
  const normalized = String(value).trim().toLowerCase();
  const aliased = WORLD_BILLING_PLAN_ALIASES[normalized] || normalized;
  if (Object.prototype.hasOwnProperty.call(WORLD_BILLING_PLAN_CATALOG, aliased)) return aliased;
  if (preserveUnknown) return aliased;
  throw new TypeError(WORLD_BILLING_PLAN_ERROR_MESSAGE);
}

export function normalizeWorldBillingPlanId(value, options = {}) {
  return canonicalizeWorldBillingPlanId(value, { ...options, preserveUnknown: false });
}

export function getWorldBillingPlanById(planId) {
  const normalizedPlanId = normalizeWorldBillingPlanId(planId, { allowNull: false });
  return WORLD_BILLING_PLAN_CATALOG[normalizedPlanId];
}

export function getWorldBillingPlanCatalog() {
  return JSON.parse(JSON.stringify(WORLD_BILLING_PLAN_CATALOG));
}

export function isPaidWorldBillingPlan(planId) {
  const plan = getWorldBillingPlanById(planId);
  return plan.checkoutEnabled === true;
}

export function nextWorldBillingPlanId(planId, { includeEnterprise = true } = {}) {
  const normalized = normalizeWorldBillingPlanId(planId, { allowNull: false });
  const order = includeEnterprise
    ? WORLD_BILLING_PLAN_ORDER
    : WORLD_BILLING_PLAN_ORDER.filter((value) => value !== WORLD_BILLING_PLAN_ID.ENTERPRISE);
  const index = order.indexOf(normalized);
  if (index < 0 || index >= order.length - 1) return null;
  return order[index + 1];
}

// Compatibility exports for the current runtime billing integration.
export const WORLD_BILLING_PLAN_DEFS = Object.freeze(
  Object.fromEntries(
    Object.entries(WORLD_BILLING_PLAN_CATALOG).map(([key, value]) => [key, Object.freeze({ ...value })])
  )
);

export function normalizeWorldBillingPlan(value, options = {}) {
  return canonicalizeWorldBillingPlanId(value, options);
}

export function isCheckoutEnabledWorldBillingPlan(planId) {
  try {
    return isPaidWorldBillingPlan(planId);
  } catch {
    return false;
  }
}

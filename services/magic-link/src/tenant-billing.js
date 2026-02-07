import fs from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

export function defaultTenantBillingState({ tenantId }) {
  return {
    schemaVersion: "MagicLinkTenantBilling.v1",
    tenantId,
    provider: "stripe",
    currentPlan: "free",
    status: "inactive",
    customerId: null,
    subscriptionId: null,
    lastCheckoutSessionId: null,
    paymentDelinquent: false,
    suspended: false,
    updatedAt: nowIso(),
    lastEvent: null
  };
}

function billingStatePath({ dataDir, tenantId }) {
  return path.join(dataDir, "tenants", tenantId, "billing.json");
}

function stripeEventPath({ dataDir, eventId }) {
  return path.join(dataDir, "billing", "stripe", "events", `${eventId}.json`);
}

function stripeCustomerPath({ dataDir, customerId }) {
  return path.join(dataDir, "billing", "stripe", "customers", `${customerId}.json`);
}

export async function loadTenantBillingStateBestEffort({ dataDir, tenantId }) {
  const fp = billingStatePath({ dataDir, tenantId });
  try {
    const raw = JSON.parse(await fs.readFile(fp, "utf8"));
    if (!isPlainObject(raw)) return defaultTenantBillingState({ tenantId });
    return { ...defaultTenantBillingState({ tenantId }), ...raw, tenantId };
  } catch {
    return defaultTenantBillingState({ tenantId });
  }
}

export async function saveTenantBillingState({ dataDir, tenantId, state }) {
  const fp = billingStatePath({ dataDir, tenantId });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const next = { ...defaultTenantBillingState({ tenantId }), ...(isPlainObject(state) ? state : {}), tenantId, updatedAt: nowIso() };
  await fs.writeFile(fp, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export async function patchTenantBillingState({ dataDir, tenantId, patch }) {
  const cur = await loadTenantBillingStateBestEffort({ dataDir, tenantId });
  return await saveTenantBillingState({ dataDir, tenantId, state: { ...cur, ...(isPlainObject(patch) ? patch : {}) } });
}

export async function isStripeEventProcessed({ dataDir, eventId }) {
  if (!eventId || typeof eventId !== "string") return false;
  const fp = stripeEventPath({ dataDir, eventId });
  try {
    await fs.access(fp);
    return true;
  } catch {
    return false;
  }
}

export async function markStripeEventProcessed({ dataDir, eventId, payload }) {
  if (!eventId || typeof eventId !== "string") return null;
  const fp = stripeEventPath({ dataDir, eventId });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const row = {
    schemaVersion: "MagicLinkStripeEventReceipt.v1",
    eventId,
    receivedAt: nowIso(),
    payload
  };
  await fs.writeFile(fp, JSON.stringify(row, null, 2) + "\n", "utf8");
  return row;
}

export async function setStripeCustomerTenantMap({ dataDir, customerId, tenantId }) {
  if (!customerId || !tenantId) return null;
  const fp = stripeCustomerPath({ dataDir, customerId });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const row = {
    schemaVersion: "MagicLinkStripeCustomerTenantMap.v1",
    customerId,
    tenantId,
    updatedAt: nowIso()
  };
  await fs.writeFile(fp, JSON.stringify(row, null, 2) + "\n", "utf8");
  return row;
}

export async function getTenantIdByStripeCustomerId({ dataDir, customerId }) {
  if (!customerId || typeof customerId !== "string") return null;
  const fp = stripeCustomerPath({ dataDir, customerId });
  try {
    const raw = JSON.parse(await fs.readFile(fp, "utf8"));
    if (!isPlainObject(raw)) return null;
    const tenantId = typeof raw.tenantId === "string" ? raw.tenantId.trim() : "";
    return tenantId || null;
  } catch {
    return null;
  }
}

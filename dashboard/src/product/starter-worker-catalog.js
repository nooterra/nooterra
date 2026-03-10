import {
  getPhase1ManagedWorkerMetadata,
  phase1ManagedSpecialistProfiles
} from "./phase1-task-catalog.js";

export const starterWorkerProfiles = Object.freeze(
  phase1ManagedSpecialistProfiles.map((profile) =>
    Object.freeze({
      ...profile,
      metadata: Object.freeze({
        phase1ManagedNetwork: getPhase1ManagedWorkerMetadata(profile)
      })
    })
  )
);

export const starterWorkerSetPresets = Object.freeze([
  Object.freeze({
    id: "launch_supply",
    title: "Phase 1 Launch Supply",
    body: "Seed the managed consumer delegation roster for comparison, booking, subscriptions, support, purchases, and documents.",
    profileIds: Object.freeze([
      "comparison_concierge",
      "purchase_runner",
      "booking_concierge",
      "account_admin",
      "support_followup",
      "document_packager"
    ])
  }),
  Object.freeze({
    id: "household_admin",
    title: "Household Admin",
    body: "Stand up the booking, account, support, and document specialists most household workflows need.",
    profileIds: Object.freeze(["booking_concierge", "account_admin", "support_followup", "document_packager"])
  }),
  Object.freeze({
    id: "shopping_lane",
    title: "Shopping Lane",
    body: "Cover research, bounded purchasing, and post-purchase support follow-up.",
    profileIds: Object.freeze(["comparison_concierge", "purchase_runner", "support_followup"])
  })
]);

export function toStarterWorkerSlug(value, fallback = "tenant") {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

export function formatStarterWorkerCapabilities(profile) {
  return Array.isArray(profile?.capabilities) ? profile.capabilities.join("\n") : "";
}

export function formatStarterWorkerTags(profile) {
  return Array.isArray(profile?.tags) ? profile.tags.join(", ") : "";
}

function normalizeEndpointBaseUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.replace(/\/+$/, "");
}

export function deriveStarterWorkerDraft(profile, { tenantId, endpointBaseUrl = "" } = {}) {
  if (!profile || typeof profile !== "object") throw new TypeError("profile is required");
  const tenantSlug = toStarterWorkerSlug(tenantId, "tenant");
  const normalizedEndpointBaseUrl = normalizeEndpointBaseUrl(endpointBaseUrl);
  const agentId = `agt_${tenantSlug}_${profile.id}`;
  return {
    agentId,
    ownerType: "service",
    ownerId: `svc_${tenantSlug}_${profile.id}`,
    displayName: String(profile.displayName ?? profile.title ?? agentId),
    description: String(profile.description ?? ""),
    capabilities: Array.isArray(profile.capabilities) ? [...profile.capabilities] : [],
    visibility: "public",
    runtimeName: String(profile.runtimeName ?? "nooterra"),
    endpoint: normalizedEndpointBaseUrl ? `${normalizedEndpointBaseUrl}/${encodeURIComponent(agentId)}` : "",
    priceAmountCents: String(profile.priceAmountCents ?? 0),
    priceCurrency: String(profile.priceCurrency ?? "USD"),
    priceUnit: String(profile.priceUnit ?? "task"),
    tags: Array.isArray(profile.tags) ? [...profile.tags] : [],
    metadata: profile?.metadata ? structuredClone(profile.metadata) : null
  };
}

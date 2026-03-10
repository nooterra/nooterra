import fs from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";

import { keyIdFromPublicKeyPem } from "../core/crypto.js";
import { getPhase1ManagedWorkerMetadata } from "../core/phase1-task-policy.js";
import { computePaidToolManifestHashV1 } from "../core/paid-tool-manifest.js";
import { mintProviderPublishProofTokenV1 } from "../core/provider-publish-proof.js";
import { formatStarterWorkerCapabilities, formatStarterWorkerTags, toStarterWorkerSlug } from "./starter-worker-catalog.js";

function normalizeBaseUrl(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.replace(/\/+$/, "");
}

function normalizeLowercaseTokens(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function providerRiskProfile(profileId) {
  if (profileId === "purchase_runner") return { toolClass: "action", riskLevel: "high", idempotency: "side_effecting", requestBinding: "strict" };
  if (profileId === "account_admin") return { toolClass: "action", riskLevel: "high", idempotency: "side_effecting", requestBinding: "strict" };
  if (profileId === "booking_concierge") return { toolClass: "action", riskLevel: "medium", idempotency: "side_effecting", requestBinding: "strict" };
  if (profileId === "support_followup") return { toolClass: "action", riskLevel: "medium", idempotency: "side_effecting", requestBinding: "strict" };
  if (profileId === "document_packager") return { toolClass: "action", riskLevel: "medium", idempotency: "idempotent", requestBinding: "recommended" };
  return { toolClass: "compute", riskLevel: "low", idempotency: "idempotent", requestBinding: "recommended" };
}

export function deriveStarterProviderDraft(profile, { tenantId, baseUrl = "" } = {}) {
  if (!profile || typeof profile !== "object") throw new TypeError("profile is required");
  const profileId = String(profile.id ?? "provider").trim();
  const tenantSlug = toStarterWorkerSlug(tenantId, "tenant");
  const slug = toStarterWorkerSlug(profileId, "provider");
  const managedMetadata = getPhase1ManagedWorkerMetadata(profile);
  const executionAdapter = managedMetadata.executionAdapter ?? null;
  const riskProfile = providerRiskProfile(profileId);
  const sessionModes = Array.isArray(executionAdapter?.supportedSessionModes) ? executionAdapter.supportedSessionModes.join(", ") : "";
  return {
    providerId: `provider_${tenantSlug}_${slug}`,
    baseUrl: normalizeBaseUrl(baseUrl),
    description:
      String(profile.body ?? profile.description ?? "").trim() ||
      "Hosted provider surface for this managed Phase 1 specialist.",
    tags: formatStarterWorkerTags(profile),
    toolId: `tool_${slug}`,
    mcpToolName: slug,
    toolDescription:
      String(profile.body ?? profile.description ?? "").trim() ||
      "Paid provider entrypoint for this managed specialist.",
    method: "POST",
    paidPath: `/paid/${slug}`,
    upstreamPath: "/invoke",
    amountCents: String(profile.priceAmountCents ?? 500),
    currency: String(profile.priceCurrency ?? "USD"),
    requiredSignatures: "output",
    signatureMode: "required",
    capabilityTags: formatStarterWorkerCapabilities(profile),
    phase1ManagedMetadata: managedMetadata,
    delegatedBrowserRuntime:
      executionAdapter?.mode === "delegated_account_session"
        ? {
            runtime: "playwright_delegated_browser_session",
            requiresBrowserProfile: true,
            requiredSessionFields: ["browserProfile.allowedDomains", "browserProfile.reviewMode", "browserProfile.storageStateRef"],
            supportsStoredState: true
          }
        : null,
    executionAdapterSummary: executionAdapter
      ? `Delegated account sessions (${sessionModes || "no session modes declared"})`
      : "",
    ...riskProfile
  };
}

export function buildStarterProviderManifest({
  profile,
  providerDraft,
  publishProofJwksUrl,
  contactUrl = null,
  termsUrl = null
} = {}) {
  if (!profile || typeof profile !== "object") throw new TypeError("profile is required");
  if (!providerDraft || typeof providerDraft !== "object") throw new TypeError("providerDraft is required");
  const capabilityTags = normalizeLowercaseTokens(String(providerDraft.capabilityTags ?? "").split(/[\n,]+/g));
  const tags = normalizeLowercaseTokens(String(providerDraft.tags ?? "").split(","));
  const managedMetadata = providerDraft.phase1ManagedMetadata ?? getPhase1ManagedWorkerMetadata(profile);
  return {
    schemaVersion: "PaidToolManifest.v2",
    providerId: String(providerDraft.providerId).trim(),
    upstreamBaseUrl: normalizeBaseUrl(providerDraft.baseUrl),
    publishProofJwksUrl: String(publishProofJwksUrl ?? "").trim() || null,
    defaults: {
      amountCents: Number.parseInt(String(providerDraft.amountCents ?? "500"), 10),
      currency: String(providerDraft.currency ?? "USD").trim().toUpperCase(),
      idempotency: String(providerDraft.idempotency ?? "idempotent").trim().toLowerCase(),
      signatureMode: String(providerDraft.signatureMode ?? "required").trim().toLowerCase(),
      toolClass: String(providerDraft.toolClass ?? "compute").trim().toLowerCase(),
      riskLevel: String(providerDraft.riskLevel ?? "low").trim().toLowerCase(),
      requiredSignatures: normalizeLowercaseTokens(String(providerDraft.requiredSignatures ?? "output").split(",")),
      requestBinding: String(providerDraft.requestBinding ?? "recommended").trim().toLowerCase()
    },
    capabilityTags: capabilityTags.length > 0 ? capabilityTags : tags,
    tools: [
      {
        toolId: String(providerDraft.toolId).trim(),
        mcpToolName: String(providerDraft.mcpToolName ?? "").trim() || null,
        description: String(providerDraft.toolDescription ?? "").trim() || null,
        method: String(providerDraft.method ?? "POST").trim().toUpperCase(),
        upstreamPath: String(providerDraft.upstreamPath ?? "").trim() || null,
        paidPath: String(providerDraft.paidPath ?? "").trim(),
        pricing: {
          amountCents: Number.parseInt(String(providerDraft.amountCents ?? "500"), 10),
          currency: String(providerDraft.currency ?? "USD").trim().toUpperCase()
        },
        idempotency: String(providerDraft.idempotency ?? "idempotent").trim().toLowerCase(),
        signatureMode: String(providerDraft.signatureMode ?? "required").trim().toLowerCase(),
        auth: { mode: "none" },
        metadata: {
          phase1ManagedNetwork: normalizeForStarterProviderMetadata(managedMetadata, providerDraft.delegatedBrowserRuntime)
        },
        toolClass: String(providerDraft.toolClass ?? "compute").trim().toLowerCase(),
        riskLevel: String(providerDraft.riskLevel ?? "low").trim().toLowerCase(),
        capabilityTags,
        security: {
          requiredSignatures: normalizeLowercaseTokens(String(providerDraft.requiredSignatures ?? "output").split(",")),
          requestBinding: String(providerDraft.requestBinding ?? "recommended").trim().toLowerCase()
        }
      }
    ],
    description: String(providerDraft.description ?? "").trim() || null,
    contactUrl: contactUrl ? String(contactUrl).trim() : null,
    termsUrl: termsUrl ? String(termsUrl).trim() : null
  };
}

function normalizeForStarterProviderMetadata(managedMetadata, delegatedBrowserRuntime) {
  const metadata = managedMetadata && typeof managedMetadata === "object" ? managedMetadata : {};
  const executionAdapter =
    metadata.executionAdapter && typeof metadata.executionAdapter === "object" && !Array.isArray(metadata.executionAdapter)
      ? {
          ...metadata.executionAdapter,
          delegatedBrowserRuntime:
            delegatedBrowserRuntime && typeof delegatedBrowserRuntime === "object" && !Array.isArray(delegatedBrowserRuntime)
              ? delegatedBrowserRuntime
              : null
        }
      : null;
  return {
    ...metadata,
    executionAdapter
  };
}

export function resolvePublishProofKeyMaterial({ privateKeyPem = null, privateKeyFile = null } = {}) {
  let raw = null;
  if (typeof privateKeyPem === "string" && privateKeyPem.trim()) raw = privateKeyPem.trim();
  else if (typeof privateKeyFile === "string" && privateKeyFile.trim()) {
    raw = fs.readFileSync(privateKeyFile, "utf8").trim();
  }
  if (!raw) return null;
  const resolvedPrivateKeyPem = raw.startsWith("{")
    ? createPrivateKey({ key: JSON.parse(raw), format: "jwk" }).export({ format: "pem", type: "pkcs8" }).toString()
    : raw;
  const publicKeyPem = createPublicKey(createPrivateKey(resolvedPrivateKeyPem)).export({ format: "pem", type: "spki" }).toString();
  return {
    privateKeyPem: resolvedPrivateKeyPem,
    publicKeyPem,
    keyId: keyIdFromPublicKeyPem(publicKeyPem)
  };
}

export function mintStarterProviderPublishProof({ manifest, providerId, privateKeyPem, publicKeyPem, keyId = null, ttlSeconds = 300 } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return mintProviderPublishProofTokenV1({
    payload: {
      manifestHash: computePaidToolManifestHashV1(manifest),
      providerId,
      iat: nowSec,
      exp: nowSec + Number(ttlSeconds)
    },
    keyId,
    publicKeyPem,
    privateKeyPem
  });
}

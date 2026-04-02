import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const MARKETPLACE_OFFER_SCHEMA_VERSION = "MarketplaceOffer.v2";
export const MARKETPLACE_ACCEPTANCE_SCHEMA_VERSION = "MarketplaceAcceptance.v2";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertIsoDate(value, name, { allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return;
    throw new TypeError(`${name} must be an ISO date string`);
  }
  assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO date string`);
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function normalizeSafeInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, allowNull = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${name} must be an integer in range ${min}..${max}`);
  }
  return parsed;
}

function normalizeSha256Hex(value, name, { allowNull = false } = {}) {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be a 64-char lowercase hex sha256`);
  return normalized;
}

function deriveProposalHash(proposal) {
  const raw = proposal && typeof proposal === "object" && !Array.isArray(proposal) ? proposal : null;
  if (!raw) return null;
  try {
    const withoutHash = { ...raw };
    delete withoutHash.proposalHash;
    return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(withoutHash, { path: "$" })));
  } catch {
    return null;
  }
}

function normalizeCurrency(value, name) {
  assertNonEmptyString(value, name);
  return String(value).trim().toUpperCase();
}

export function buildMarketplaceOffer({
  offerId = null,
  tenantId,
  rfqId,
  runId = null,
  bidId,
  proposal,
  offerChainHash,
  proposalCount = null,
  createdAt = null
}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(rfqId, "rfqId");
  assertNonEmptyString(bidId, "bidId");

  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    throw new TypeError("proposal is required");
  }

  const proposalId = normalizeOptionalString(proposal.proposalId);
  const revision = normalizeSafeInt(proposal.revision, "proposal.revision", { min: 1 });
  const proposerAgentId = normalizeOptionalString(proposal.proposerAgentId);
  const amountCents = normalizeSafeInt(proposal.amountCents, "proposal.amountCents", { min: 1 });
  const currency = normalizeCurrency(proposal.currency, "proposal.currency");
  const etaSeconds = normalizeSafeInt(proposal.etaSeconds, "proposal.etaSeconds", { min: 1, allowNull: true });
  const proposalHash = normalizeSha256Hex(proposal.proposalHash ?? deriveProposalHash(proposal), "proposal.proposalHash");
  const prevProposalHash = normalizeSha256Hex(proposal.prevProposalHash, "proposal.prevProposalHash", { allowNull: true });
  const normalizedOfferChainHash = normalizeSha256Hex(offerChainHash, "offerChainHash", { allowNull: true });
  const normalizedProposalCount = normalizeSafeInt(proposalCount, "proposalCount", { min: 1, allowNull: true });

  const proposedAt =
    typeof proposal.proposedAt === "string" && Number.isFinite(Date.parse(proposal.proposedAt))
      ? new Date(Date.parse(proposal.proposedAt)).toISOString()
      : new Date().toISOString();
  const normalizedCreatedAt = createdAt ?? proposedAt;
  assertIsoDate(normalizedCreatedAt, "createdAt");

  const normalizedOfferId =
    normalizeOptionalString(offerId) ??
    `ofr_${rfqId}_${bidId}_${proposalId ?? `r${revision}`}`;

  const body = normalizeForCanonicalJson(
    {
      schemaVersion: MARKETPLACE_OFFER_SCHEMA_VERSION,
      offerId: normalizedOfferId,
      tenantId: String(tenantId),
      rfqId: String(rfqId),
      runId: normalizeOptionalString(runId),
      bidId: String(bidId),
      proposalId,
      revision,
      proposerAgentId,
      amountCents,
      currency,
      etaSeconds,
      note: normalizeOptionalString(proposal.note),
      verificationMethod:
        proposal.verificationMethod && typeof proposal.verificationMethod === "object" && !Array.isArray(proposal.verificationMethod)
          ? normalizeForCanonicalJson(proposal.verificationMethod, { path: "$" })
          : null,
      policy: proposal.policy && typeof proposal.policy === "object" && !Array.isArray(proposal.policy)
        ? normalizeForCanonicalJson(proposal.policy, { path: "$" })
        : null,
      policyRef: proposal.policyRef && typeof proposal.policyRef === "object" && !Array.isArray(proposal.policyRef)
        ? normalizeForCanonicalJson(proposal.policyRef, { path: "$" })
        : null,
      policyRefHash: normalizeSha256Hex(proposal.policyRefHash, "proposal.policyRefHash", { allowNull: true }),
      prevProposalHash,
      proposalHash,
      offerChainHash: normalizedOfferChainHash,
      proposalCount: normalizedProposalCount,
      metadata:
        proposal.metadata && typeof proposal.metadata === "object" && !Array.isArray(proposal.metadata)
          ? normalizeForCanonicalJson(proposal.metadata, { path: "$" })
          : null,
      proposedAt,
      createdAt: normalizedCreatedAt
    },
    { path: "$" }
  );

  return normalizeForCanonicalJson(
    {
      ...body,
      offerHash: sha256Hex(canonicalJsonStringify(body))
    },
    { path: "$" }
  );
}

export function buildMarketplaceAcceptance({
  acceptanceId = null,
  tenantId,
  rfqId,
  runId,
  bidId,
  agreementId = null,
  acceptedAt = null,
  acceptedByAgentId = null,
  acceptedProposalId = null,
  acceptedRevision = null,
  acceptedProposalHash = null,
  offerChainHash = null,
  proposalCount = null,
  offer = null,
  createdAt = new Date().toISOString()
}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(rfqId, "rfqId");
  assertNonEmptyString(runId, "runId");
  assertNonEmptyString(bidId, "bidId");
  assertIsoDate(acceptedAt, "acceptedAt", { allowNull: true });
  assertIsoDate(createdAt, "createdAt");

  const offerObj = offer && typeof offer === "object" && !Array.isArray(offer) ? offer : null;
  const offerId = normalizeOptionalString(offerObj?.offerId);
  const offerHash = normalizeSha256Hex(offerObj?.offerHash, "offer.offerHash", { allowNull: true });

  const normalizedAcceptedProposalHash = normalizeSha256Hex(
    acceptedProposalHash ?? offerObj?.proposalHash ?? null,
    "acceptedProposalHash",
    { allowNull: true }
  );
  const normalizedOfferChainHash = normalizeSha256Hex(
    offerChainHash ?? offerObj?.offerChainHash ?? null,
    "offerChainHash",
    { allowNull: true }
  );
  const normalizedProposalCount = normalizeSafeInt(
    proposalCount ?? offerObj?.proposalCount ?? null,
    "proposalCount",
    { min: 1, allowNull: true }
  );

  const normalizedAcceptedRevision =
    acceptedRevision === null || acceptedRevision === undefined || acceptedRevision === ""
      ? offerObj?.revision ?? null
      : normalizeSafeInt(acceptedRevision, "acceptedRevision", { min: 1 });

  const normalizedAcceptanceId =
    normalizeOptionalString(acceptanceId) ??
    `acc_${normalizeOptionalString(agreementId) ?? `${rfqId}_${bidId}`}`;

  const body = normalizeForCanonicalJson(
    {
      schemaVersion: MARKETPLACE_ACCEPTANCE_SCHEMA_VERSION,
      acceptanceId: normalizedAcceptanceId,
      tenantId: String(tenantId),
      rfqId: String(rfqId),
      runId: String(runId),
      bidId: String(bidId),
      agreementId: normalizeOptionalString(agreementId),
      acceptedAt: acceptedAt ?? null,
      acceptedByAgentId: normalizeOptionalString(acceptedByAgentId),
      acceptedProposalId: normalizeOptionalString(acceptedProposalId ?? offerObj?.proposalId ?? null),
      acceptedRevision: normalizedAcceptedRevision,
      acceptedProposalHash: normalizedAcceptedProposalHash,
      offerChainHash: normalizedOfferChainHash,
      proposalCount: normalizedProposalCount,
      offerRef: normalizeForCanonicalJson(
        {
          offerId,
          offerHash
        },
        { path: "$" }
      ),
      createdAt
    },
    { path: "$" }
  );

  return normalizeForCanonicalJson(
    {
      ...body,
      acceptanceHash: sha256Hex(canonicalJsonStringify(body))
    },
    { path: "$" }
  );
}

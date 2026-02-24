import { normalizeForCanonicalJson } from "./canonical-json.js";

export const AGENT_CARD_SCHEMA_VERSION = "AgentCard.v1";
export const AGENT_CARD_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REVOKED: "revoked"
});
export const AGENT_CARD_VISIBILITY = Object.freeze({
  PUBLIC: "public",
  TENANT: "tenant",
  PRIVATE: "private"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function normalizeIsoDateTime(value, name) {
  assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(String(value)))) throw new TypeError(`${name} must be an ISO date-time string`);
  return String(value).trim();
}

function normalizeAgentStatus(value, name) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized !== AGENT_CARD_STATUS.ACTIVE &&
    normalized !== AGENT_CARD_STATUS.SUSPENDED &&
    normalized !== AGENT_CARD_STATUS.REVOKED
  ) {
    throw new TypeError(`${name} must be active|suspended|revoked`);
  }
  return normalized;
}

function normalizeAgentVisibility(value, name) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized !== AGENT_CARD_VISIBILITY.PUBLIC &&
    normalized !== AGENT_CARD_VISIBILITY.TENANT &&
    normalized !== AGENT_CARD_VISIBILITY.PRIVATE
  ) {
    throw new TypeError(`${name} must be public|tenant|private`);
  }
  return normalized;
}

function normalizeOptionalUrl(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") return null;
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${name} must use http or https`);
  }
  return parsed.toString();
}

function normalizeOptionalString(value, name, { max = 1024 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeStringArray(value, name, { max = 128 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const deduped = [
    ...new Set(
      value
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean)
        .map((entry) => {
          if (entry.length > max) throw new TypeError(`${name} entries must be <= ${max} characters`);
          return entry;
        })
    )
  ];
  deduped.sort((left, right) => left.localeCompare(right));
  return deduped;
}

function normalizeBaseUrl(value) {
  assertNonEmptyString(value, "baseUrl");
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new TypeError("baseUrl must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("baseUrl must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function buildSettldAgentCard({
  baseUrl,
  version = null,
  protocols = ["SettlementKernel.v1"],
  bundleTypes = ["InvoiceBundle.v1", "ClosePack.v1", "JobProofBundle.v1", "MonthProofBundle.v1", "FinancePackBundle.v1"],
  paymentRails = ["internal_escrow", "circle_usdc"],
  disputeSupport = true,
  reputationQueries = true
} = {}) {
  const url = normalizeBaseUrl(baseUrl);
  const resolvedVersion = version === null || version === undefined || String(version).trim() === "" ? null : String(version).trim();
  const resolvedProtocols = Array.isArray(protocols) ? protocols.map((p) => String(p)).filter(Boolean) : [];
  const resolvedBundles = Array.isArray(bundleTypes) ? bundleTypes.map((b) => String(b)).filter(Boolean) : [];
  const resolvedRails = Array.isArray(paymentRails) ? paymentRails.map((r) => String(r)).filter(Boolean) : [];

  const card = {
    name: "settld-settlement-agent",
    description: "Settlement kernel for autonomous economic agreements (agreement -> evidence -> decision -> receipt -> dispute).",
    url,
    version: resolvedVersion,
    capabilities: {
      settlement: {
        protocols: resolvedProtocols,
        bundleTypes: resolvedBundles,
        paymentRails: resolvedRails,
        disputeSupport: disputeSupport === true,
        reputationQueries: reputationQueries === true
      }
    },
    skills: [
      { id: "create_agreement", description: "Create an agreement/run for a payable capability call." },
      { id: "submit_evidence", description: "Append evidence to a run event chain." },
      { id: "settle_run", description: "Mark a run completed/failed (triggers settlement evaluation)." },
      { id: "resolve_settlement", description: "Manually resolve a settlement (released/refunded)." },
      { id: "open_dispute", description: "Open a dispute within the dispute window." },
      { id: "query_reputation", description: "Query append-only reputation facts for a counterparty." }
    ],
    authentication: {
      schemes: [
        { type: "api_key", in: "header", name: "x-api-key" },
        { type: "ops_token", in: "header", name: "x-proxy-ops-token" }
      ]
    }
  };

  // Omit null version for cleaner discovery payloads.
  if (card.version === null) delete card.version;
  return normalizeForCanonicalJson(card, { path: "$" });
}

export function buildAgentCardV1({
  tenantId,
  agentIdentity,
  cardInput = {},
  previousCard = null,
  nowAt = new Date().toISOString()
} = {}) {
  assertNonEmptyString(tenantId, "tenantId");
  assertPlainObject(agentIdentity, "agentIdentity");
  if (cardInput !== null && cardInput !== undefined) assertPlainObject(cardInput, "cardInput");
  if (previousCard !== null && previousCard !== undefined) assertPlainObject(previousCard, "previousCard");

  const resolvedNowAt = normalizeIsoDateTime(nowAt, "nowAt");
  const resolvedAgentId = normalizeOptionalString(agentIdentity.agentId, "agentIdentity.agentId", { max: 200 });
  if (!resolvedAgentId) throw new TypeError("agentIdentity.agentId is required");
  const resolvedStatus = normalizeAgentStatus(agentIdentity.status ?? AGENT_CARD_STATUS.ACTIVE, "agentIdentity.status");
  const identityCapabilities = normalizeStringArray(agentIdentity.capabilities ?? [], "agentIdentity.capabilities", { max: 256 });
  const requestedCapabilities =
    cardInput?.capabilities !== undefined
      ? normalizeStringArray(cardInput.capabilities, "cardInput.capabilities", { max: 256 })
      : previousCard?.capabilities !== undefined
        ? normalizeStringArray(previousCard.capabilities, "previousCard.capabilities", { max: 256 })
        : identityCapabilities;
  if (requestedCapabilities.some((capability) => !identityCapabilities.includes(capability))) {
    throw new TypeError("cardInput.capabilities must be a subset of agent identity capabilities");
  }

  const visibility = normalizeAgentVisibility(
    cardInput?.visibility ?? previousCard?.visibility ?? AGENT_CARD_VISIBILITY.PUBLIC,
    "visibility"
  );
  const displayName =
    normalizeOptionalString(cardInput?.displayName, "cardInput.displayName", { max: 200 }) ??
    normalizeOptionalString(previousCard?.displayName, "previousCard.displayName", { max: 200 }) ??
    normalizeOptionalString(agentIdentity.displayName, "agentIdentity.displayName", { max: 200 });
  if (!displayName) throw new TypeError("displayName is required");
  const description =
    normalizeOptionalString(cardInput?.description, "cardInput.description", { max: 2000 }) ??
    normalizeOptionalString(previousCard?.description, "previousCard.description", { max: 2000 });
  const tags =
    cardInput?.tags !== undefined
      ? normalizeStringArray(cardInput.tags, "cardInput.tags", { max: 64 })
      : previousCard?.tags !== undefined
        ? normalizeStringArray(previousCard.tags, "previousCard.tags", { max: 64 })
        : [];
  const metadata =
    cardInput?.metadata !== undefined
      ? cardInput.metadata
      : previousCard?.metadata !== undefined
        ? previousCard.metadata
        : null;
  if (metadata !== null && metadata !== undefined && (typeof metadata !== "object" || Array.isArray(metadata))) {
    throw new TypeError("metadata must be an object or null");
  }
  const sourceHost =
    cardInput?.host && typeof cardInput.host === "object" && !Array.isArray(cardInput.host)
      ? cardInput.host
      : previousCard?.host && typeof previousCard.host === "object" && !Array.isArray(previousCard.host)
        ? previousCard.host
        : null;
  const host =
    sourceHost === null
      ? null
      : normalizeForCanonicalJson(
          {
            runtime: normalizeOptionalString(sourceHost.runtime, "host.runtime", { max: 64 }),
            endpoint: normalizeOptionalUrl(sourceHost.endpoint, "host.endpoint"),
            protocols: normalizeStringArray(sourceHost.protocols ?? [], "host.protocols", { max: 64 })
          },
          { path: "$.host" }
        );

  const sourcePriceHint =
    cardInput?.priceHint && typeof cardInput.priceHint === "object" && !Array.isArray(cardInput.priceHint)
      ? cardInput.priceHint
      : previousCard?.priceHint && typeof previousCard.priceHint === "object" && !Array.isArray(previousCard.priceHint)
        ? previousCard.priceHint
        : null;
  let priceHint = null;
  if (sourcePriceHint) {
    const amountCents = Number(sourcePriceHint.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new TypeError("priceHint.amountCents must be a non-negative integer");
    const currency = normalizeOptionalString(sourcePriceHint.currency, "priceHint.currency", { max: 8 }) ?? "USD";
    const unit = normalizeOptionalString(sourcePriceHint.unit, "priceHint.unit", { max: 64 }) ?? "task";
    priceHint = normalizeForCanonicalJson(
      {
        amountCents,
        currency: currency.toUpperCase(),
        unit
      },
      { path: "$.priceHint" }
    );
  }

  const sourceAttestations =
    cardInput?.attestations !== undefined ? cardInput.attestations : previousCard?.attestations !== undefined ? previousCard.attestations : [];
  const attestations = Array.isArray(sourceAttestations)
    ? sourceAttestations.map((row, index) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          throw new TypeError(`attestations[${index}] must be an object`);
        }
        const type = normalizeOptionalString(row.type, `attestations[${index}].type`, { max: 128 });
        if (!type) throw new TypeError(`attestations[${index}].type is required`);
        const level = normalizeOptionalString(row.level, `attestations[${index}].level`, { max: 64 }) ?? "self_claim";
        const issuedAt = normalizeOptionalString(row.issuedAt, `attestations[${index}].issuedAt`, { max: 128 });
        const expiresAt = normalizeOptionalString(row.expiresAt, `attestations[${index}].expiresAt`, { max: 128 });
        if (issuedAt) normalizeIsoDateTime(issuedAt, `attestations[${index}].issuedAt`);
        if (expiresAt) normalizeIsoDateTime(expiresAt, `attestations[${index}].expiresAt`);
        return normalizeForCanonicalJson(
          {
            type,
            level,
            issuer: normalizeOptionalString(row.issuer, `attestations[${index}].issuer`, { max: 200 }),
            credentialRef: normalizeOptionalString(row.credentialRef, `attestations[${index}].credentialRef`, { max: 200 }),
            proofHash: normalizeOptionalString(row.proofHash, `attestations[${index}].proofHash`, { max: 200 }),
            issuedAt: issuedAt ?? null,
            expiresAt: expiresAt ?? null
          },
          { path: `$.attestations[${index}]` }
        );
      })
    : (() => {
        throw new TypeError("attestations must be an array");
      })();

  const createdAt =
    normalizeOptionalString(previousCard?.createdAt, "previousCard.createdAt", { max: 128 }) ?? resolvedNowAt;
  normalizeIsoDateTime(createdAt, "createdAt");
  const previousRevision = Number(previousCard?.revision);
  const revision = Number.isSafeInteger(previousRevision) && previousRevision >= 0 ? previousRevision + 1 : 0;

  const card = normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_CARD_SCHEMA_VERSION,
      agentId: resolvedAgentId,
      tenantId: String(tenantId).trim(),
      displayName,
      description,
      status: resolvedStatus,
      visibility,
      capabilities: requestedCapabilities,
      host,
      priceHint,
      attestations,
      tags,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null,
      identityRef: {
        schemaVersion:
          typeof agentIdentity.schemaVersion === "string" && agentIdentity.schemaVersion.trim() !== ""
            ? agentIdentity.schemaVersion.trim()
            : "AgentIdentity.v1",
        keyId: normalizeOptionalString(agentIdentity?.keys?.keyId, "agentIdentity.keys.keyId", { max: 200 })
      },
      createdAt,
      updatedAt: resolvedNowAt,
      revision
    },
    { path: "$" }
  );
  validateAgentCardV1(card);
  return card;
}

export function validateAgentCardV1(agentCard) {
  assertPlainObject(agentCard, "agentCard");
  if (agentCard.schemaVersion !== AGENT_CARD_SCHEMA_VERSION) {
    throw new TypeError(`agentCard.schemaVersion must be ${AGENT_CARD_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(agentCard.agentId, "agentCard.agentId");
  assertNonEmptyString(agentCard.tenantId, "agentCard.tenantId");
  assertNonEmptyString(agentCard.displayName, "agentCard.displayName");
  normalizeAgentStatus(agentCard.status, "agentCard.status");
  normalizeAgentVisibility(agentCard.visibility, "agentCard.visibility");
  normalizeIsoDateTime(agentCard.createdAt, "agentCard.createdAt");
  normalizeIsoDateTime(agentCard.updatedAt, "agentCard.updatedAt");
  if (!Array.isArray(agentCard.capabilities)) throw new TypeError("agentCard.capabilities must be an array");
  for (let index = 0; index < agentCard.capabilities.length; index += 1) {
    assertNonEmptyString(agentCard.capabilities[index], `agentCard.capabilities[${index}]`);
  }
  const revision = Number(agentCard.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError("agentCard.revision must be a non-negative integer");
  if (agentCard.host !== null && agentCard.host !== undefined) {
    assertPlainObject(agentCard.host, "agentCard.host");
    if (agentCard.host.endpoint !== null && agentCard.host.endpoint !== undefined) {
      normalizeOptionalUrl(agentCard.host.endpoint, "agentCard.host.endpoint");
    }
    if (agentCard.host.protocols !== null && agentCard.host.protocols !== undefined && !Array.isArray(agentCard.host.protocols)) {
      throw new TypeError("agentCard.host.protocols must be an array when provided");
    }
  }
  if (agentCard.priceHint !== null && agentCard.priceHint !== undefined) {
    assertPlainObject(agentCard.priceHint, "agentCard.priceHint");
    const amountCents = Number(agentCard.priceHint.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new TypeError("agentCard.priceHint.amountCents must be a non-negative integer");
    }
  }
  return true;
}

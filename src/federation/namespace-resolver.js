import { canonicalJsonStringify, normalizeForCanonicalJson } from "../core/canonical-json.js";
import { sha256Hex } from "../core/crypto.js";
import { FEDERATION_ERROR_CODE } from "./error-codes.js";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeDid(value, { fieldName = "did", allowNull = false } = {}) {
  const did = normalizeOptionalString(value);
  if (!did) {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:-]{1,256}$/.test(did)) {
    throw new TypeError(`${fieldName} must be a DID`);
  }
  return did;
}

function normalizeAbsoluteUrl(value, { fieldName = "url", allowNull = false } = {}) {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} must be an absolute URL`);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${fieldName} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${fieldName} must use http or https`);
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeIsoTimestamp(value, { fieldName, allowNull = true } = {}) {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) {
    throw new TypeError(`${fieldName} must be an ISO-8601 timestamp`);
  }
  return new Date(ts).toISOString();
}

function normalizePriority(value) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new TypeError("priority must be an integer");
  return n;
}

function normalizeTtlSeconds(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError("ttlSeconds must be a positive integer");
  return n;
}

function sortRecordsDeterministically(records) {
  return [...records].sort((a, b) => {
    if (a.namespaceDid !== b.namespaceDid) return a.namespaceDid.localeCompare(b.namespaceDid);
    if (a.priority !== b.priority) return b.priority - a.priority;
    const aObservedAt = a.observedAt ?? "";
    const bObservedAt = b.observedAt ?? "";
    if (aObservedAt !== bObservedAt) return bObservedAt.localeCompare(aObservedAt);
    if (a.recordHash !== b.recordHash) return a.recordHash.localeCompare(b.recordHash);
    return 0;
  });
}

function normalizeRegistryRecord(rawRecord, index) {
  if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
    throw new TypeError(`PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}] must be an object`);
  }
  const namespaceDid = normalizeDid(rawRecord.namespaceDid ?? rawRecord.namespace, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].namespaceDid`
  });
  const ownerDid = normalizeDid(rawRecord.ownerDid ?? namespaceDid, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].ownerDid`
  });
  const delegateDid = normalizeDid(rawRecord.delegateDid, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].delegateDid`,
    allowNull: true
  });
  const transferToDid = normalizeDid(rawRecord.transferToDid, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].transferToDid`,
    allowNull: true
  });
  const transferEffectiveAt = normalizeIsoTimestamp(rawRecord.transferEffectiveAt, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].transferEffectiveAt`,
    allowNull: true
  });
  const routeBaseUrl = normalizeAbsoluteUrl(rawRecord.routeBaseUrl ?? rawRecord.upstreamBaseUrl ?? rawRecord.baseUrl, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].routeBaseUrl`
  });
  const validFrom = normalizeIsoTimestamp(rawRecord.validFrom, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].validFrom`,
    allowNull: true
  });
  const validUntil = normalizeIsoTimestamp(rawRecord.validUntil, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].validUntil`,
    allowNull: true
  });
  const observedAt = normalizeIsoTimestamp(rawRecord.observedAt ?? rawRecord.updatedAt ?? rawRecord.createdAt, {
    fieldName: `PROXY_FEDERATION_NAMESPACE_REGISTRY[${index}].observedAt`,
    allowNull: true
  });
  const priority = normalizePriority(rawRecord.priority);
  const ttlSeconds = normalizeTtlSeconds(rawRecord.ttlSeconds);
  const recordId =
    normalizeOptionalString(rawRecord.recordId) ??
    normalizeOptionalString(rawRecord.namespaceRecordId) ??
    `${namespaceDid}#${index + 1}`;
  const source = normalizeOptionalString(rawRecord.source) ?? "registry";

  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: "FederationNamespaceRouteRecord.v1",
      recordId,
      source,
      namespaceDid,
      ownerDid,
      delegateDid,
      transferToDid,
      transferEffectiveAt,
      routeBaseUrl,
      validFrom,
      validUntil,
      observedAt,
      ttlSeconds,
      priority
    },
    { path: "$.namespaceRouteRecord" }
  );
  const recordHash = sha256Hex(canonicalJsonStringify(normalized));
  return {
    ...normalized,
    recordHash
  };
}

function parseRegistryRaw(raw) {
  const value = normalizeOptionalString(raw);
  if (!value) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new TypeError(`PROXY_FEDERATION_NAMESPACE_REGISTRY must be valid JSON: ${err?.message ?? String(err ?? "")}`);
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError("PROXY_FEDERATION_NAMESPACE_REGISTRY must be a JSON array");
  }
  const out = [];
  for (let i = 0; i < parsed.length; i += 1) {
    out.push(normalizeRegistryRecord(parsed[i], i));
  }
  return out;
}

function buildLegacyRouteRecords(namespaceRoutes) {
  const entries = namespaceRoutes instanceof Map ? [...namespaceRoutes.entries()] : [];
  const out = [];
  for (const [namespaceDid, routeBaseUrl] of entries) {
    const normalized = normalizeForCanonicalJson(
      {
        schemaVersion: "FederationNamespaceRouteRecord.v1",
        recordId: `${namespaceDid}#legacy`,
        source: "legacy_route_map",
        namespaceDid,
        ownerDid: namespaceDid,
        delegateDid: null,
        transferToDid: null,
        transferEffectiveAt: null,
        routeBaseUrl,
        validFrom: null,
        validUntil: null,
        observedAt: null,
        ttlSeconds: null,
        priority: 0
      },
      { path: "$.namespaceRouteRecord" }
    );
    out.push({
      ...normalized,
      recordHash: sha256Hex(canonicalJsonStringify(normalized))
    });
  }
  return out;
}

function buildDecisionLineage({ namespaceDid, asOf, candidates, selectedRecord, reasonCode, resolutionKind, resolvedCoordinatorDid, upstreamBaseUrl }) {
  const candidateRows = [...candidates]
    .map((row) =>
      normalizeForCanonicalJson(
        {
          recordId: row.recordId,
          source: row.source,
          recordHash: row.recordHash,
          ownerDid: row.ownerDid,
          delegateDid: row.delegateDid,
          transferToDid: row.transferToDid,
          transferEffectiveAt: row.transferEffectiveAt,
          routeBaseUrl: row.routeBaseUrl,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
          observedAt: row.observedAt,
          ttlSeconds: row.ttlSeconds,
          priority: row.priority
        },
        { path: "$.candidate" }
      )
    )
    .sort((a, b) => String(a.recordHash).localeCompare(String(b.recordHash)));

  const lineageCore = normalizeForCanonicalJson(
    {
      schemaVersion: "FederationNamespaceRouteDecision.v1",
      namespaceDid,
      asOf,
      resolverVersion: "1.0",
      reasonCode,
      resolutionKind,
      resolvedCoordinatorDid: resolvedCoordinatorDid ?? null,
      upstreamBaseUrl: upstreamBaseUrl ?? null,
      selectedRecordId: selectedRecord?.recordId ?? null,
      selectedRecordHash: selectedRecord?.recordHash ?? null,
      candidateCount: candidateRows.length,
      candidates: candidateRows
    },
    { path: "$.namespaceDecision" }
  );
  const decisionId = sha256Hex(canonicalJsonStringify(lineageCore));
  return normalizeForCanonicalJson(
    {
      ...lineageCore,
      decisionId
    },
    { path: "$.namespaceDecision" }
  );
}

function classifyRecordState(record, asOfMs) {
  const validFromMs = record.validFrom ? Date.parse(record.validFrom) : null;
  const validUntilMs = record.validUntil ? Date.parse(record.validUntil) : null;
  if (validFromMs !== null && validUntilMs !== null && validFromMs > validUntilMs) {
    return "invalid_window";
  }
  if (validFromMs !== null && asOfMs < validFromMs) return "not_yet_valid";
  if (validUntilMs !== null && asOfMs > validUntilMs) return "expired";
  if (record.ttlSeconds !== null) {
    if (!record.observedAt) return "stale";
    const observedAtMs = Date.parse(record.observedAt);
    if (!Number.isFinite(observedAtMs)) return "stale";
    const ttlCutoffMs = observedAtMs + record.ttlSeconds * 1000;
    if (asOfMs > ttlCutoffMs) return "stale";
  }
  return "active";
}

function resolveRecordTarget(record, asOfMs) {
  if (record.transferToDid && record.transferEffectiveAt) {
    const transferMs = Date.parse(record.transferEffectiveAt);
    if (Number.isFinite(transferMs) && asOfMs >= transferMs) {
      return {
        resolvedCoordinatorDid: record.transferToDid,
        resolutionKind: "transfer_effective"
      };
    }
  }
  if (record.delegateDid) {
    return {
      resolvedCoordinatorDid: record.delegateDid,
      resolutionKind: "delegation"
    };
  }
  return {
    resolvedCoordinatorDid: record.ownerDid,
    resolutionKind: "owner"
  };
}

function fail(statusCode, code, message, details, lineage = null) {
  return {
    ok: false,
    statusCode,
    code,
    message,
    details: details ?? null,
    lineage: lineage ?? null
  };
}

export function buildFederationNamespacePolicy({ namespaceRoutes = new Map(), registryRaw = null, asOf = null } = {}) {
  const explicitRegistryRecords = parseRegistryRaw(registryRaw);
  const legacyRouteRecords = buildLegacyRouteRecords(namespaceRoutes);
  const records = sortRecordsDeterministically([...legacyRouteRecords, ...explicitRegistryRecords]);
  const normalizedAsOf = normalizeIsoTimestamp(asOf, { fieldName: "asOf", allowNull: true }) ?? new Date().toISOString();
  return {
    records,
    hasExplicitRegistry: explicitRegistryRecords.length > 0,
    asOf: normalizedAsOf
  };
}

export function resolveFederationNamespaceRoute({ namespaceDid, policy, asOf = new Date().toISOString() }) {
  let asOfIso;
  try {
    asOfIso = normalizeIsoTimestamp(asOf, { fieldName: "asOf", allowNull: true });
  } catch {
    asOfIso = null;
  }
  if (!asOfIso) asOfIso = normalizeIsoTimestamp(policy?.asOf, { fieldName: "policy.asOf", allowNull: true }) ?? new Date().toISOString();
  const asOfMs = Date.parse(asOfIso);
  const records = Array.isArray(policy?.records) ? policy.records : [];
  const candidates = records.filter((row) => row.namespaceDid === namespaceDid);

  if (candidates.length === 0) {
    return fail(
      503,
      FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_MISSING,
      "no namespace route configured for federation target DID",
      { namespaceDid },
      buildDecisionLineage({
        namespaceDid,
        asOf: asOfIso,
        candidates: [],
        selectedRecord: null,
        reasonCode: FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_MISSING,
        resolutionKind: null,
        resolvedCoordinatorDid: null,
        upstreamBaseUrl: null
      })
    );
  }

  const states = candidates.map((record) => ({
    record,
    state: classifyRecordState(record, asOfMs)
  }));
  const active = states.filter((row) => row.state === "active").map((row) => row.record);
  if (active.length === 0) {
    const staleOnly = states.every((row) => row.state === "stale");
    const code = staleOnly ? FEDERATION_ERROR_CODE.NAMESPACE_RECORD_STALE : FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_CONFLICT;
    const message = staleOnly
      ? "namespace route records are stale"
      : "namespace route records are invalid or expired";
    return fail(
      staleOnly ? 409 : 409,
      code,
      message,
      {
        namespaceDid,
        states: states.map((row) => ({ recordId: row.record.recordId, state: row.state }))
      },
      buildDecisionLineage({
        namespaceDid,
        asOf: asOfIso,
        candidates,
        selectedRecord: null,
        reasonCode: code,
        resolutionKind: null,
        resolvedCoordinatorDid: null,
        upstreamBaseUrl: null
      })
    );
  }

  const highestPriority = Math.max(...active.map((row) => row.priority));
  const top = active.filter((row) => row.priority === highestPriority);
  const mapped = top.map((record) => {
    const resolved = resolveRecordTarget(record, asOfMs);
    return {
      record,
      ...resolved,
      key: `${resolved.resolvedCoordinatorDid}|${record.routeBaseUrl}|${resolved.resolutionKind}`
    };
  });
  const uniqueKeys = [...new Set(mapped.map((row) => row.key))];
  if (uniqueKeys.length !== 1) {
    return fail(
      409,
      FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_AMBIGUOUS,
      "namespace route resolution is ambiguous",
      {
        namespaceDid,
        conflictingRecordIds: mapped.map((row) => row.record.recordId).sort((a, b) => a.localeCompare(b))
      },
      buildDecisionLineage({
        namespaceDid,
        asOf: asOfIso,
        candidates,
        selectedRecord: null,
        reasonCode: FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_AMBIGUOUS,
        resolutionKind: null,
        resolvedCoordinatorDid: null,
        upstreamBaseUrl: null
      })
    );
  }

  const selected = [...mapped].sort((a, b) => a.record.recordHash.localeCompare(b.record.recordHash))[0];
  const lineage = buildDecisionLineage({
    namespaceDid,
    asOf: asOfIso,
    candidates,
    selectedRecord: selected.record,
    reasonCode: "FEDERATION_NAMESPACE_ROUTE_RESOLVED",
    resolutionKind: selected.resolutionKind,
    resolvedCoordinatorDid: selected.resolvedCoordinatorDid,
    upstreamBaseUrl: selected.record.routeBaseUrl
  });
  return {
    ok: true,
    namespaceDid,
    resolvedCoordinatorDid: selected.resolvedCoordinatorDid,
    upstreamBaseUrl: selected.record.routeBaseUrl,
    resolutionKind: selected.resolutionKind,
    selectedRecord: selected.record,
    lineage
  };
}

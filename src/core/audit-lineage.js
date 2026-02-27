import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const AUDIT_LINEAGE_SCHEMA_VERSION = "AuditLineage.v1";
export const AUDIT_LINEAGE_VERIFICATION_CODE = Object.freeze({
  OK: null,
  SCHEMA_INVALID: "AUDIT_LINEAGE_SCHEMA_INVALID",
  SUMMARY_INVALID: "AUDIT_LINEAGE_SUMMARY_INVALID",
  RECORD_ORDER_INVALID: "AUDIT_LINEAGE_RECORD_ORDER_INVALID",
  HASH_INVALID: "AUDIT_LINEAGE_HASH_INVALID",
  HASH_MISMATCH: "AUDIT_LINEAGE_HASH_MISMATCH"
});

function normalizeOptionalString(value, name, { max = 256 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  return normalized;
}

function normalizeIsoDateTimeOrNull(value, name) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return new Date(normalized).toISOString();
}

function normalizeStringArray(value, name, { max = 256 } = {}) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const normalized = normalizeOptionalString(value[i], `${name}[${i}]`, { max });
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function parseRecordAtMs(record) {
  const atMs = Number(Date.parse(String(record?.at ?? "")));
  return Number.isFinite(atMs) ? atMs : -1;
}

function compareLineageRecords(left, right) {
  const leftAt = parseRecordAtMs(left);
  const rightAt = parseRecordAtMs(right);
  if (leftAt !== rightAt) return rightAt - leftAt;
  const kindOrder = String(left?.kind ?? "").localeCompare(String(right?.kind ?? ""));
  if (kindOrder !== 0) return kindOrder;
  return String(left?.recordId ?? "").localeCompare(String(right?.recordId ?? ""));
}

function normalizeLineageRecord(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`records[${index}] must be an object`);
  }
  const kind = normalizeOptionalString(input.kind, `records[${index}].kind`, { max: 80 });
  if (!kind) throw new TypeError(`records[${index}].kind is required`);
  const recordId = normalizeOptionalString(input.recordId, `records[${index}].recordId`, { max: 200 });
  if (!recordId) throw new TypeError(`records[${index}].recordId is required`);
  const at = normalizeIsoDateTimeOrNull(input.at, `records[${index}].at`);
  const status = normalizeOptionalString(input.status, `records[${index}].status`, { max: 80 });
  const traceIds = normalizeStringArray(input.traceIds ?? [], `records[${index}].traceIds`, { max: 256 });
  const agentIds = normalizeStringArray(input.agentIds ?? [], `records[${index}].agentIds`, { max: 256 });
  const refs =
    input.refs && typeof input.refs === "object" && !Array.isArray(input.refs)
      ? normalizeForCanonicalJson(input.refs, { path: `$.records[${index}].refs` })
      : null;
  return normalizeForCanonicalJson(
    {
      kind,
      recordId,
      at,
      status,
      traceIds,
      agentIds,
      refs
    },
    { path: `$.records[${index}]` }
  );
}

function normalizeFilters(filters = null) {
  const source = filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {};
  return normalizeForCanonicalJson(
    {
      agentId: normalizeOptionalString(source.agentId ?? null, "filters.agentId", { max: 256 }),
      sessionId: normalizeOptionalString(source.sessionId ?? null, "filters.sessionId", { max: 256 }),
      runId: normalizeOptionalString(source.runId ?? null, "filters.runId", { max: 256 }),
      workOrderId: normalizeOptionalString(source.workOrderId ?? null, "filters.workOrderId", { max: 256 }),
      traceId: normalizeOptionalString(source.traceId ?? null, "filters.traceId", { max: 256 }),
      includeSessionEvents: source.includeSessionEvents === true
    },
    { path: "$.filters" }
  );
}

function normalizeSummary(summary, { recordCount } = {}) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new TypeError("summary must be an object");
  }
  const totalRecords = Number(summary.totalRecords);
  const returnedRecords = Number(summary.returnedRecords);
  const limit = Number(summary.limit);
  const offset = Number(summary.offset);
  if (!Number.isSafeInteger(totalRecords) || totalRecords < 0) {
    throw new TypeError("summary.totalRecords must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(returnedRecords) || returnedRecords < 0) {
    throw new TypeError("summary.returnedRecords must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("summary.limit must be a positive safe integer");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError("summary.offset must be a non-negative safe integer");
  }
  if (returnedRecords !== recordCount) {
    throw new TypeError("summary.returnedRecords must equal records.length");
  }
  if (totalRecords < returnedRecords) {
    throw new TypeError("summary.totalRecords must be >= summary.returnedRecords");
  }
  const hasMore = summary.hasMore === true;
  const reached = offset + returnedRecords;
  if (hasMore && totalRecords <= reached) {
    throw new TypeError("summary.hasMore true requires totalRecords > offset + returnedRecords");
  }
  if (!hasMore && totalRecords > reached) {
    throw new TypeError("summary.hasMore false requires totalRecords <= offset + returnedRecords");
  }
  const kindCountsInput =
    summary.kindCounts && typeof summary.kindCounts === "object" && !Array.isArray(summary.kindCounts) ? summary.kindCounts : {};
  const kindCounts = {};
  let kindCountTotal = 0;
  for (const [kind, countRaw] of Object.entries(kindCountsInput)) {
    const normalizedKind = normalizeOptionalString(kind, "summary.kindCounts key", { max: 80 });
    if (!normalizedKind) continue;
    const count = Number(countRaw);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError(`summary.kindCounts.${normalizedKind} must be a non-negative safe integer`);
    }
    kindCounts[normalizedKind] = count;
    kindCountTotal += count;
  }
  if (kindCountTotal !== totalRecords) {
    throw new TypeError("summary.kindCounts totals must equal summary.totalRecords");
  }
  return normalizeForCanonicalJson(
    {
      totalRecords,
      returnedRecords,
      limit,
      offset,
      hasMore,
      kindCounts: Object.fromEntries(Object.entries(kindCounts).sort((left, right) => left[0].localeCompare(right[0])))
    },
    { path: "$.summary" }
  );
}

function isDeterministicallySorted(records = []) {
  for (let i = 1; i < records.length; i += 1) {
    if (compareLineageRecords(records[i - 1], records[i]) > 0) return false;
  }
  return true;
}

export function buildAuditLineageV1({
  tenantId,
  filters = null,
  records = [],
  limit = 200,
  offset = 0
} = {}) {
  const normalizedTenantId = normalizeOptionalString(tenantId, "tenantId", { max: 128 });
  if (!normalizedTenantId) throw new TypeError("tenantId is required");
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");

  const normalizedRecords = records.map((row, index) => normalizeLineageRecord(row, index));
  normalizedRecords.sort(compareLineageRecords);

  const kindCounts = {};
  for (const row of normalizedRecords) {
    const key = String(row.kind ?? "");
    kindCounts[key] = (kindCounts[key] ?? 0) + 1;
  }
  const kindCountsSorted = Object.fromEntries(
    Object.entries(kindCounts).sort((left, right) => left[0].localeCompare(right[0]))
  );

  const paged = normalizedRecords.slice(offset, offset + limit);
  const hasMore = normalizedRecords.length > offset + paged.length;
  const summary = normalizeForCanonicalJson(
    {
      totalRecords: normalizedRecords.length,
      returnedRecords: paged.length,
      limit,
      offset,
      hasMore,
      kindCounts: kindCountsSorted
    },
    { path: "$.summary" }
  );

  const lineageBase = normalizeForCanonicalJson(
    {
      schemaVersion: AUDIT_LINEAGE_SCHEMA_VERSION,
      tenantId: normalizedTenantId,
      filters: normalizeFilters(filters),
      summary,
      records: paged
    },
    { path: "$" }
  );
  const lineageHash = sha256Hex(canonicalJsonStringify(lineageBase));
  return normalizeForCanonicalJson(
    {
      ...lineageBase,
      lineageHash
    },
    { path: "$" }
  );
}

export function verifyAuditLineageV1({ lineage } = {}) {
  try {
    if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.SCHEMA_INVALID,
        error: "lineage must be an object"
      };
    }
    if (String(lineage.schemaVersion ?? "") !== AUDIT_LINEAGE_SCHEMA_VERSION) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.SCHEMA_INVALID,
        error: `schemaVersion must be ${AUDIT_LINEAGE_SCHEMA_VERSION}`
      };
    }
    const normalizedTenantId = normalizeOptionalString(lineage.tenantId, "tenantId", { max: 128 });
    if (!normalizedTenantId) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.SCHEMA_INVALID,
        error: "tenantId is required"
      };
    }

    if (!Array.isArray(lineage.records)) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.SCHEMA_INVALID,
        error: "records must be an array"
      };
    }
    const normalizedRecords = lineage.records.map((row, index) => normalizeLineageRecord(row, index));
    if (!isDeterministicallySorted(normalizedRecords)) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.RECORD_ORDER_INVALID,
        error: "records must be sorted deterministically by at desc, kind asc, recordId asc"
      };
    }

    let normalizedSummary = null;
    try {
      normalizedSummary = normalizeSummary(lineage.summary, { recordCount: normalizedRecords.length });
    } catch (err) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.SUMMARY_INVALID,
        error: err?.message ?? "invalid summary"
      };
    }

    const lineageHash = normalizeOptionalString(lineage.lineageHash, "lineageHash", { max: 64 });
    if (!lineageHash || !/^[0-9a-f]{64}$/i.test(lineageHash)) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.HASH_INVALID,
        error: "lineageHash must be sha256 hex"
      };
    }
    const normalizedLineageHash = lineageHash.toLowerCase();
    const expectedLineageBase = normalizeForCanonicalJson(
      {
        schemaVersion: AUDIT_LINEAGE_SCHEMA_VERSION,
        tenantId: normalizedTenantId,
        filters: normalizeFilters(lineage.filters),
        summary: normalizedSummary,
        records: normalizedRecords
      },
      { path: "$" }
    );
    const expectedLineageHash = sha256Hex(canonicalJsonStringify(expectedLineageBase));
    if (normalizedLineageHash !== expectedLineageHash) {
      return {
        ok: false,
        code: AUDIT_LINEAGE_VERIFICATION_CODE.HASH_MISMATCH,
        error: "lineageHash mismatch",
        expectedLineageHash,
        actualLineageHash: normalizedLineageHash
      };
    }
    return {
      ok: true,
      code: AUDIT_LINEAGE_VERIFICATION_CODE.OK,
      error: null,
      lineageHash: normalizedLineageHash,
      recordCount: normalizedRecords.length
    };
  } catch (err) {
    return {
      ok: false,
      code: AUDIT_LINEAGE_VERIFICATION_CODE.SCHEMA_INVALID,
      error: err?.message ?? String(err ?? "")
    };
  }
}

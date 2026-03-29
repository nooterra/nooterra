/**
 * Governance repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: approval requests, approval decisions, approval standing policies,
 *          approval continuations, governance templates.
 */

import { DEFAULT_TENANT_ID, makeScopedKey, normalizeTenantId } from "../../core/tenancy.js";

// ---------------------------------------------------------------------------
// Shared helpers (pure, no DB)
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

// ---------------------------------------------------------------------------
// Row-to-record mappers
// ---------------------------------------------------------------------------

function approvalRequestSnapshotRowToRecord(row) {
  const approvalRequest = row?.snapshot_json ?? null;
  if (!approvalRequest || typeof approvalRequest !== "object" || Array.isArray(approvalRequest)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? approvalRequest?.tenantId ?? DEFAULT_TENANT_ID);
  const requestId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof approvalRequest?.requestId === "string" && approvalRequest.requestId.trim() !== ""
        ? approvalRequest.requestId.trim()
        : null;
  if (!requestId) return null;
  return {
    ...approvalRequest,
    tenantId,
    requestId
  };
}

function approvalDecisionSnapshotRowToRecord(row) {
  const approvalDecision = row?.snapshot_json ?? null;
  if (!approvalDecision || typeof approvalDecision !== "object" || Array.isArray(approvalDecision)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? approvalDecision?.tenantId ?? DEFAULT_TENANT_ID);
  const decisionId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof approvalDecision?.decisionId === "string" && approvalDecision.decisionId.trim() !== ""
        ? approvalDecision.decisionId.trim()
        : null;
  if (!decisionId) return null;
  return {
    ...approvalDecision,
    tenantId,
    decisionId
  };
}

function approvalStandingPolicySnapshotRowToRecord(row) {
  const approvalStandingPolicy = row?.snapshot_json ?? null;
  if (!approvalStandingPolicy || typeof approvalStandingPolicy !== "object" || Array.isArray(approvalStandingPolicy)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? approvalStandingPolicy?.tenantId ?? DEFAULT_TENANT_ID);
  const policyId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof approvalStandingPolicy?.policyId === "string" && approvalStandingPolicy.policyId.trim() !== ""
        ? approvalStandingPolicy.policyId.trim()
        : null;
  if (!policyId) return null;
  return {
    ...approvalStandingPolicy,
    tenantId,
    policyId
  };
}

function approvalContinuationSnapshotRowToRecord(row) {
  const approvalContinuation = row?.snapshot_json ?? null;
  if (!approvalContinuation || typeof approvalContinuation !== "object" || Array.isArray(approvalContinuation)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? approvalContinuation?.tenantId ?? DEFAULT_TENANT_ID);
  const requestId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof approvalContinuation?.requestId === "string" && approvalContinuation.requestId.trim() !== ""
        ? approvalContinuation.requestId.trim()
        : null;
  if (!requestId) return null;
  return {
    ...approvalContinuation,
    tenantId,
    requestId
  };
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool
 * @param {Map} opts.approvalRequests      - in-memory fallback map
 * @param {Map} opts.approvalDecisions     - in-memory fallback map
 * @param {Map} opts.approvalStandingPolicies - in-memory fallback map
 * @param {Map} opts.approvalContinuations - in-memory fallback map
 */
export function createGovernanceRepository({ pool, approvalRequests, approvalDecisions, approvalStandingPolicies, approvalContinuations }) {

  async function getApprovalRequest({ tenantId = DEFAULT_TENANT_ID, requestId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(requestId, "requestId");
    const normalizedRequestId = String(requestId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_request' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedRequestId]
      );
      return res.rows.length ? approvalRequestSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return approvalRequests.get(makeScopedKey({ tenantId, id: normalizedRequestId })) ?? null;
    }
  }

  async function listApprovalRequests({
    tenantId = DEFAULT_TENANT_ID,
    requestId = null,
    envelopeId = null,
    envelopeHash = null,
    requestedBy = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (requestId !== null && (typeof requestId !== "string" || requestId.trim() === "")) {
      throw new TypeError("requestId must be null or a non-empty string");
    }
    if (envelopeId !== null && (typeof envelopeId !== "string" || envelopeId.trim() === "")) {
      throw new TypeError("envelopeId must be null or a non-empty string");
    }
    if (envelopeHash !== null && (typeof envelopeHash !== "string" || envelopeHash.trim() === "")) {
      throw new TypeError("envelopeHash must be null or a non-empty string");
    }
    if (requestedBy !== null && (typeof requestedBy !== "string" || requestedBy.trim() === "")) {
      throw new TypeError("requestedBy must be null or a non-empty string");
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const requestIdFilter = requestId ? String(requestId).trim() : null;
    const envelopeIdFilter = envelopeId ? String(envelopeId).trim() : null;
    const envelopeHashFilter = envelopeHash ? String(envelopeHash).trim().toLowerCase() : null;
    const requestedByFilter = requestedBy ? String(requestedBy).trim() : null;

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (requestIdFilter && String(row.requestId ?? "") !== requestIdFilter) continue;
        if (envelopeIdFilter && String(row?.envelopeRef?.envelopeId ?? "") !== envelopeIdFilter) continue;
        if (envelopeHashFilter && String(row?.envelopeRef?.envelopeHash ?? "").toLowerCase() !== envelopeHashFilter) continue;
        if (requestedByFilter && String(row.requestedBy ?? "") !== requestedByFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.requestId ?? "").localeCompare(String(right.requestId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_request'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(approvalRequestSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(approvalRequests.values()));
    }
  }

  async function getApprovalDecision({ tenantId = DEFAULT_TENANT_ID, decisionId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(decisionId, "decisionId");
    const normalizedDecisionId = String(decisionId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_decision' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedDecisionId]
      );
      return res.rows.length ? approvalDecisionSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return approvalDecisions.get(makeScopedKey({ tenantId, id: normalizedDecisionId })) ?? null;
    }
  }

  async function listApprovalDecisions({
    tenantId = DEFAULT_TENANT_ID,
    decisionId = null,
    requestId = null,
    decidedBy = null,
    approved = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (decisionId !== null && (typeof decisionId !== "string" || decisionId.trim() === "")) {
      throw new TypeError("decisionId must be null or a non-empty string");
    }
    if (requestId !== null && (typeof requestId !== "string" || requestId.trim() === "")) {
      throw new TypeError("requestId must be null or a non-empty string");
    }
    if (decidedBy !== null && (typeof decidedBy !== "string" || decidedBy.trim() === "")) {
      throw new TypeError("decidedBy must be null or a non-empty string");
    }
    if (approved !== null && approved !== undefined && typeof approved !== "boolean") {
      throw new TypeError("approved must be null or a boolean");
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const decisionIdFilter = decisionId ? String(decisionId).trim() : null;
    const requestIdFilter = requestId ? String(requestId).trim() : null;
    const decidedByFilter = decidedBy ? String(decidedBy).trim() : null;
    const approvedFilter = typeof approved === "boolean" ? approved : null;

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (decisionIdFilter && String(row.decisionId ?? "") !== decisionIdFilter) continue;
        if (requestIdFilter && String(row.requestId ?? "") !== requestIdFilter) continue;
        if (decidedByFilter && String(row.decidedBy ?? "") !== decidedByFilter) continue;
        if (approvedFilter !== null && Boolean(row.approved) !== approvedFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.decisionId ?? "").localeCompare(String(right.decisionId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_decision'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(approvalDecisionSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(approvalDecisions.values()));
    }
  }

  async function getApprovalStandingPolicy({ tenantId = DEFAULT_TENANT_ID, policyId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(policyId, "policyId");
    const normalizedPolicyId = String(policyId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_standing_policy' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedPolicyId]
      );
      return res.rows.length ? approvalStandingPolicySnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return approvalStandingPolicies.get(makeScopedKey({ tenantId, id: normalizedPolicyId })) ?? null;
    }
  }

  async function listApprovalStandingPolicies({
    tenantId = DEFAULT_TENANT_ID,
    policyId = null,
    principalId = null,
    principalType = null,
    status = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (policyId !== null && (typeof policyId !== "string" || policyId.trim() === "")) {
      throw new TypeError("policyId must be null or a non-empty string");
    }
    if (principalId !== null && (typeof principalId !== "string" || principalId.trim() === "")) {
      throw new TypeError("principalId must be null or a non-empty string");
    }
    if (principalType !== null && (typeof principalType !== "string" || principalType.trim() === "")) {
      throw new TypeError("principalType must be null or a non-empty string");
    }
    if (status !== null && (typeof status !== "string" || status.trim() === "")) {
      throw new TypeError("status must be null or a non-empty string");
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const policyIdFilter = policyId ? String(policyId).trim() : null;
    const principalIdFilter = principalId ? String(principalId).trim() : null;
    const principalTypeFilter = principalType ? String(principalType).trim().toLowerCase() : null;
    const statusFilter = status ? String(status).trim().toLowerCase() : null;

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (policyIdFilter && String(row.policyId ?? "") !== policyIdFilter) continue;
        if (principalIdFilter && String(row?.principalRef?.principalId ?? "") !== principalIdFilter) continue;
        if (principalTypeFilter && String(row?.principalRef?.principalType ?? "").toLowerCase() !== principalTypeFilter) continue;
        if (statusFilter && String(row?.status ?? "").toLowerCase() !== statusFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.policyId ?? "").localeCompare(String(right.policyId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_standing_policy'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(approvalStandingPolicySnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(approvalStandingPolicies.values()));
    }
  }

  async function getApprovalContinuation({ tenantId = DEFAULT_TENANT_ID, requestId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(requestId, "requestId");
    const normalizedRequestId = String(requestId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_continuation' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedRequestId]
      );
      return res.rows.length ? approvalContinuationSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return approvalContinuations.get(makeScopedKey({ tenantId, id: normalizedRequestId })) ?? null;
    }
  }

  async function listApprovalContinuations({
    tenantId = DEFAULT_TENANT_ID,
    requestId = null,
    status = null,
    kind = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (requestId !== null && (typeof requestId !== "string" || requestId.trim() === "")) {
      throw new TypeError("requestId must be null or a non-empty string");
    }
    if (status !== null && (typeof status !== "string" || status.trim() === "")) {
      throw new TypeError("status must be null or a non-empty string");
    }
    if (kind !== null && (typeof kind !== "string" || kind.trim() === "")) {
      throw new TypeError("kind must be null or a non-empty string");
    }
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const requestIdFilter = requestId ? String(requestId).trim() : null;
    const statusFilter = status ? String(status).trim().toLowerCase() : null;
    const kindFilter = kind ? String(kind).trim().toLowerCase() : null;

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (requestIdFilter && String(row.requestId ?? "") !== requestIdFilter) continue;
        if (statusFilter && String(row.status ?? "").toLowerCase() !== statusFilter) continue;
        if (kindFilter && String(row.kind ?? "").toLowerCase() !== kindFilter) continue;
        out.push(row);
      }
      out.sort((left, right) => String(left.requestId ?? "").localeCompare(String(right.requestId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'approval_continuation'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(approvalContinuationSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(approvalContinuations.values()));
    }
  }

  return {
    getApprovalRequest,
    listApprovalRequests,
    getApprovalDecision,
    listApprovalDecisions,
    getApprovalStandingPolicy,
    listApprovalStandingPolicies,
    getApprovalContinuation,
    listApprovalContinuations
  };
}

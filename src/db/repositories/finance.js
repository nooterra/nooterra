/**
 * Finance repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: MoneyRail operations/events, billable usage, parties,
 *          reconciliation triage, billing config, finance account maps,
 *          party statements.
 */

import { DEFAULT_TENANT_ID, makeScopedKey, normalizeTenantId } from "../../core/tenancy.js";
import { MONTH_CLOSE_BASIS } from "../../core/month-close.js";
import { computeFinanceAccountMapHash, validateFinanceAccountMapV1 } from "../../core/finance-account-map.js";

// ---------------------------------------------------------------------------
// Shared helpers (pure, no DB)
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function parseIsoOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function parseSafeIntegerOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function moneyRailOperationMapKey({ tenantId, providerId, operationId }) {
  return `${normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID)}\n${String(providerId)}\n${String(operationId)}`;
}

function moneyRailProviderEventMapKey({ tenantId, providerId, operationId, eventType, eventDedupeKey }) {
  return `${normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID)}\n${String(providerId)}\n${String(operationId)}\n${String(eventType)}\n${String(eventDedupeKey)}`;
}

function billableUsageEventMapKey({ tenantId, eventKey }) {
  return `${normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID)}\n${String(eventKey)}`;
}

function financeReconciliationTriageMapKey({ tenantId, triageKey }) {
  return makeScopedKey({ tenantId: normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID), id: String(triageKey) });
}

// ---------------------------------------------------------------------------
// Row-to-record mappers
// ---------------------------------------------------------------------------

function moneyRailOperationRowToRecord(row) {
  if (!row) return null;
  const operation = row?.operation_json ?? null;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? operation?.tenantId ?? DEFAULT_TENANT_ID);
  const providerId = row?.provider_id ? String(row.provider_id) : operation?.providerId ? String(operation.providerId) : null;
  const operationId = row?.operation_id ? String(row.operation_id) : operation?.operationId ? String(operation.operationId) : null;
  if (!providerId || !operationId) return null;

  return {
    ...operation,
    tenantId,
    providerId,
    operationId,
    direction: operation?.direction ? String(operation.direction).toLowerCase() : row?.direction ? String(row.direction).toLowerCase() : null,
    idempotencyKey:
      operation?.idempotencyKey && String(operation.idempotencyKey).trim() !== ""
        ? String(operation.idempotencyKey)
        : row?.idempotency_key
          ? String(row.idempotency_key)
          : null,
    amountCents: parseSafeIntegerOrNull(operation?.amountCents ?? row?.amount_cents),
    currency:
      operation?.currency && String(operation.currency).trim() !== ""
        ? String(operation.currency).toUpperCase()
        : row?.currency
          ? String(row.currency).toUpperCase()
          : "USD",
    counterpartyRef:
      operation?.counterpartyRef && String(operation.counterpartyRef).trim() !== ""
        ? String(operation.counterpartyRef)
        : row?.counterparty_ref
          ? String(row.counterparty_ref)
          : null,
    state: operation?.state ? String(operation.state).toLowerCase() : row?.state ? String(row.state).toLowerCase() : null,
    providerRef:
      operation?.providerRef !== undefined
        ? operation.providerRef
        : row?.provider_ref !== undefined
          ? row.provider_ref
          : null,
    reasonCode:
      operation?.reasonCode !== undefined
        ? operation.reasonCode
        : row?.reason_code !== undefined
          ? row.reason_code
          : null,
    initiatedAt: parseIsoOrNull(operation?.initiatedAt ?? row?.initiated_at),
    submittedAt: parseIsoOrNull(operation?.submittedAt ?? row?.submitted_at),
    confirmedAt: parseIsoOrNull(operation?.confirmedAt ?? row?.confirmed_at),
    failedAt: parseIsoOrNull(operation?.failedAt ?? row?.failed_at),
    cancelledAt: parseIsoOrNull(operation?.cancelledAt ?? row?.cancelled_at),
    reversedAt: parseIsoOrNull(operation?.reversedAt ?? row?.reversed_at),
    createdAt: parseIsoOrNull(operation?.createdAt ?? row?.created_at) ?? new Date(0).toISOString(),
    updatedAt: parseIsoOrNull(operation?.updatedAt ?? row?.updated_at) ?? new Date(0).toISOString(),
    metadata:
      operation?.metadata && typeof operation.metadata === "object" && !Array.isArray(operation.metadata)
        ? operation.metadata
        : row?.metadata_json ?? null,
    requestHash:
      operation?.requestHash && String(operation.requestHash).trim() !== ""
        ? String(operation.requestHash)
        : row?.request_hash
          ? String(row.request_hash)
          : null
  };
}

function moneyRailProviderEventRowToRecord(row) {
  if (!row) return null;
  const event = row?.event_json ?? null;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? event?.tenantId ?? DEFAULT_TENANT_ID);
  const providerId = row?.provider_id ? String(row.provider_id) : event?.providerId ? String(event.providerId) : null;
  const operationId = row?.operation_id ? String(row.operation_id) : event?.operationId ? String(event.operationId) : null;
  const eventType = row?.event_type ? String(row.event_type).toLowerCase() : event?.eventType ? String(event.eventType).toLowerCase() : null;
  const eventDedupeKey =
    row?.event_dedupe_key && String(row.event_dedupe_key).trim() !== ""
      ? String(row.event_dedupe_key)
      : event?.eventDedupeKey && String(event.eventDedupeKey).trim() !== ""
        ? String(event.eventDedupeKey)
        : null;
  if (!providerId || !operationId || !eventType || !eventDedupeKey) return null;
  return {
    ...event,
    tenantId,
    providerId,
    operationId,
    eventType,
    eventDedupeKey,
    eventId:
      event?.eventId === null || event?.eventId === undefined
        ? row?.event_id ?? null
        : String(event.eventId),
    at: parseIsoOrNull(event?.at ?? row?.at),
    payload:
      event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload
        : row?.payload_json ?? null,
    createdAt: parseIsoOrNull(event?.createdAt ?? row?.created_at) ?? new Date(0).toISOString()
  };
}

function billableUsageEventRowToRecord(row) {
  if (!row) return null;
  const event = row?.event_json ?? null;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? event?.tenantId ?? DEFAULT_TENANT_ID);
  const eventKey = row?.event_key ? String(row.event_key) : event?.eventKey ? String(event.eventKey) : null;
  if (!eventKey) return null;

  const occurredAt = parseIsoOrNull(event?.occurredAt ?? row?.occurred_at) ?? new Date(0).toISOString();
  const period =
    event?.period && /^\d{4}-\d{2}$/.test(String(event.period).trim())
      ? String(event.period).trim()
      : row?.period && /^\d{4}-\d{2}$/.test(String(row.period).trim())
        ? String(row.period).trim()
        : occurredAt.slice(0, 7);
  return {
    ...event,
    tenantId,
    eventKey,
    eventType:
      event?.eventType && String(event.eventType).trim() !== ""
        ? String(event.eventType).toLowerCase()
        : row?.event_type
          ? String(row.event_type).toLowerCase()
          : null,
    period,
    occurredAt,
    quantity: parseSafeIntegerOrNull(event?.quantity ?? row?.quantity) ?? 0,
    amountCents: parseSafeIntegerOrNull(event?.amountCents ?? row?.amount_cents),
    currency:
      event?.currency && String(event.currency).trim() !== ""
        ? String(event.currency).toUpperCase()
        : row?.currency
          ? String(row.currency).toUpperCase()
          : null,
    runId: event?.runId ?? row?.run_id ?? null,
    settlementId: event?.settlementId ?? row?.settlement_id ?? null,
    disputeId: event?.disputeId ?? row?.dispute_id ?? null,
    arbitrationCaseId: event?.arbitrationCaseId ?? row?.arbitration_case_id ?? null,
    sourceType: event?.sourceType ?? row?.source_type ?? null,
    sourceId: event?.sourceId ?? row?.source_id ?? null,
    sourceEventId: event?.sourceEventId ?? row?.source_event_id ?? null,
    eventHash:
      event?.eventHash && String(event.eventHash).trim() !== ""
        ? String(event.eventHash)
        : row?.event_hash
          ? String(row.event_hash)
          : null,
    audit:
      event?.audit && typeof event.audit === "object" && !Array.isArray(event.audit)
        ? event.audit
        : row?.audit_json ?? null,
    createdAt: parseIsoOrNull(event?.createdAt ?? row?.created_at) ?? new Date(0).toISOString()
  };
}

function financeReconciliationTriageSnapshotRowToRecord(row) {
  const triage = row?.snapshot_json ?? null;
  if (!triage || typeof triage !== "object" || Array.isArray(triage)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? triage?.tenantId ?? DEFAULT_TENANT_ID);
  const triageKey =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof triage?.triageKey === "string" && triage.triageKey.trim() !== ""
        ? triage.triageKey.trim()
        : null;
  if (!triageKey) return null;
  return {
    ...triage,
    tenantId,
    triageKey
  };
}

function partyStatementRowToRecord(row) {
  return {
    tenantId: String(row.tenant_id),
    partyId: String(row.party_id),
    period: String(row.period),
    basis: String(row.basis),
    status: String(row.status),
    statementHash: String(row.statement_hash),
    artifactId: String(row.artifact_id),
    artifactHash: String(row.artifact_hash),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool
 * @param {Function} opts.withTx                    - transactional wrapper from store-pg
 * @param {Function} opts.persistSnapshotAggregate  - snapshot upsert helper from store-pg
 * @param {Function} opts.persistTenantBillingConfig - billing config persist helper from store-pg
 * @param {Function} opts.insertOpsAuditRow         - audit insert helper from store-pg
 * @param {Function} opts.ensureTenant              - store.ensureTenant
 * @param {Function} opts.getConfig                 - store.getConfig
 * @param {Map} opts.moneyRailOperations            - in-memory fallback map
 * @param {Map} opts.moneyRailProviderEvents        - in-memory fallback map
 * @param {Map} opts.billableUsageEvents            - in-memory fallback map
 * @param {Map} opts.financeReconciliationTriages   - in-memory fallback map
 */
export function createFinanceRepository({
  pool,
  withTx,
  persistSnapshotAggregate,
  persistTenantBillingConfig,
  insertOpsAuditRow,
  ensureTenant,
  getConfig,
  moneyRailOperations,
  moneyRailProviderEvents,
  billableUsageEvents,
  financeReconciliationTriages
}) {

  // -------------------------------------------------------------------------
  // MoneyRail operations
  // -------------------------------------------------------------------------

  async function getMoneyRailOperation({ tenantId = DEFAULT_TENANT_ID, providerId, operationId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(providerId, "providerId");
    assertNonEmptyString(operationId, "operationId");
    try {
      const res = await pool.query(
        `
          SELECT
            tenant_id, provider_id, operation_id, direction, idempotency_key, amount_cents, currency, counterparty_ref,
            state, provider_ref, reason_code, initiated_at, submitted_at, confirmed_at, failed_at, cancelled_at, reversed_at,
            request_hash, metadata_json, operation_json, created_at, updated_at
          FROM money_rail_operations
          WHERE tenant_id = $1 AND provider_id = $2 AND operation_id = $3
          LIMIT 1
        `,
        [tenantId, String(providerId), String(operationId)]
      );
      return res.rows.length ? moneyRailOperationRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return moneyRailOperations.get(moneyRailOperationMapKey({ tenantId, providerId, operationId })) ?? null;
    }
  }

  async function findMoneyRailOperationByIdempotency({
    tenantId = DEFAULT_TENANT_ID,
    providerId,
    direction,
    idempotencyKey
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(providerId, "providerId");
    assertNonEmptyString(direction, "direction");
    assertNonEmptyString(idempotencyKey, "idempotencyKey");
    try {
      const res = await pool.query(
        `
          SELECT
            tenant_id, provider_id, operation_id, direction, idempotency_key, amount_cents, currency, counterparty_ref,
            state, provider_ref, reason_code, initiated_at, submitted_at, confirmed_at, failed_at, cancelled_at, reversed_at,
            request_hash, metadata_json, operation_json, created_at, updated_at
          FROM money_rail_operations
          WHERE tenant_id = $1 AND provider_id = $2 AND lower(direction) = $3 AND idempotency_key = $4
          LIMIT 1
        `,
        [tenantId, String(providerId), String(direction).toLowerCase(), String(idempotencyKey)]
      );
      return res.rows.length ? moneyRailOperationRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      for (const operation of moneyRailOperations.values()) {
        if (!operation || typeof operation !== "object") continue;
        if (normalizeTenantId(operation.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (String(operation.providerId ?? "") !== String(providerId)) continue;
        if (String(operation.direction ?? "").toLowerCase() !== String(direction).toLowerCase()) continue;
        if (String(operation.idempotencyKey ?? "") !== String(idempotencyKey)) continue;
        return operation;
      }
      return null;
    }
  }

  async function listMoneyRailOperations({
    tenantId = DEFAULT_TENANT_ID,
    providerId = null,
    direction = null,
    state = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (providerId !== null) assertNonEmptyString(providerId, "providerId");
    if (direction !== null) assertNonEmptyString(direction, "direction");
    if (state !== null) assertNonEmptyString(state, "state");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    try {
      const params = [tenantId];
      const where = ["tenant_id = $1"];
      if (providerId !== null) {
        params.push(String(providerId));
        where.push(`provider_id = $${params.length}`);
      }
      if (direction !== null) {
        params.push(String(direction).toLowerCase());
        where.push(`lower(direction) = $${params.length}`);
      }
      if (state !== null) {
        params.push(String(state).toLowerCase());
        where.push(`lower(state) = $${params.length}`);
      }
      params.push(safeLimit);
      params.push(safeOffset);
      const res = await pool.query(
        `
          SELECT
            tenant_id, provider_id, operation_id, direction, idempotency_key, amount_cents, currency, counterparty_ref,
            state, provider_ref, reason_code, initiated_at, submitted_at, confirmed_at, failed_at, cancelled_at, reversed_at,
            request_hash, metadata_json, operation_json, created_at, updated_at
          FROM money_rail_operations
          WHERE ${where.join(" AND ")}
          ORDER BY operation_id ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );
      return res.rows.map(moneyRailOperationRowToRecord).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const out = [];
      const normalizedProviderId = providerId === null ? null : String(providerId);
      const normalizedDirection = direction === null ? null : String(direction).toLowerCase();
      const normalizedState = state === null ? null : String(state).toLowerCase();
      for (const operation of moneyRailOperations.values()) {
        if (!operation || typeof operation !== "object") continue;
        if (normalizeTenantId(operation.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (normalizedProviderId !== null && String(operation.providerId ?? "") !== normalizedProviderId) continue;
        if (normalizedDirection !== null && String(operation.direction ?? "").toLowerCase() !== normalizedDirection) continue;
        if (normalizedState !== null && String(operation.state ?? "").toLowerCase() !== normalizedState) continue;
        out.push(operation);
      }
      out.sort((left, right) => String(left.operationId ?? "").localeCompare(String(right.operationId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    }
  }

  async function putMoneyRailOperation({
    tenantId = DEFAULT_TENANT_ID,
    providerId,
    operation,
    requestHash = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(providerId, "providerId");
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new TypeError("operation is required");

    const operationId = assertNonEmptyString(operation.operationId ?? null, "operation.operationId");
    const direction = assertNonEmptyString(operation.direction ?? null, "operation.direction").toLowerCase();
    const idempotencyKey = assertNonEmptyString(operation.idempotencyKey ?? null, "operation.idempotencyKey");
    const amountCents = parseSafeIntegerOrNull(operation.amountCents);
    if (amountCents === null || amountCents <= 0) throw new TypeError("operation.amountCents must be a positive safe integer");
    const currency =
      operation.currency && String(operation.currency).trim() !== "" ? String(operation.currency).toUpperCase() : "USD";
    const counterpartyRef = assertNonEmptyString(operation.counterpartyRef ?? null, "operation.counterpartyRef");
    const state = assertNonEmptyString(operation.state ?? null, "operation.state").toLowerCase();
    const initiatedAt = parseIsoOrNull(operation.initiatedAt ?? operation.createdAt ?? new Date().toISOString());
    if (!initiatedAt) throw new TypeError("operation.initiatedAt must be an ISO date-time");
    const createdAt = parseIsoOrNull(operation.createdAt) ?? initiatedAt;
    const updatedAt = parseIsoOrNull(operation.updatedAt) ?? createdAt;

    const normalizedOperation = {
      ...operation,
      tenantId,
      providerId: String(providerId),
      operationId,
      direction,
      idempotencyKey,
      amountCents,
      currency,
      counterpartyRef,
      state,
      providerRef: operation.providerRef ?? null,
      reasonCode: operation.reasonCode ?? null,
      initiatedAt,
      submittedAt: parseIsoOrNull(operation.submittedAt),
      confirmedAt: parseIsoOrNull(operation.confirmedAt),
      failedAt: parseIsoOrNull(operation.failedAt),
      cancelledAt: parseIsoOrNull(operation.cancelledAt),
      reversedAt: parseIsoOrNull(operation.reversedAt),
      metadata:
        operation.metadata && typeof operation.metadata === "object" && !Array.isArray(operation.metadata)
          ? operation.metadata
          : null,
      requestHash:
        requestHash !== null && requestHash !== undefined && String(requestHash).trim() !== ""
          ? String(requestHash)
          : operation.requestHash ?? null,
      createdAt,
      updatedAt
    };

    try {
      const res = await pool.query(
        `
          INSERT INTO money_rail_operations (
            tenant_id, provider_id, operation_id, direction, idempotency_key, amount_cents, currency, counterparty_ref,
            state, provider_ref, reason_code, initiated_at, submitted_at, confirmed_at, failed_at, cancelled_at, reversed_at,
            request_hash, metadata_json, operation_json, created_at, updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
          ON CONFLICT (tenant_id, provider_id, operation_id) DO UPDATE SET
            direction = EXCLUDED.direction,
            idempotency_key = EXCLUDED.idempotency_key,
            amount_cents = EXCLUDED.amount_cents,
            currency = EXCLUDED.currency,
            counterparty_ref = EXCLUDED.counterparty_ref,
            state = EXCLUDED.state,
            provider_ref = EXCLUDED.provider_ref,
            reason_code = EXCLUDED.reason_code,
            initiated_at = EXCLUDED.initiated_at,
            submitted_at = EXCLUDED.submitted_at,
            confirmed_at = EXCLUDED.confirmed_at,
            failed_at = EXCLUDED.failed_at,
            cancelled_at = EXCLUDED.cancelled_at,
            reversed_at = EXCLUDED.reversed_at,
            request_hash = EXCLUDED.request_hash,
            metadata_json = EXCLUDED.metadata_json,
            operation_json = EXCLUDED.operation_json,
            updated_at = EXCLUDED.updated_at
          RETURNING
            tenant_id, provider_id, operation_id, direction, idempotency_key, amount_cents, currency, counterparty_ref,
            state, provider_ref, reason_code, initiated_at, submitted_at, confirmed_at, failed_at, cancelled_at, reversed_at,
            request_hash, metadata_json, operation_json, created_at, updated_at,
            (xmax = 0) AS inserted
        `,
        [
          tenantId,
          normalizedOperation.providerId,
          operationId,
          direction,
          idempotencyKey,
          amountCents,
          currency,
          counterpartyRef,
          state,
          normalizedOperation.providerRef,
          normalizedOperation.reasonCode,
          initiatedAt,
          normalizedOperation.submittedAt,
          normalizedOperation.confirmedAt,
          normalizedOperation.failedAt,
          normalizedOperation.cancelledAt,
          normalizedOperation.reversedAt,
          normalizedOperation.requestHash,
          normalizedOperation.metadata,
          normalizedOperation,
          createdAt,
          updatedAt
        ]
      );
      const record = res.rows.length ? moneyRailOperationRowToRecord(res.rows[0]) : normalizedOperation;
      return { operation: record, created: Boolean(res.rows[0]?.inserted) };
    } catch (err) {
      if (err?.code === "23505" && err?.constraint === "money_rail_operations_tenant_provider_direction_idem_key") {
        const conflict = new Error("idempotency key was already used with a different operation");
        conflict.code = "MONEY_RAIL_IDEMPOTENCY_CONFLICT";
        throw conflict;
      }
      if (err?.code !== "42P01") throw err;
      const mapKey = moneyRailOperationMapKey({ tenantId, providerId, operationId });
      const existing = moneyRailOperations.get(mapKey) ?? null;
      if (existing) {
        if (normalizedOperation.requestHash && existing.requestHash && String(existing.requestHash) !== String(normalizedOperation.requestHash)) {
          const conflict = new Error("operationId already exists with a different request");
          conflict.code = "MONEY_RAIL_OPERATION_CONFLICT";
          throw conflict;
        }
        const next = { ...existing, ...normalizedOperation, createdAt: existing.createdAt ?? normalizedOperation.createdAt };
        moneyRailOperations.set(mapKey, next);
        return { operation: next, created: false };
      }
      moneyRailOperations.set(mapKey, normalizedOperation);
      return { operation: normalizedOperation, created: true };
    }
  }

  // -------------------------------------------------------------------------
  // MoneyRail provider events
  // -------------------------------------------------------------------------

  async function getMoneyRailProviderEvent({
    tenantId = DEFAULT_TENANT_ID,
    providerId,
    operationId,
    eventType,
    eventDedupeKey
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(providerId, "providerId");
    assertNonEmptyString(operationId, "operationId");
    assertNonEmptyString(eventType, "eventType");
    assertNonEmptyString(eventDedupeKey, "eventDedupeKey");
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, provider_id, operation_id, event_type, event_dedupe_key, event_id, at, payload_json, event_json, created_at
          FROM money_rail_provider_events
          WHERE tenant_id = $1 AND provider_id = $2 AND operation_id = $3 AND event_type = $4 AND event_dedupe_key = $5
          LIMIT 1
        `,
        [tenantId, String(providerId), String(operationId), String(eventType).toLowerCase(), String(eventDedupeKey)]
      );
      return res.rows.length ? moneyRailProviderEventRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return moneyRailProviderEvents.get(
        moneyRailProviderEventMapKey({ tenantId, providerId, operationId, eventType: String(eventType).toLowerCase(), eventDedupeKey })
      ) ?? null;
    }
  }

  async function putMoneyRailProviderEvent({
    tenantId = DEFAULT_TENANT_ID,
    providerId,
    operationId,
    event
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(providerId, "providerId");
    assertNonEmptyString(operationId, "operationId");
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("event is required");
    const eventType = assertNonEmptyString(event.eventType ?? null, "event.eventType").toLowerCase();
    const eventDedupeKey = assertNonEmptyString(event.eventDedupeKey ?? null, "event.eventDedupeKey");
    const at = parseIsoOrNull(event.at);
    if (!at) throw new TypeError("event.at must be an ISO date-time");
    const normalizedEvent = {
      ...event,
      tenantId,
      providerId: String(providerId),
      operationId: String(operationId),
      eventType,
      eventDedupeKey,
      at,
      createdAt: parseIsoOrNull(event.createdAt) ?? at
    };

    try {
      const inserted = await pool.query(
        `
          INSERT INTO money_rail_provider_events (
            tenant_id, provider_id, operation_id, event_type, event_dedupe_key, event_id, at, payload_json, event_json, created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (tenant_id, provider_id, operation_id, event_type, event_dedupe_key) DO NOTHING
          RETURNING tenant_id, provider_id, operation_id, event_type, event_dedupe_key, event_id, at, payload_json, event_json, created_at
        `,
        [
          tenantId,
          normalizedEvent.providerId,
          normalizedEvent.operationId,
          eventType,
          eventDedupeKey,
          normalizedEvent.eventId ?? null,
          normalizedEvent.at,
          normalizedEvent.payload ?? null,
          normalizedEvent,
          normalizedEvent.createdAt
        ]
      );
      if (inserted.rows.length) {
        const record = moneyRailProviderEventRowToRecord(inserted.rows[0]) ?? normalizedEvent;
        return { event: record, created: true };
      }
      const existing = await getMoneyRailProviderEvent({
        tenantId,
        providerId: normalizedEvent.providerId,
        operationId: normalizedEvent.operationId,
        eventType,
        eventDedupeKey
      });
      return { event: existing ?? normalizedEvent, created: false };
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const key = moneyRailProviderEventMapKey({
        tenantId,
        providerId: normalizedEvent.providerId,
        operationId: normalizedEvent.operationId,
        eventType,
        eventDedupeKey
      });
      const existing = moneyRailProviderEvents.get(key) ?? null;
      if (existing) return { event: existing, created: false };
      moneyRailProviderEvents.set(key, normalizedEvent);
      return { event: normalizedEvent, created: true };
    }
  }

  // -------------------------------------------------------------------------
  // Billable usage events
  // -------------------------------------------------------------------------

  async function appendBillableUsageEvent({ tenantId = DEFAULT_TENANT_ID, event } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("event is required");
    const eventKey = assertNonEmptyString(event.eventKey ?? null, "event.eventKey");
    const eventType = assertNonEmptyString(event.eventType ?? null, "event.eventType").toLowerCase();
    const occurredAt = parseIsoOrNull(event.occurredAt ?? event.createdAt ?? new Date().toISOString());
    if (!occurredAt) throw new TypeError("event.occurredAt must be an ISO date-time");
    const period =
      typeof event.period === "string" && /^\d{4}-\d{2}$/.test(event.period.trim())
        ? event.period.trim()
        : occurredAt.slice(0, 7);
    const quantity = parseSafeIntegerOrNull(event.quantity ?? 1);
    if (quantity === null || quantity < 0) throw new TypeError("event.quantity must be a non-negative safe integer");
    const amountCents = event.amountCents === null || event.amountCents === undefined ? null : parseSafeIntegerOrNull(event.amountCents);
    const normalizedEvent = {
      ...event,
      schemaVersion: event.schemaVersion ?? "BillableUsageEvent.v1",
      tenantId,
      eventKey,
      eventType,
      period,
      occurredAt,
      quantity,
      amountCents,
      currency:
        event.currency === null || event.currency === undefined || String(event.currency).trim() === ""
          ? null
          : String(event.currency).toUpperCase(),
      createdAt: parseIsoOrNull(event.createdAt) ?? occurredAt
    };

    try {
      const inserted = await pool.query(
        `
          INSERT INTO billable_usage_events (
            tenant_id, event_key, event_type, period, occurred_at, quantity, amount_cents, currency,
            run_id, settlement_id, dispute_id, arbitration_case_id, source_type, source_id, source_event_id,
            event_hash, audit_json, event_json, created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          ON CONFLICT (tenant_id, event_key) DO NOTHING
          RETURNING
            tenant_id, event_key, event_type, period, occurred_at, quantity, amount_cents, currency,
            run_id, settlement_id, dispute_id, arbitration_case_id, source_type, source_id, source_event_id,
            event_hash, audit_json, event_json, created_at
        `,
        [
          tenantId,
          eventKey,
          eventType,
          period,
          occurredAt,
          quantity,
          amountCents,
          normalizedEvent.currency,
          normalizedEvent.runId ?? null,
          normalizedEvent.settlementId ?? null,
          normalizedEvent.disputeId ?? null,
          normalizedEvent.arbitrationCaseId ?? null,
          normalizedEvent.sourceType ?? null,
          normalizedEvent.sourceId ?? null,
          normalizedEvent.sourceEventId ?? null,
          normalizedEvent.eventHash ?? null,
          normalizedEvent.audit ?? null,
          normalizedEvent,
          normalizedEvent.createdAt
        ]
      );
      if (inserted.rows.length) {
        return { event: billableUsageEventRowToRecord(inserted.rows[0]) ?? normalizedEvent, appended: true };
      }
      const existingRes = await pool.query(
        `
          SELECT
            tenant_id, event_key, event_type, period, occurred_at, quantity, amount_cents, currency,
            run_id, settlement_id, dispute_id, arbitration_case_id, source_type, source_id, source_event_id,
            event_hash, audit_json, event_json, created_at
          FROM billable_usage_events
          WHERE tenant_id = $1 AND event_key = $2
          LIMIT 1
        `,
        [tenantId, eventKey]
      );
      const existing = existingRes.rows.length ? billableUsageEventRowToRecord(existingRes.rows[0]) : null;
      if (existing && normalizedEvent.eventHash && existing.eventHash && String(existing.eventHash) !== String(normalizedEvent.eventHash)) {
        const conflict = new Error("billable usage event key already exists with different immutable fields");
        conflict.code = "BILLABLE_USAGE_EVENT_CONFLICT";
        throw conflict;
      }
      return { event: existing ?? normalizedEvent, appended: false };
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const key = billableUsageEventMapKey({ tenantId, eventKey });
      const existing = billableUsageEvents.get(key) ?? null;
      if (existing) {
        if (normalizedEvent.eventHash && existing.eventHash && String(normalizedEvent.eventHash) !== String(existing.eventHash)) {
          const conflict = new Error("billable usage event key already exists with different immutable fields");
          conflict.code = "BILLABLE_USAGE_EVENT_CONFLICT";
          throw conflict;
        }
        return { event: existing, appended: false };
      }
      billableUsageEvents.set(key, normalizedEvent);
      return { event: normalizedEvent, appended: true };
    }
  }

  async function listBillableUsageEvents({
    tenantId = DEFAULT_TENANT_ID,
    period = null,
    eventType = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (period !== null && (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period.trim()))) {
      throw new TypeError("period must match YYYY-MM");
    }
    if (eventType !== null) assertNonEmptyString(eventType, "eventType");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    try {
      const params = [tenantId];
      const where = ["tenant_id = $1"];
      if (period !== null) {
        params.push(String(period).trim());
        where.push(`period = $${params.length}`);
      }
      if (eventType !== null) {
        params.push(String(eventType).toLowerCase());
        where.push(`lower(event_type) = $${params.length}`);
      }
      params.push(safeLimit);
      params.push(safeOffset);
      const res = await pool.query(
        `
          SELECT
            tenant_id, event_key, event_type, period, occurred_at, quantity, amount_cents, currency,
            run_id, settlement_id, dispute_id, arbitration_case_id, source_type, source_id, source_event_id,
            event_hash, audit_json, event_json, created_at
          FROM billable_usage_events
          WHERE ${where.join(" AND ")}
          ORDER BY occurred_at ASC, event_key ASC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        `,
        params
      );
      return res.rows.map(billableUsageEventRowToRecord).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      const normalizedPeriod = period === null ? null : String(period).trim();
      const normalizedType = eventType === null ? null : String(eventType).toLowerCase();
      const out = [];
      for (const row of billableUsageEvents.values()) {
        if (!row || typeof row !== "object") continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (normalizedPeriod !== null && String(row.period ?? "") !== normalizedPeriod) continue;
        if (normalizedType !== null && String(row.eventType ?? "").toLowerCase() !== normalizedType) continue;
        out.push(row);
      }
      out.sort(
        (left, right) =>
          String(left.occurredAt ?? "").localeCompare(String(right.occurredAt ?? "")) ||
          String(left.eventKey ?? "").localeCompare(String(right.eventKey ?? ""))
      );
      return out.slice(safeOffset, safeOffset + safeLimit);
    }
  }

  // -------------------------------------------------------------------------
  // Parties
  // -------------------------------------------------------------------------

  async function upsertParty({ tenantId = DEFAULT_TENANT_ID, party, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!party || typeof party !== "object") throw new TypeError("party is required");
    const partyId = party.partyId ?? party.id ?? null;
    assertNonEmptyString(partyId, "party.partyId");
    const partyRole = party.partyRole ?? party.role ?? null;
    assertNonEmptyString(partyRole, "party.partyRole");
    const displayName = party.displayName ?? null;
    assertNonEmptyString(displayName, "party.displayName");
    const status = party.status ?? "active";
    assertNonEmptyString(status, "party.status");

    await withTx(async (client) => {
      await client.query(
        `
          INSERT INTO parties (tenant_id, party_id, party_role, display_name, status)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (tenant_id, party_id) DO UPDATE
            SET party_role = EXCLUDED.party_role,
                display_name = EXCLUDED.display_name,
                status = EXCLUDED.status,
                updated_at = now()
        `,
        [tenantId, String(partyId), String(partyRole), String(displayName), String(status)]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });

    return getParty({ tenantId, partyId: String(partyId) });
  }

  async function getParty({ tenantId = DEFAULT_TENANT_ID, partyId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(partyId, "partyId");
    const res = await pool.query(
      "SELECT tenant_id, party_id, party_role, display_name, status, created_at, updated_at FROM parties WHERE tenant_id = $1 AND party_id = $2 LIMIT 1",
      [tenantId, String(partyId)]
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      tenantId: String(row.tenant_id),
      partyId: String(row.party_id),
      partyRole: String(row.party_role),
      displayName: String(row.display_name),
      status: String(row.status),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
    };
  }

  async function listParties({ tenantId = DEFAULT_TENANT_ID, role = null, status = null, limit = 200, offset = 0 } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (role !== null) assertNonEmptyString(role, "role");
    if (status !== null) assertNonEmptyString(status, "status");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;

    const params = [tenantId];
    const where = ["tenant_id = $1"];
    if (role !== null) {
      params.push(String(role));
      where.push(`party_role = $${params.length}`);
    }
    if (status !== null) {
      params.push(String(status));
      where.push(`status = $${params.length}`);
    }
    params.push(safeLimit);
    params.push(safeOffset);

    const res = await pool.query(
      `
        SELECT tenant_id, party_id, party_role, display_name, status, created_at, updated_at
        FROM parties
        WHERE ${where.join(" AND ")}
        ORDER BY party_id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    return res.rows.map((row) => ({
      tenantId: String(row.tenant_id),
      partyId: String(row.party_id),
      partyRole: String(row.party_role),
      displayName: String(row.display_name),
      status: String(row.status),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
    }));
  }

  // -------------------------------------------------------------------------
  // Finance account map & billing config
  // -------------------------------------------------------------------------

  async function getFinanceAccountMap({ tenantId = DEFAULT_TENANT_ID } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const res = await pool.query("SELECT mapping_json FROM finance_account_maps WHERE tenant_id = $1 LIMIT 1", [tenantId]);
    if (!res.rows.length) return null;
    return res.rows[0].mapping_json ?? null;
  }

  async function getTenantBillingConfig({ tenantId = DEFAULT_TENANT_ID } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    ensureTenant(tenantId);
    const cfg = getConfig(tenantId);
    const billing = cfg?.billing ?? null;
    return billing && typeof billing === "object" && !Array.isArray(billing) ? JSON.parse(JSON.stringify(billing)) : null;
  }

  async function putTenantBillingConfig({ tenantId = DEFAULT_TENANT_ID, billing, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!billing || typeof billing !== "object" || Array.isArray(billing)) {
      throw new TypeError("billing config is required");
    }
    const normalizedBilling = JSON.parse(JSON.stringify(billing));
    await withTx(async (client) => {
      await persistTenantBillingConfig(client, { tenantId, billing: normalizedBilling });
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    ensureTenant(tenantId);
    const cfg = getConfig(tenantId);
    cfg.billing = normalizedBilling;
    return normalizedBilling;
  }

  async function putFinanceAccountMap({ tenantId = DEFAULT_TENANT_ID, mapping, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    validateFinanceAccountMapV1(mapping);
    const mappingHash = computeFinanceAccountMapHash(mapping);

    await withTx(async (client) => {
      await client.query(
        `
          INSERT INTO finance_account_maps (tenant_id, mapping_hash, mapping_json)
          VALUES ($1,$2,$3)
          ON CONFLICT (tenant_id) DO UPDATE SET
            mapping_hash = EXCLUDED.mapping_hash,
            mapping_json = EXCLUDED.mapping_json,
            updated_at = now()
        `,
        [tenantId, String(mappingHash), JSON.stringify(mapping)]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });

    return { tenantId, mappingHash, mapping };
  }

  // -------------------------------------------------------------------------
  // Party statements
  // -------------------------------------------------------------------------

  async function putPartyStatement({ tenantId = DEFAULT_TENANT_ID, statement, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!statement || typeof statement !== "object") throw new TypeError("statement is required");
    const partyId = statement.partyId ?? null;
    const period = statement.period ?? null;
    assertNonEmptyString(partyId, "statement.partyId");
    assertNonEmptyString(period, "statement.period");
    const basis = statement.basis ?? MONTH_CLOSE_BASIS.SETTLED_AT;
    assertNonEmptyString(basis, "statement.basis");
    const status = statement.status ?? "OPEN";
    assertNonEmptyString(status, "statement.status");
    const statementHash = statement.statementHash ?? null;
    const artifactId = statement.artifactId ?? null;
    const artifactHash = statement.artifactHash ?? null;
    assertNonEmptyString(statementHash, "statement.statementHash");
    assertNonEmptyString(artifactId, "statement.artifactId");
    assertNonEmptyString(artifactHash, "statement.artifactHash");
    const closedAt = statement.closedAt ?? null;

    const record = await withTx(async (client) => {
      const existing = await client.query(
        "SELECT status, artifact_hash FROM party_statements WHERE tenant_id = $1 AND party_id = $2 AND period = $3 LIMIT 1",
        [tenantId, String(partyId), String(period)]
      );
      if (existing.rows.length && String(existing.rows[0].status ?? "") === "CLOSED") {
        const currentHash = String(existing.rows[0].artifact_hash ?? "");
        if (currentHash && currentHash !== String(artifactHash)) {
          const err = new Error("party statement is closed and cannot be changed");
          err.code = "PARTY_STATEMENT_IMMUTABLE";
          throw err;
        }
      }

      const res = await client.query(
        `
          INSERT INTO party_statements (tenant_id, party_id, period, basis, status, statement_hash, artifact_id, artifact_hash, closed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (tenant_id, party_id, period) DO UPDATE SET
            basis = EXCLUDED.basis,
            status = EXCLUDED.status,
            statement_hash = EXCLUDED.statement_hash,
            artifact_id = EXCLUDED.artifact_id,
            artifact_hash = EXCLUDED.artifact_hash,
            closed_at = EXCLUDED.closed_at,
            updated_at = now()
          RETURNING tenant_id, party_id, period, basis, status, statement_hash, artifact_id, artifact_hash, closed_at, created_at, updated_at
        `,
        [tenantId, String(partyId), String(period), String(basis), String(status), String(statementHash), String(artifactId), String(artifactHash), closedAt]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
      return res.rows.length ? partyStatementRowToRecord(res.rows[0]) : null;
    });

    if (!record) throw new Error("failed to persist party statement");
    return record;
  }

  async function getPartyStatement({ tenantId = DEFAULT_TENANT_ID, partyId, period } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(partyId, "partyId");
    assertNonEmptyString(period, "period");
    const res = await pool.query(
      `
        SELECT tenant_id, party_id, period, basis, status, statement_hash, artifact_id, artifact_hash, closed_at, created_at, updated_at
        FROM party_statements
        WHERE tenant_id = $1 AND party_id = $2 AND period = $3
        LIMIT 1
      `,
      [tenantId, String(partyId), String(period)]
    );
    return res.rows.length ? partyStatementRowToRecord(res.rows[0]) : null;
  }

  async function listPartyStatements({
    tenantId = DEFAULT_TENANT_ID,
    period = null,
    partyId = null,
    status = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (period !== null) assertNonEmptyString(period, "period");
    if (partyId !== null) assertNonEmptyString(partyId, "partyId");
    if (status !== null) assertNonEmptyString(status, "status");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;

    const params = [tenantId];
    const where = ["tenant_id = $1"];
    if (period !== null) {
      params.push(String(period));
      where.push(`period = $${params.length}`);
    }
    if (partyId !== null) {
      params.push(String(partyId));
      where.push(`party_id = $${params.length}`);
    }
    if (status !== null) {
      params.push(String(status));
      where.push(`status = $${params.length}`);
    }
    params.push(safeLimit);
    params.push(safeOffset);

    const res = await pool.query(
      `
        SELECT tenant_id, party_id, period, basis, status, statement_hash, artifact_id, artifact_hash, closed_at, created_at, updated_at
        FROM party_statements
        WHERE ${where.join(" AND ")}
        ORDER BY period ASC, party_id ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    return res.rows.map(partyStatementRowToRecord);
  }

  // -------------------------------------------------------------------------
  // Finance reconciliation triage
  // -------------------------------------------------------------------------

  async function getFinanceReconciliationTriage({
    tenantId = DEFAULT_TENANT_ID,
    triageKey
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(triageKey, "triageKey");
    const normalizedTriageKey = String(triageKey).trim();
    const res = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'finance_reconciliation_triage' AND aggregate_id = $2
        LIMIT 1
      `,
      [tenantId, normalizedTriageKey]
    );
    return res.rows.length ? financeReconciliationTriageSnapshotRowToRecord(res.rows[0]) : null;
  }

  async function putFinanceReconciliationTriage({
    tenantId = DEFAULT_TENANT_ID,
    triage,
    audit = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!triage || typeof triage !== "object" || Array.isArray(triage)) throw new TypeError("triage is required");
    const triageKey = assertNonEmptyString(triage.triageKey ?? null, "triage.triageKey");
    const sourceType = assertNonEmptyString(triage.sourceType ?? null, "triage.sourceType").toLowerCase();
    const mismatchType = assertNonEmptyString(triage.mismatchType ?? null, "triage.mismatchType");
    const mismatchKey = assertNonEmptyString(triage.mismatchKey ?? null, "triage.mismatchKey");
    const period = assertNonEmptyString(triage.period ?? null, "triage.period");
    const status = assertNonEmptyString(triage.status ?? null, "triage.status").toLowerCase();
    if (!/^\d{4}-\d{2}$/.test(period)) throw new TypeError("triage.period must match YYYY-MM");

    const existing = await getFinanceReconciliationTriage({ tenantId, triageKey });
    const nowAt = new Date().toISOString();
    const normalized = {
      schemaVersion: triage.schemaVersion ?? "FinanceReconciliationTriage.v1",
      tenantId,
      triageKey,
      sourceType,
      period,
      providerId:
        triage.providerId === null || triage.providerId === undefined || String(triage.providerId).trim() === ""
          ? null
          : String(triage.providerId).trim(),
      mismatchType,
      mismatchKey,
      mismatchCode:
        triage.mismatchCode === null || triage.mismatchCode === undefined || String(triage.mismatchCode).trim() === ""
          ? null
          : String(triage.mismatchCode).trim(),
      severity:
        triage.severity === null || triage.severity === undefined || String(triage.severity).trim() === ""
          ? null
          : String(triage.severity).trim().toLowerCase(),
      status,
      ownerPrincipalId:
        triage.ownerPrincipalId === null || triage.ownerPrincipalId === undefined || String(triage.ownerPrincipalId).trim() === ""
          ? null
          : String(triage.ownerPrincipalId).trim(),
      notes:
        triage.notes === null || triage.notes === undefined || String(triage.notes).trim() === ""
          ? null
          : String(triage.notes).trim(),
      sourceReportHash:
        triage.sourceReportHash === null || triage.sourceReportHash === undefined || String(triage.sourceReportHash).trim() === ""
          ? null
          : String(triage.sourceReportHash).trim(),
      metadata:
        triage.metadata && typeof triage.metadata === "object" && !Array.isArray(triage.metadata)
          ? { ...triage.metadata }
          : null,
      actionLog: Array.isArray(triage.actionLog) ? triage.actionLog.slice(0, 50) : existing?.actionLog ?? [],
      revision:
        Number.isSafeInteger(triage.revision) && triage.revision > 0
          ? Number(triage.revision)
          : Number(existing?.revision ?? 0) + 1,
      createdAt: parseIsoOrNull(triage.createdAt) ?? existing?.createdAt ?? nowAt,
      updatedAt: parseIsoOrNull(triage.updatedAt) ?? nowAt,
      resolvedAt: parseIsoOrNull(triage.resolvedAt) ?? null,
      resolvedByPrincipalId:
        triage.resolvedByPrincipalId === null || triage.resolvedByPrincipalId === undefined || String(triage.resolvedByPrincipalId).trim() === ""
          ? null
          : String(triage.resolvedByPrincipalId).trim()
    };

    await withTx(async (client) => {
      await persistSnapshotAggregate(client, {
        tenantId,
        aggregateType: "finance_reconciliation_triage",
        aggregateId: triageKey,
        snapshot: normalized,
        updatedAt: normalized.updatedAt
      });
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });

    if (!(financeReconciliationTriages instanceof Map)) return normalized;
    financeReconciliationTriages.set(financeReconciliationTriageMapKey({ tenantId, triageKey }), normalized);
    return normalized;
  }

  async function listFinanceReconciliationTriages({
    tenantId = DEFAULT_TENANT_ID,
    period = null,
    status = null,
    sourceType = null,
    providerId = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (period !== null && (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period.trim()))) {
      throw new TypeError("period must match YYYY-MM");
    }
    if (status !== null) status = assertNonEmptyString(status, "status").toLowerCase();
    if (sourceType !== null) sourceType = assertNonEmptyString(sourceType, "sourceType").toLowerCase();
    if (providerId !== null) providerId = assertNonEmptyString(providerId, "providerId");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const normalizedPeriod = period ? period.trim() : null;

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (normalizedPeriod !== null && String(row.period ?? "") !== normalizedPeriod) continue;
        if (status !== null && String(row.status ?? "").toLowerCase() !== status) continue;
        if (sourceType !== null && String(row.sourceType ?? "").toLowerCase() !== sourceType) continue;
        if (providerId !== null && String(row.providerId ?? "") !== providerId) continue;
        out.push(row);
      }
      out.sort((left, right) => {
        const leftMs = Date.parse(String(left?.updatedAt ?? left?.createdAt ?? ""));
        const rightMs = Date.parse(String(right?.updatedAt ?? right?.createdAt ?? ""));
        if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && rightMs !== leftMs) return rightMs - leftMs;
        return String(left?.triageKey ?? "").localeCompare(String(right?.triageKey ?? ""));
      });
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    const res = await pool.query(
      `
        SELECT tenant_id, aggregate_id, snapshot_json
        FROM snapshots
        WHERE tenant_id = $1 AND aggregate_type = 'finance_reconciliation_triage'
        ORDER BY updated_at DESC, aggregate_id ASC
      `,
      [tenantId]
    );
    return applyFilters(res.rows.map(financeReconciliationTriageSnapshotRowToRecord).filter(Boolean));
  }

  return {
    getMoneyRailOperation,
    findMoneyRailOperationByIdempotency,
    listMoneyRailOperations,
    putMoneyRailOperation,
    getMoneyRailProviderEvent,
    putMoneyRailProviderEvent,
    appendBillableUsageEvent,
    listBillableUsageEvents,
    upsertParty,
    getParty,
    listParties,
    getFinanceAccountMap,
    getTenantBillingConfig,
    putTenantBillingConfig,
    putFinanceAccountMap,
    putPartyStatement,
    getPartyStatement,
    listPartyStatements,
    getFinanceReconciliationTriage,
    putFinanceReconciliationTriage,
    listFinanceReconciliationTriages
  };
}

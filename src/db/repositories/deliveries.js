/**
 * Delivery & messaging repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: deliveries, delivery_receipts, ingest_records, correlations.
 */

import { DEFAULT_TENANT_ID, normalizeTenantId } from "../../core/tenancy.js";
import { clampQuota } from "../../core/quotas.js";
import { logger } from "../../core/log.js";

// ---------------------------------------------------------------------------
// Shared helpers (pure, no DB)
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function reclaimAfterSecondsFromEnv({ fallbackSeconds = 60 } = {}) {
  const raw = typeof process !== "undefined" ? (process.env.PROXY_RECLAIM_AFTER_SECONDS ?? null) : null;
  if (raw === null || raw === undefined) return fallbackSeconds;
  const text = String(raw).trim();
  if (!text) return fallbackSeconds;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) throw new TypeError("PROXY_RECLAIM_AFTER_SECONDS must be a positive number");
  return Math.floor(n);
}

function workerStatementTimeoutMsFromEnv({ fallbackMs = 0 } = {}) {
  const raw = typeof process !== "undefined" ? (process.env.PROXY_PG_WORKER_STATEMENT_TIMEOUT_MS ?? null) : null;
  if (raw === null || raw === undefined || String(raw).trim() === "") return fallbackMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) {
    throw new TypeError("PROXY_PG_WORKER_STATEMENT_TIMEOUT_MS must be a non-negative safe integer");
  }
  return Math.min(60_000, Math.floor(n));
}

// ---------------------------------------------------------------------------
// Row-level helpers (take a client, run inside a transaction)
// ---------------------------------------------------------------------------

async function upsertCorrelationRow(client, { tenantId, siteId, correlationKey, jobId, expiresAt, force = false }) {
  tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
  assertNonEmptyString(siteId, "siteId");
  assertNonEmptyString(correlationKey, "correlationKey");
  assertNonEmptyString(jobId, "jobId");

  const existing = await client.query(
    "SELECT job_id FROM correlations WHERE tenant_id = $1 AND site_id = $2 AND correlation_key = $3",
    [tenantId, siteId, correlationKey]
  );
  if (existing.rows.length) {
    const currentJobId = String(existing.rows[0].job_id);
    if (currentJobId !== jobId) {
      if (force) {
        await client.query(
          "UPDATE correlations SET job_id = $4, expires_at = $5 WHERE tenant_id = $1 AND site_id = $2 AND correlation_key = $3",
          [tenantId, siteId, correlationKey, jobId, expiresAt]
        );
        return;
      }
      const err = new Error("correlation key already linked to a different job");
      err.code = "CORRELATION_CONFLICT";
      err.existingJobId = currentJobId;
      throw err;
    }
    await client.query(
      "UPDATE correlations SET expires_at = COALESCE($5, expires_at) WHERE tenant_id = $1 AND site_id = $2 AND correlation_key = $3 AND job_id = $4",
      [tenantId, siteId, correlationKey, jobId, expiresAt]
    );
    return;
  }

  await client.query(
    "INSERT INTO correlations (tenant_id, site_id, correlation_key, job_id, expires_at) VALUES ($1,$2,$3,$4,$5)",
    [tenantId, siteId, correlationKey, jobId, expiresAt]
  );
}

async function insertDeliveryRow(client, { tenantId, delivery }) {
  tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
  if (!delivery || typeof delivery !== "object") throw new TypeError("delivery is required");
  assertNonEmptyString(delivery.destinationId, "delivery.destinationId");
  assertNonEmptyString(delivery.artifactType, "delivery.artifactType");
  assertNonEmptyString(delivery.artifactId, "delivery.artifactId");
  assertNonEmptyString(delivery.artifactHash, "delivery.artifactHash");
  assertNonEmptyString(delivery.dedupeKey, "delivery.dedupeKey");

  const res = await client.query(
    `
      INSERT INTO deliveries (tenant_id, destination_id, artifact_type, artifact_id, artifact_hash, dedupe_key, scope_key, order_seq, priority, order_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
      RETURNING id
    `,
    [
      tenantId,
      delivery.destinationId,
      delivery.artifactType,
      delivery.artifactId,
      delivery.artifactHash,
      delivery.dedupeKey,
      delivery.scopeKey ?? "",
      Number.isSafeInteger(delivery.orderSeq) ? delivery.orderSeq : 0,
      Number.isSafeInteger(delivery.priority) ? delivery.priority : 0,
      delivery.orderKey ?? null
    ]
  );
  return res.rows.length ? Number(res.rows[0].id) : null;
}

async function insertOpsAuditRow(client, { tenantId, audit }) {
  tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
  if (!audit || typeof audit !== "object") throw new TypeError("audit is required");
  const action = audit.action ? String(audit.action) : null;
  if (!action) throw new TypeError("audit.action is required");
  const detailsHash = audit.detailsHash ? String(audit.detailsHash) : audit.details_hash ? String(audit.details_hash) : null;
  if (!detailsHash) throw new TypeError("audit.detailsHash is required");
  const atIso = audit.at ? new Date(String(audit.at)).toISOString() : null;
  await client.query(
    `
      INSERT INTO ops_audit (
        tenant_id, actor_key_id, actor_principal_id, action, target_type, target_id, request_id, at, details_hash, details_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9,$10)
    `,
    [
      tenantId,
      audit.actorKeyId ?? null,
      audit.actorPrincipalId ?? null,
      action,
      audit.targetType ?? null,
      audit.targetId ?? null,
      audit.requestId ?? null,
      atIso,
      detailsHash,
      audit.details ?? null
    ]
  );
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {{ pool: object, getConfig?: function, withTx?: function }} opts
 *   - pool: pg Pool instance
 *   - getConfig: optional (tenantId) => config lookup (for quota enforcement)
 *   - withTx: transaction wrapper — async (optionsOrFn, maybeFn?) => result
 *     Signature mirrors store-pg.js: withTx(fn) or withTx({ statementTimeoutMs }, fn)
 * @returns {object} Repository methods
 */
export function createDeliveryRepository({ pool, getConfig, withTx }) {
  if (!pool) throw new TypeError("pool is required");
  if (!withTx) throw new TypeError("withTx is required");

  const workerStatementTimeoutMs = workerStatementTimeoutMsFromEnv({ fallbackMs: 0 });

  // -------------------------------------------------------------------
  // Correlations
  // -------------------------------------------------------------------

  async function lookupCorrelation({ tenantId = DEFAULT_TENANT_ID, siteId, correlationKey } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(siteId, "siteId");
    assertNonEmptyString(correlationKey, "correlationKey");

    const res = await pool.query(
      `
        SELECT job_id, expires_at
        FROM correlations
        WHERE tenant_id = $1 AND site_id = $2 AND correlation_key = $3
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1
      `,
      [tenantId, siteId, correlationKey]
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return { jobId: String(row.job_id), expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null };
  }

  async function upsertCorrelation({
    tenantId = DEFAULT_TENANT_ID,
    siteId,
    correlationKey,
    jobId,
    expiresAt = null,
    force = false
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(siteId, "siteId");
    assertNonEmptyString(correlationKey, "correlationKey");
    assertNonEmptyString(jobId, "jobId");
    await withTx(async (client) => {
      await upsertCorrelationRow(client, { tenantId, siteId, correlationKey, jobId, expiresAt, force: force === true });
    });
    return { jobId, expiresAt };
  }

  async function listCorrelations({ tenantId = DEFAULT_TENANT_ID, siteId = null, jobId = null, limit = 200, offset = 0 } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (siteId !== null) assertNonEmptyString(siteId, "siteId");
    if (jobId !== null) assertNonEmptyString(jobId, "jobId");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");

    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const params = [tenantId];
    const where = ["tenant_id = $1"];
    if (siteId !== null) {
      params.push(siteId);
      where.push(`site_id = $${params.length}`);
    }
    if (jobId !== null) {
      params.push(jobId);
      where.push(`job_id = $${params.length}`);
    }
    params.push(safeLimit);
    params.push(safeOffset);
    const res = await pool.query(
      `SELECT tenant_id, site_id, correlation_key, job_id, expires_at, created_at
       FROM correlations
       WHERE ${where.join(" AND ")}
       ORDER BY site_id ASC, correlation_key ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return res.rows.map((row) => ({
      tenantId: String(row.tenant_id ?? tenantId),
      siteId: String(row.site_id),
      correlationKey: String(row.correlation_key),
      jobId: String(row.job_id),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    }));
  }

  // -------------------------------------------------------------------
  // Ingest records
  // -------------------------------------------------------------------

  async function getIngestRecord({ tenantId = DEFAULT_TENANT_ID, source, externalEventId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(source, "source");
    assertNonEmptyString(externalEventId, "externalEventId");
    const res = await pool.query(
      "SELECT record_json FROM ingest_records WHERE tenant_id = $1 AND source = $2 AND external_event_id = $3 LIMIT 1",
      [tenantId, source, externalEventId]
    );
    return res.rows.length ? res.rows[0].record_json : null;
  }

  async function listIngestRecords({
    tenantId = DEFAULT_TENANT_ID,
    status = null,
    source = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (status !== null) assertNonEmptyString(status, "status");
    if (source !== null) assertNonEmptyString(source, "source");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");

    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;

    const params = [tenantId];
    const where = ["tenant_id = $1"];
    if (status !== null) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (source !== null) {
      params.push(source);
      where.push(`source = $${params.length}`);
    }
    params.push(safeLimit);
    params.push(safeOffset);
    const res = await pool.query(
      `SELECT record_json FROM ingest_records WHERE ${where.join(" AND ")} ORDER BY received_at DESC NULLS LAST, created_at DESC LIMIT $${
        params.length - 1
      } OFFSET $${params.length}`,
      params
    );
    return res.rows.map((r) => r.record_json);
  }

  // -------------------------------------------------------------------
  // Deliveries
  // -------------------------------------------------------------------

  async function createDelivery({ tenantId = DEFAULT_TENANT_ID, delivery }) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!delivery || typeof delivery !== "object") throw new TypeError("delivery is required");
    const dedupeKey = delivery.dedupeKey ?? null;
    assertNonEmptyString(dedupeKey, "delivery.dedupeKey");

    const cfg = typeof getConfig === "function" ? getConfig(tenantId) : null;
    const requestedLimit = cfg?.quotas?.maxPendingDeliveries ?? 0;
    const platformMaxPendingDeliveriesRaw = typeof process !== "undefined" ? (process.env.PROXY_QUOTA_PLATFORM_MAX_PENDING_DELIVERIES ?? null) : null;
    const platformMaxPendingDeliveries =
      platformMaxPendingDeliveriesRaw && String(platformMaxPendingDeliveriesRaw).trim() !== "" ? Number(platformMaxPendingDeliveriesRaw) : 0;
    if (platformMaxPendingDeliveriesRaw && String(platformMaxPendingDeliveriesRaw).trim() !== "") {
      if (!Number.isSafeInteger(platformMaxPendingDeliveries) || platformMaxPendingDeliveries < 0) {
        throw new TypeError("PROXY_QUOTA_PLATFORM_MAX_PENDING_DELIVERIES must be a non-negative safe integer");
      }
    }
    const quota = clampQuota({
      tenantLimit: Number.isSafeInteger(requestedLimit) ? requestedLimit : 0,
      defaultLimit: 0,
      maxLimit: Number.isSafeInteger(platformMaxPendingDeliveries) ? platformMaxPendingDeliveries : 0
    });

    const id = await withTx(async (client) => {
      const existing = await client.query("SELECT id FROM deliveries WHERE tenant_id = $1 AND dedupe_key = $2 LIMIT 1", [tenantId, String(dedupeKey)]);
      if (existing.rows.length) return Number(existing.rows[0].id);

      if (quota > 0) {
        const countRes = await client.query("SELECT COUNT(*)::int AS count FROM deliveries WHERE tenant_id = $1 AND state = 'pending'", [tenantId]);
        const pending = Number(countRes.rows[0]?.count ?? 0);
        if (pending >= quota) {
          const err = new Error("tenant quota exceeded");
          err.code = "TENANT_QUOTA_EXCEEDED";
          err.quota = { kind: "pending_deliveries", limit: quota, current: pending };
          throw err;
        }
      }

      const insertedId = await insertDeliveryRow(client, { tenantId, delivery });
      if (insertedId !== null) return insertedId;
      const raced = await client.query("SELECT id FROM deliveries WHERE tenant_id = $1 AND dedupe_key = $2 LIMIT 1", [tenantId, String(dedupeKey)]);
      return raced.rows.length ? Number(raced.rows[0].id) : null;
    });
    return { ...delivery, id };
  }

  async function listDeliveries({ tenantId = DEFAULT_TENANT_ID, state = null, limit = 200, offset = 0 } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (state !== null) assertNonEmptyString(state, "state");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");

    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;

    const res = state
      ? await pool.query(
          `
            SELECT id, destination_id, artifact_type, artifact_id, artifact_hash, dedupe_key, state, attempts, next_attempt_at,
                   claimed_at, worker, last_status, last_error, delivered_at, acked_at, ack_received_at, scope_key, order_seq, priority, order_key, expires_at, created_at, updated_at
            FROM deliveries
            WHERE tenant_id = $1 AND state = $2
            ORDER BY id DESC
            LIMIT $3 OFFSET $4
          `,
          [tenantId, state, safeLimit, safeOffset]
        )
      : await pool.query(
          `
            SELECT id, destination_id, artifact_type, artifact_id, artifact_hash, dedupe_key, state, attempts, next_attempt_at,
                   claimed_at, worker, last_status, last_error, delivered_at, acked_at, ack_received_at, scope_key, order_seq, priority, order_key, expires_at, created_at, updated_at
            FROM deliveries
            WHERE tenant_id = $1
            ORDER BY id DESC
            LIMIT $2 OFFSET $3
          `,
          [tenantId, safeLimit, safeOffset]
        );

    return res.rows.map((row) => ({
      id: Number(row.id),
      tenantId,
      destinationId: String(row.destination_id),
      artifactType: String(row.artifact_type),
      artifactId: String(row.artifact_id),
      artifactHash: String(row.artifact_hash),
      dedupeKey: String(row.dedupe_key),
      state: String(row.state),
      attempts: Number(row.attempts),
      nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
      claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
      worker: row.worker ? String(row.worker) : null,
      lastStatus: row.last_status === null ? null : Number(row.last_status),
      lastError: row.last_error ? String(row.last_error) : null,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
      ackedAt: row.acked_at ? new Date(row.acked_at).toISOString() : null,
      ackReceivedAt: row.ack_received_at ? new Date(row.ack_received_at).toISOString() : null,
      scopeKey: row.scope_key ? String(row.scope_key) : "",
      orderSeq: row.order_seq === null ? 0 : Number(row.order_seq),
      priority: row.priority === null ? 0 : Number(row.priority),
      orderKey: row.order_key ? String(row.order_key) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
    }));
  }

  async function claimDueDeliveries({ tenantId = DEFAULT_TENANT_ID, maxMessages = 100, worker = "delivery_v1" } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(maxMessages) || maxMessages < 0) throw new TypeError("maxMessages must be a non-negative safe integer");
    assertNonEmptyString(worker, "worker");
    const reclaimAfterSeconds = reclaimAfterSecondsFromEnv({ fallbackSeconds: 60 });

    const claimed = await withTx({ statementTimeoutMs: workerStatementTimeoutMs }, async (client) => {
      const res = await client.query(
        `
          SELECT id, destination_id, artifact_type, artifact_id, artifact_hash, dedupe_key, scope_key, order_seq, priority, order_key, attempts
          FROM deliveries
          WHERE tenant_id = $1
            AND state = 'pending'
            AND next_attempt_at <= now()
            AND (claimed_at IS NULL OR claimed_at < now() - ($3::text || ' seconds')::interval)
          ORDER BY next_attempt_at ASC, scope_key ASC, order_seq ASC, priority ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        `,
        [tenantId, Math.min(1000, maxMessages), String(reclaimAfterSeconds)]
      );
      if (!res.rows.length) return [];
      const ids = res.rows.map((r) => Number(r.id));
      await client.query(
        "UPDATE deliveries SET worker = $2, claimed_at = now(), attempts = attempts + 1, updated_at = now() WHERE tenant_id = $1 AND id = ANY($3::bigint[])",
        [tenantId, worker, ids]
      );
      return res.rows.map((row) => ({
        id: Number(row.id),
        tenantId,
        destinationId: String(row.destination_id),
        artifactType: String(row.artifact_type),
        artifactId: String(row.artifact_id),
        artifactHash: String(row.artifact_hash),
        dedupeKey: String(row.dedupe_key),
        scopeKey: row.scope_key ? String(row.scope_key) : "",
        orderSeq: row.order_seq === null ? 0 : Number(row.order_seq),
        priority: row.priority === null ? 0 : Number(row.priority),
        orderKey: row.order_key ? String(row.order_key) : null,
        attempts: Number(row.attempts) + 1
      }));
    });

    if (claimed.length) {
      logger.info("deliveries.claim", { tenantId, worker, claimed: claimed.length, reclaimAfterSeconds });
    }
    return claimed;
  }

  async function updateDeliveryAttempt({
    tenantId = DEFAULT_TENANT_ID,
    id,
    delivered,
    state,
    nextAttemptAt,
    lastStatus,
    lastError,
    expiresAt = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("id must be a positive integer");
    if (typeof delivered !== "boolean") throw new TypeError("delivered must be a boolean");
    assertNonEmptyString(state, "state");
    if (nextAttemptAt !== null && nextAttemptAt !== undefined) assertNonEmptyString(nextAttemptAt, "nextAttemptAt");
    if (lastStatus !== null && lastStatus !== undefined && !Number.isSafeInteger(lastStatus)) throw new TypeError("lastStatus must be a safe integer");
    if (lastError !== null && lastError !== undefined && (typeof lastError !== "string" || lastError.trim() === "")) {
      throw new TypeError("lastError must be null or a non-empty string");
    }
    if (expiresAt !== null && expiresAt !== undefined) assertNonEmptyString(expiresAt, "expiresAt");

    const deliveredAtSql = delivered ? "now()" : "NULL";
    await pool.query(
      `
        UPDATE deliveries
        SET state = $3,
            next_attempt_at = COALESCE($4::timestamptz, next_attempt_at),
            claimed_at = NULL,
            last_status = $5,
            last_error = $6,
            delivered_at = ${deliveredAtSql},
            expires_at = $7::timestamptz,
            updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      `,
      [tenantId, Number(id), state, nextAttemptAt ?? null, lastStatus ?? null, lastError ?? null, expiresAt ?? null]
    );
  }

  async function requeueDelivery({ tenantId = DEFAULT_TENANT_ID, id, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("id must be a positive integer");
    await withTx(async (client) => {
      await client.query(
        `
          UPDATE deliveries
          SET state = 'pending',
              next_attempt_at = now(),
              claimed_at = NULL,
              worker = NULL,
              attempts = 0,
              last_status = NULL,
              last_error = NULL,
              delivered_at = NULL,
              acked_at = NULL,
              ack_received_at = NULL,
              expires_at = NULL,
              updated_at = now()
          WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, Number(id)]
      );
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
  }

  async function ackDelivery({
    tenantId = DEFAULT_TENANT_ID,
    id,
    destinationId = null,
    artifactHash = null,
    receivedAt = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("id must be a positive integer");
    if (destinationId !== null) assertNonEmptyString(destinationId, "destinationId");
    if (artifactHash !== null) assertNonEmptyString(artifactHash, "artifactHash");
    if (receivedAt !== null) assertNonEmptyString(receivedAt, "receivedAt");

    return await withTx(async (client) => {
      const rowRes = await client.query(
        `
          SELECT id, destination_id, artifact_hash, acked_at
          FROM deliveries
          WHERE tenant_id = $1 AND id = $2
          LIMIT 1
        `,
        [tenantId, Number(id)]
      );
      if (!rowRes.rows.length) return null;
      const row = rowRes.rows[0];
      if (destinationId !== null && String(row.destination_id) !== String(destinationId)) {
        throw new TypeError("delivery destinationId mismatch");
      }
      if (artifactHash !== null && String(row.artifact_hash) !== String(artifactHash)) {
        throw new TypeError("delivery artifactHash mismatch");
      }

      // Idempotent: if already acked, keep the first ack.
      if (row.acked_at) {
        await client.query(
          "INSERT INTO delivery_receipts (tenant_id, delivery_id, destination_id, artifact_hash, received_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, delivery_id) DO NOTHING",
          [tenantId, Number(id), String(row.destination_id), String(row.artifact_hash), receivedAt ?? null]
        );
        const delivery = await client.query("SELECT id, acked_at, ack_received_at FROM deliveries WHERE tenant_id = $1 AND id = $2", [tenantId, Number(id)]);
        return {
          delivery: {
            id: Number(id),
            tenantId,
            ackedAt: delivery.rows[0]?.acked_at ? new Date(delivery.rows[0].acked_at).toISOString() : null,
            ackReceivedAt: delivery.rows[0]?.ack_received_at ? new Date(delivery.rows[0].ack_received_at).toISOString() : null
          }
        };
      }

      await client.query(
        `
          UPDATE deliveries
          SET acked_at = now(),
              ack_received_at = COALESCE($3::timestamptz, ack_received_at),
              updated_at = now()
          WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, Number(id), receivedAt ?? null]
      );

      await client.query(
        "INSERT INTO delivery_receipts (tenant_id, delivery_id, destination_id, artifact_hash, received_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, delivery_id) DO NOTHING",
        [tenantId, Number(id), String(row.destination_id), String(row.artifact_hash), receivedAt ?? null]
      );

      const updated = await client.query("SELECT acked_at, ack_received_at FROM deliveries WHERE tenant_id = $1 AND id = $2", [tenantId, Number(id)]);
      return {
        delivery: {
          id: Number(id),
          tenantId,
          ackedAt: updated.rows[0]?.acked_at ? new Date(updated.rows[0].acked_at).toISOString() : null,
          ackReceivedAt: updated.rows[0]?.ack_received_at ? new Date(updated.rows[0].ack_received_at).toISOString() : null
        }
      };
    });
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  return {
    // Correlations
    lookupCorrelation,
    upsertCorrelation,
    listCorrelations,

    // Ingest records
    getIngestRecord,
    listIngestRecords,

    // Deliveries
    createDelivery,
    listDeliveries,
    claimDueDeliveries,
    updateDeliveryAttempt,
    requeueDelivery,
    ackDelivery,

    // Exposed for reuse by other repositories or store-pg.js during migration
    _helpers: {
      insertDeliveryRow,
      upsertCorrelationRow,
      insertOpsAuditRow
    }
  };
}

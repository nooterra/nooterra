/**
 * Sessions repository.
 * Extracted from store-pg.js for maintainability.
 *
 * Handles: sessions (snapshots), session events.
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

function sessionSnapshotRowToRecord(row) {
  const session = row?.snapshot_json ?? null;
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? session?.tenantId ?? DEFAULT_TENANT_ID);
  const sessionId =
    row?.aggregate_id && String(row.aggregate_id).trim() !== ""
      ? String(row.aggregate_id).trim()
      : typeof session?.sessionId === "string" && session.sessionId.trim() !== ""
        ? session.sessionId.trim()
        : null;
  if (!sessionId) return null;
  return {
    ...session,
    tenantId,
    sessionId
  };
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool
 * @param {Map} opts.sessions      - in-memory fallback map
 * @param {Map} opts.sessionEvents - in-memory fallback map
 */
export function createSessionsRepository({ pool, sessions, sessionEvents }) {

  async function getSession({ tenantId = DEFAULT_TENANT_ID, sessionId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(sessionId, "sessionId");
    const normalizedSessionId = String(sessionId).trim();
    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'session' AND aggregate_id = $2
          LIMIT 1
        `,
        [tenantId, normalizedSessionId]
      );
      return res.rows.length ? sessionSnapshotRowToRecord(res.rows[0]) : null;
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return sessions.get(makeScopedKey({ tenantId, id: normalizedSessionId })) ?? null;
    }
  }

  async function listSessions({
    tenantId = DEFAULT_TENANT_ID,
    sessionId = null,
    visibility = null,
    participantAgentId = null,
    limit = 200,
    offset = 0
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("limit must be a positive safe integer");
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("offset must be a non-negative safe integer");
    const safeLimit = Math.min(1000, limit);
    const safeOffset = offset;
    const sessionIdFilter = sessionId === null || sessionId === undefined || String(sessionId).trim() === "" ? null : String(sessionId).trim();
    const visibilityFilter =
      visibility === null || visibility === undefined || String(visibility).trim() === "" ? null : String(visibility).trim().toLowerCase();
    const participantFilter =
      participantAgentId === null || participantAgentId === undefined || String(participantAgentId).trim() === ""
        ? null
        : String(participantAgentId).trim();

    const applyFilters = (rows) => {
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (normalizeTenantId(row.tenantId ?? DEFAULT_TENANT_ID) !== tenantId) continue;
        if (sessionIdFilter && String(row.sessionId ?? "") !== sessionIdFilter) continue;
        if (visibilityFilter && String(row.visibility ?? "").toLowerCase() !== visibilityFilter) continue;
        if (participantFilter) {
          const participants = Array.isArray(row.participants) ? row.participants : [];
          if (!participants.includes(participantFilter)) continue;
        }
        out.push(row);
      }
      out.sort((left, right) => String(left.sessionId ?? "").localeCompare(String(right.sessionId ?? "")));
      return out.slice(safeOffset, safeOffset + safeLimit);
    };

    try {
      const res = await pool.query(
        `
          SELECT tenant_id, aggregate_id, snapshot_json
          FROM snapshots
          WHERE tenant_id = $1 AND aggregate_type = 'session'
          ORDER BY aggregate_id ASC
        `,
        [tenantId]
      );
      return applyFilters(res.rows.map(sessionSnapshotRowToRecord).filter(Boolean));
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return applyFilters(Array.from(sessions.values()));
    }
  }

  async function getSessionEvents({ tenantId = DEFAULT_TENANT_ID, sessionId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(sessionId, "sessionId");
    const normalizedSessionId = String(sessionId).trim();
    try {
      const res = await pool.query(
        `
          SELECT event_json
          FROM events
          WHERE tenant_id = $1 AND aggregate_type = 'session' AND aggregate_id = $2
          ORDER BY seq ASC
        `,
        [tenantId, normalizedSessionId]
      );
      return res.rows.map((row) => row.event_json).filter(Boolean);
    } catch (err) {
      if (err?.code !== "42P01") throw err;
      return sessionEvents.get(makeScopedKey({ tenantId, id: normalizedSessionId })) ?? [];
    }
  }

  return {
    getSession,
    listSessions,
    getSessionEvents
  };
}

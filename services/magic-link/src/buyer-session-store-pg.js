/**
 * Postgres-backed buyer session store.
 *
 * Drop-in replacement for the file-based buyer-session-records.js.
 * Sessions survive server restarts and work across multiple replicas.
 *
 * Falls back to file-based storage if DATABASE_URL is not configured
 * (local development without Postgres).
 */

import pg from "pg";

let _pool = null;

export function isPostgresAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) return null;

  _pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  _pool.on("error", (err) => {
    console.error("[buyer-session-store-pg] Pool error:", err.message);
  });
  return _pool;
}

export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Create or update a buyer session record.
 */
export async function createBuyerSessionRecord({
  tenantId,
  email,
  sessionId,
  issuedAt,
  expiresAt,
  userAgent = "",
} = {}) {
  const pool = await getPool();
  if (!pool) return { ok: false, error: "NO_DB", message: "Database not configured" };

  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedSessionId = String(sessionId ?? "").trim();

  if (!normalizedTenantId || !normalizedEmail || !normalizedSessionId) {
    return { ok: false, error: "SESSION_RECORD_INVALID", message: "tenantId, email, and sessionId are required" };
  }

  const now = new Date().toISOString();
  const issued = issuedAt || now;
  const expires = expiresAt || now;

  await pool.query(
    `INSERT INTO buyer_sessions (session_id, tenant_id, email, issued_at, expires_at, last_seen_at, user_agent)
     VALUES ($1, $2, $3, $4, $5, $4, $6)
     ON CONFLICT (tenant_id, email, session_id) DO UPDATE SET
       expires_at = EXCLUDED.expires_at,
       last_seen_at = now(),
       user_agent = EXCLUDED.user_agent,
       revoked_at = NULL,
       revoked_reason = NULL`,
    [normalizedSessionId, normalizedTenantId, normalizedEmail, issued, expires, String(userAgent ?? "").slice(0, 512)],
  );

  return {
    ok: true,
    session: {
      sessionId: normalizedSessionId,
      issuedAt: issued,
      expiresAt: expires,
      lastSeenAt: issued,
      revokedAt: null,
    },
  };
}

/**
 * Validate a session and return the principal.
 * This is the hot path — called on every authenticated request.
 */
export async function validateBuyerSession({ sessionId, tenantId }) {
  const pool = await getPool();
  if (!pool) return null;

  const result = await pool.query(
    `SELECT session_id, tenant_id, email, issued_at, expires_at, last_seen_at,
            step_up_at, step_up_method, revoked_at
     FROM buyer_sessions
     WHERE session_id = $1
       AND ($2::text IS NULL OR tenant_id = $2)
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY issued_at DESC
     LIMIT 1`,
    [String(sessionId ?? "").trim(), tenantId || null],
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0];

  // Update last_seen_at (fire-and-forget, non-blocking)
  pool.query(
    "UPDATE buyer_sessions SET last_seen_at = now() WHERE session_id = $1 AND tenant_id = $2 AND email = $3",
    [row.session_id, row.tenant_id, row.email],
  ).catch(() => {});

  return {
    tenantId: row.tenant_id,
    email: row.email,
    sessionId: row.session_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  };
}

/**
 * List active sessions for a buyer.
 */
export async function listBuyerSessionRecords({ tenantId, email, includeRevoked = false } = {}) {
  const pool = await getPool();
  if (!pool) return [];

  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedTenantId || !normalizedEmail) return [];

  const revokedFilter = includeRevoked ? "" : "AND revoked_at IS NULL";
  const result = await pool.query(
    `SELECT session_id, issued_at, expires_at, last_seen_at,
            step_up_at, step_up_method, revoked_at, revoked_reason, user_agent
     FROM buyer_sessions
     WHERE tenant_id = $1 AND email = $2 ${revokedFilter}
     ORDER BY issued_at DESC
     LIMIT 50`,
    [normalizedTenantId, normalizedEmail],
  );

  return result.rows.map((row) => ({
    sessionId: row.session_id,
    issuedAt: row.issued_at?.toISOString?.() ?? row.issued_at,
    expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at,
    lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at,
    stepUpAt: row.step_up_at?.toISOString?.() ?? row.step_up_at,
    stepUpMethod: row.step_up_method,
    revokedAt: row.revoked_at?.toISOString?.() ?? row.revoked_at,
    revokedReason: row.revoked_reason,
    userAgent: row.user_agent,
  }));
}

/**
 * Revoke a buyer session.
 */
export async function revokeBuyerSession({ tenantId, email, sessionId, reason = null } = {}) {
  const pool = await getPool();
  if (!pool) return null;

  const result = await pool.query(
    `UPDATE buyer_sessions
     SET revoked_at = now(), revoked_reason = $4
     WHERE tenant_id = $1 AND email = $2 AND session_id = $3 AND revoked_at IS NULL
     RETURNING session_id, revoked_at, revoked_reason`,
    [String(tenantId ?? "").trim(), String(email ?? "").trim().toLowerCase(), String(sessionId ?? "").trim(), reason],
  );

  if (result.rowCount === 0) return null;
  return result.rows[0];
}

/**
 * Clean up expired sessions (run periodically).
 */
export async function cleanupExpiredSessions({ olderThanDays = 30 } = {}) {
  const pool = await getPool();
  if (!pool) return 0;

  const result = await pool.query(
    `DELETE FROM buyer_sessions
     WHERE (revoked_at IS NOT NULL AND revoked_at < now() - ($1 || ' days')::interval)
        OR (expires_at < now() - ($1 || ' days')::interval)`,
    [String(olderThanDays)],
  );

  return result.rowCount;
}

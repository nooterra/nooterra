/**
 * Buyer session records — dispatches to Postgres or filesystem.
 *
 * When DATABASE_URL is configured, sessions are stored in Postgres
 * (survives restarts, works multi-instance). Otherwise falls back
 * to the file-based store (local dev).
 *
 * The API surface is identical regardless of backend.
 */

import * as pgStore from "./buyer-session-store-pg.js";
import * as fsStore from "./buyer-session-records-fs.js";

function usePg() {
  return pgStore.isPostgresAvailable();
}

export async function createBuyerSessionRecord(opts = {}) {
  if (usePg()) {
    return pgStore.createBuyerSessionRecord(opts);
  }
  return fsStore.createBuyerSessionRecord(opts);
}

export async function listBuyerSessionRecords(opts = {}) {
  if (usePg()) {
    return pgStore.listBuyerSessionRecords(opts);
  }
  return fsStore.listBuyerSessionRecords(opts);
}

export async function getBuyerSessionRecord(opts = {}) {
  if (usePg()) {
    // Postgres store uses validateBuyerSession for single-record lookup
    const session = await pgStore.validateBuyerSession({
      sessionId: opts.sessionId,
      tenantId: opts.tenantId,
    });
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
      lastSeenAt: session.issuedAt,
      stepUpAt: null,
      stepUpMethod: null,
      revokedAt: null,
      revokedReason: null,
      userAgent: "",
    };
  }
  return fsStore.getBuyerSessionRecord(opts);
}

export async function touchBuyerSessionRecord(opts = {}) {
  if (usePg()) {
    // Postgres store updates last_seen_at automatically on validation
    const pool = await pgStore.getPool();
    if (pool) {
      await pool.query(
        `UPDATE buyer_sessions SET last_seen_at = now()
         WHERE session_id = $1 AND tenant_id = $2 AND email = $3`,
        [opts.sessionId, opts.tenantId, String(opts.email ?? "").toLowerCase()],
      );
      return { ok: true };
    }
  }
  return fsStore.touchBuyerSessionRecord(opts);
}

export async function markBuyerSessionStepUp(opts = {}) {
  if (usePg()) {
    const pool = await pgStore.getPool();
    if (pool) {
      await pool.query(
        `UPDATE buyer_sessions SET step_up_at = $4, step_up_method = $5
         WHERE session_id = $1 AND tenant_id = $2 AND email = $3`,
        [opts.sessionId, opts.tenantId, String(opts.email ?? "").toLowerCase(), opts.at || new Date().toISOString(), opts.method || "otp"],
      );
      return { ok: true };
    }
  }
  return fsStore.markBuyerSessionStepUp(opts);
}

export async function revokeBuyerSessionRecord(opts = {}) {
  if (usePg()) {
    const result = await pgStore.revokeBuyerSession({
      tenantId: opts.tenantId,
      email: opts.email,
      sessionId: opts.sessionId,
      reason: opts.reason,
    });
    if (result) return { ok: true, session: result };
    return { ok: false, error: "SESSION_NOT_FOUND" };
  }
  return fsStore.revokeBuyerSessionRecord(opts);
}

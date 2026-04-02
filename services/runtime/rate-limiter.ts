/**
 * Rate Limiter — global, per-tenant, and per-worker execution throttling.
 * Extracted from server.js. Used by both scheduler and execution loop.
 */

// ---------------------------------------------------------------------------
// Global rate limit
// ---------------------------------------------------------------------------

const RATE_LIMIT = {
  maxPerMinute: parseInt(process.env.MAX_CALLS_PER_MINUTE || '30', 10),
  callsThisMinute: 0,
  resetAt: Date.now() + 60000,
};

export function canCallOpenRouter(): boolean {
  const now = Date.now();
  if (now > RATE_LIMIT.resetAt) {
    RATE_LIMIT.callsThisMinute = 0;
    RATE_LIMIT.resetAt = now + 60000;
  }
  if (RATE_LIMIT.callsThisMinute >= RATE_LIMIT.maxPerMinute) return false;
  RATE_LIMIT.callsThisMinute++;
  return true;
}

// ---------------------------------------------------------------------------
// Per-tenant rate limit
// ---------------------------------------------------------------------------

const TENANT_MAX_PER_MINUTE = parseInt(process.env.TENANT_MAX_PER_MINUTE || '10', 10);
const tenantCallCounts = new Map<string, { count: number; resetAt: number }>();

export function canTenantCall(tenantId: string): boolean {
  const now = Date.now();
  let entry = tenantCallCounts.get(tenantId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60000 };
    tenantCallCounts.set(tenantId, entry);
  }
  if (entry.count >= TENANT_MAX_PER_MINUTE) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Per-worker spam throttle
// ---------------------------------------------------------------------------

const workerExecHistory = new Map<string, { timestamps: number[]; throttledUntil: number }>();

export function isWorkerThrottled(workerId: string): boolean {
  const now = Date.now();
  const entry = workerExecHistory.get(workerId);
  if (!entry) return false;

  // Currently throttled?
  if (entry.throttledUntil && now < entry.throttledUntil) return true;

  // Clean old timestamps (keep last 10 min)
  entry.timestamps = entry.timestamps.filter(ts => now - ts < 600000);

  // More than 20 executions in 10 minutes = throttle for 5 minutes
  if (entry.timestamps.length >= 20) {
    entry.throttledUntil = now + 300000; // 5 min cooldown
    return true;
  }

  return false;
}

export function recordWorkerExec(workerId: string): void {
  if (!workerExecHistory.has(workerId)) {
    workerExecHistory.set(workerId, { timestamps: [], throttledUntil: 0 });
  }
  workerExecHistory.get(workerId)!.timestamps.push(Date.now());
}

// ---------------------------------------------------------------------------
// Constants used by execution loop
// ---------------------------------------------------------------------------

/** Per-execution cost ceiling — kill any run that exceeds this */
export const EXECUTION_COST_CAP = parseFloat(process.env.EXECUTION_COST_CAP || '0.50');

/** Per-tool execution timeout in ms */
export const TOOL_TIMEOUT_MS = 15000;

/** Max tool result size before truncation (bytes) */
export const MAX_TOOL_RESULT_SIZE = 50000;

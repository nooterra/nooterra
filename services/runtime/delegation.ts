/**
 * Delegation — multi-agent task delegation with trust attenuation.
 *
 * Agents can delegate subtasks to other agents. The child agent receives
 * a subset of the parent's capabilities (trust attenuates through the chain).
 * Results flow back up when the child completes.
 */

import type { DelegationGrant } from "./types.ts";

// ── Helpers ─────────────────────────────────────────────

function makeId(): string {
  return `grant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function execId(): string {
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── attenuateCapabilities ───────────────────────────────

/**
 * Trust attenuation: child can only get capabilities the parent has.
 * Returns the intersection. If parentCapabilities is empty (full access),
 * returns requestedCapabilities as-is.
 */
export function attenuateCapabilities(
  parentCapabilities: string[],
  requestedCapabilities: string[],
): string[] {
  if (parentCapabilities.length === 0) return requestedCapabilities;
  return requestedCapabilities.filter((c) => parentCapabilities.includes(c));
}

// ── createDelegation ────────────────────────────────────

export async function createDelegation(
  pool: any,
  parentWorkerId: string,
  childWorkerId: string,
  tenantId: string,
  opts: {
    capabilities: string[];
    taskDescription: string;
    maxDepth?: number;
    maxCostUsd?: number;
    expiresInMinutes?: number;
  },
): Promise<DelegationGrant> {
  const maxDepth = opts.maxDepth ?? 1;
  if (maxDepth < 1) {
    throw new Error("max_depth must be >= 1");
  }

  // Load parent worker's capabilities from charter
  const { rows: parentRows } = await pool.query(
    `SELECT charter FROM workers WHERE id = $1`,
    [parentWorkerId],
  );
  if (parentRows.length === 0) {
    throw new Error(`Parent worker ${parentWorkerId} not found`);
  }

  const charter =
    typeof parentRows[0].charter === "string"
      ? JSON.parse(parentRows[0].charter)
      : parentRows[0].charter;

  // Extract parent capabilities from charter.capabilities keys or charter.canDo
  let parentCapabilities: string[] = [];
  if (charter?.capabilities && typeof charter.capabilities === "object") {
    parentCapabilities = Object.keys(charter.capabilities);
  } else if (Array.isArray(charter?.canDo)) {
    parentCapabilities = charter.canDo;
  }

  // Attenuate: child capabilities = intersection of parent's and requested
  const grantedCapabilities = attenuateCapabilities(
    parentCapabilities,
    opts.capabilities,
  );

  const id = makeId();
  const expiresAt = opts.expiresInMinutes
    ? new Date(Date.now() + opts.expiresInMinutes * 60_000).toISOString()
    : null;

  const { rows } = await pool.query(
    `INSERT INTO delegation_grants
       (id, parent_worker_id, child_worker_id, tenant_id, status,
        granted_capabilities, max_depth, max_cost_usd, expires_at, task_description,
        created_at)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, now())
     RETURNING *`,
    [
      id,
      parentWorkerId,
      childWorkerId,
      tenantId,
      grantedCapabilities,
      maxDepth,
      opts.maxCostUsd ?? null,
      expiresAt,
      opts.taskDescription,
    ],
  );

  // Create a queued execution for the child worker, linked to the grant
  const eid = execId();
  const activity = JSON.stringify([
    {
      ts: new Date().toISOString(),
      type: "delegation",
      detail: `Delegated from worker ${parentWorkerId}: ${opts.taskDescription}`,
    },
  ]);

  await pool.query(
    `INSERT INTO worker_executions
       (id, worker_id, tenant_id, trigger_type, status, started_at, activity, grant_id)
     VALUES ($1, $2, $3, 'delegation', 'queued', now(), $4::jsonb, $5)`,
    [eid, childWorkerId, tenantId, activity, id],
  );

  return rows[0] as DelegationGrant;
}

// ── completeDelegation ──────────────────────────────────

export async function completeDelegation(
  pool: any,
  grantId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE delegation_grants
     SET status = 'completed', result = $2, completed_at = now()
     WHERE id = $1 AND status = 'active'`,
    [grantId, JSON.stringify(result)],
  );
  if (rowCount === 0) {
    throw new Error(`Grant ${grantId} not found or not active`);
  }
}

// ── revokeDelegation ────────────────────────────────────

export async function revokeDelegation(
  pool: any,
  grantId: string,
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE delegation_grants
     SET status = 'revoked', completed_at = now()
     WHERE id = $1 AND status = 'active'`,
    [grantId],
  );
  if (rowCount === 0) {
    throw new Error(`Grant ${grantId} not found or not active`);
  }
}

// ── getActiveDelegationsFrom ────────────────────────────

export async function getActiveDelegationsFrom(
  pool: any,
  workerId: string,
): Promise<DelegationGrant[]> {
  const { rows } = await pool.query(
    `SELECT * FROM delegation_grants
     WHERE parent_worker_id = $1 AND status = 'active'
     ORDER BY created_at DESC`,
    [workerId],
  );
  return rows;
}

// ── getActiveDelegationsTo ──────────────────────────────

export async function getActiveDelegationsTo(
  pool: any,
  workerId: string,
): Promise<DelegationGrant[]> {
  const { rows } = await pool.query(
    `SELECT * FROM delegation_grants
     WHERE child_worker_id = $1 AND status = 'active'
     ORDER BY created_at DESC`,
    [workerId],
  );
  return rows;
}

// ── getDelegationChain ──────────────────────────────────

/**
 * Walk the delegation chain from a grant back to its root.
 * Returns array of grants from the given grant up to the root delegator.
 */
export async function getDelegationChain(
  pool: any,
  grantId: string,
): Promise<DelegationGrant[]> {
  const chain: DelegationGrant[] = [];
  let currentGrantId: string | null = grantId;

  // Safety: max 20 hops to prevent infinite loops
  for (let i = 0; i < 20 && currentGrantId; i++) {
    const { rows } = await pool.query(
      `SELECT * FROM delegation_grants WHERE id = $1`,
      [currentGrantId],
    );
    if (rows.length === 0) break;

    const grant = rows[0] as DelegationGrant;
    chain.push(grant);

    // Find if the parent worker itself was delegated to via an active execution
    const { rows: execRows } = await pool.query(
      `SELECT grant_id FROM worker_executions
       WHERE worker_id = $1 AND grant_id IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
      [grant.parent_worker_id],
    );

    currentGrantId = execRows.length > 0 ? execRows[0].grant_id : null;
  }

  return chain;
}

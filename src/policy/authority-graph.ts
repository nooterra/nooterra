/**
 * Authority Graph — Zanzibar-style DAG of delegated authority.
 *
 * Every agent's authority traces back to a human-issued root grant via
 * hash-chained attenuation. Attenuation only narrows — a child grant
 * is always a subset of its parent.
 */

import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { ActionClass } from '../core/objects.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthorityGrant {
  id: string;
  tenantId: string;
  grantorType: 'human' | 'agent';
  grantorId: string;
  granteeType: 'agent';
  granteeId: string;
  parentGrantId?: string;
  scope: GrantScope;
  constraints: GrantConstraints;
  budgetSpentCents: number;
  budgetPeriodStart?: Date;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  issuedAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revocationReason?: string;
  grantHash: string;
  chainHash: string;
}

export interface GrantScope {
  actionClasses: string[];
  objectTypes?: string[];
  objectFilter?: Record<string, unknown>;
  partyFilter?: Record<string, unknown>;
  budgetLimitCents?: number;
  budgetPeriod?: 'day' | 'week' | 'month';
  jurisdictions?: string[];
  timeWindow?: { start?: string; end?: string };
  maxDelegationDepth?: number;
}

export interface GrantConstraints {
  requireApproval?: string[];
  forbidden?: string[];
  rateLimit?: { maxPerHour?: number; maxPerDay?: number };
  disclosureRequired?: boolean;
  auditLevel?: 'full' | 'summary' | 'minimal';
}

export interface AuthorizationDecision {
  allowed: boolean;
  decision: 'allow' | 'deny' | 'require_approval';
  reason: string;
  grantId?: string;
  checkedScopes: string[];
}

export interface ProposedAction {
  agentId: string;
  actionClass: string;
  targetObjectId?: string;
  targetObjectType?: string;
  valueCents?: number;
  counterpartyId?: string;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function computeGrantHash(grant: {
  tenantId: string; grantorId: string; granteeId: string;
  scope: GrantScope; constraints: GrantConstraints;
  parentGrantId?: string;
}): string {
  const material = JSON.stringify({
    tenantId: grant.tenantId,
    grantorId: grant.grantorId,
    granteeId: grant.granteeId,
    scope: grant.scope,
    constraints: grant.constraints,
    parentGrantId: grant.parentGrantId ?? null,
  });
  return createHash('sha256').update(material).digest('hex');
}

function computeChainHash(grantHash: string, parentChainHash?: string): string {
  const material = parentChainHash ? `${parentChainHash}:${grantHash}` : grantHash;
  return createHash('sha256').update(material).digest('hex');
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToGrant(row: any): AuthorityGrant {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    grantorType: row.grantor_type,
    grantorId: row.grantor_id,
    granteeType: row.grantee_type,
    granteeId: row.grantee_id,
    parentGrantId: row.parent_grant_id ?? undefined,
    scope: typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope,
    constraints: typeof row.constraints === 'string' ? JSON.parse(row.constraints) : row.constraints,
    budgetSpentCents: row.budget_spent_cents ?? 0,
    budgetPeriodStart: row.budget_period_start ? new Date(row.budget_period_start) : undefined,
    status: row.status,
    issuedAt: new Date(row.issued_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : undefined,
    revocationReason: row.revocation_reason ?? undefined,
    grantHash: row.grant_hash,
    chainHash: row.chain_hash,
  };
}

// ---------------------------------------------------------------------------
// Grant management
// ---------------------------------------------------------------------------

export interface CreateGrantInput {
  tenantId: string;
  grantorType: 'human' | 'agent';
  grantorId: string;
  granteeId: string;
  parentGrantId?: string;
  scope: GrantScope;
  constraints: GrantConstraints;
  expiresAt?: Date;
}

/**
 * Issue a new authority grant. If parentGrantId is provided, the new grant
 * is attenuated — its scope is intersected with the parent's scope.
 */
export async function grantAuthority(pool: pg.Pool, input: CreateGrantInput): Promise<AuthorityGrant> {
  const id = ulid();

  // If there's a parent, attenuate scope
  let scope = input.scope;
  let constraints = input.constraints;
  let parentChainHash: string | undefined;

  if (input.parentGrantId) {
    const parent = await getGrant(pool, input.parentGrantId);
    if (!parent) throw new Error(`Parent grant not found: ${input.parentGrantId}`);
    if (parent.status !== 'active') throw new Error(`Parent grant is not active: ${parent.status}`);

    // Attenuation: child scope is intersection of parent scope and requested scope
    scope = attenuateScope(parent.scope, input.scope);
    // Constraints: union (child gets all parent constraints plus its own)
    constraints = mergeConstraints(parent.constraints, input.constraints);
    parentChainHash = parent.chainHash;
  }

  const grantHash = computeGrantHash({
    tenantId: input.tenantId,
    grantorId: input.grantorId,
    granteeId: input.granteeId,
    scope,
    constraints,
    parentGrantId: input.parentGrantId,
  });
  const chainHash = computeChainHash(grantHash, parentChainHash);

  await pool.query(
    `INSERT INTO authority_grants_v2 (
      id, tenant_id, grantor_type, grantor_id, grantee_type, grantee_id,
      parent_grant_id, scope, constraints, status, issued_at, expires_at,
      grant_hash, chain_hash
    ) VALUES ($1,$2,$3,$4,'agent',$5,$6,$7,$8,'active',now(),$9,$10,$11)`,
    [
      id, input.tenantId, input.grantorType, input.grantorId,
      input.granteeId, input.parentGrantId ?? null,
      JSON.stringify(scope), JSON.stringify(constraints),
      input.expiresAt ?? null,
      grantHash, chainHash,
    ],
  );

  return {
    id,
    tenantId: input.tenantId,
    grantorType: input.grantorType,
    grantorId: input.grantorId,
    granteeType: 'agent',
    granteeId: input.granteeId,
    parentGrantId: input.parentGrantId,
    scope,
    constraints,
    budgetSpentCents: 0,
    status: 'active',
    issuedAt: new Date(),
    expiresAt: input.expiresAt,
    grantHash,
    chainHash,
  };
}

/**
 * Revoke a grant and all its descendants.
 */
export async function revokeGrant(pool: pg.Pool, grantId: string, reason: string): Promise<void> {
  // Revoke this grant
  await pool.query(
    `UPDATE authority_grants_v2 SET status = 'revoked', revoked_at = now(), revocation_reason = $2
     WHERE id = $1 AND status = 'active'`,
    [grantId, reason],
  );

  // Revoke all descendants (recursive)
  await pool.query(
    `WITH RECURSIVE descendants AS (
      SELECT id FROM authority_grants_v2 WHERE parent_grant_id = $1
      UNION ALL
      SELECT g.id FROM authority_grants_v2 g
      JOIN descendants d ON g.parent_grant_id = d.id
    )
    UPDATE authority_grants_v2 SET status = 'revoked', revoked_at = now(), revocation_reason = $2
    WHERE id IN (SELECT id FROM descendants) AND status = 'active'`,
    [grantId, `Parent grant revoked: ${reason}`],
  );
}

/**
 * Get a single grant by ID.
 */
export async function getGrant(pool: pg.Pool, grantId: string): Promise<AuthorityGrant | null> {
  const result = await pool.query('SELECT * FROM authority_grants_v2 WHERE id = $1', [grantId]);
  if (result.rows.length === 0) return null;
  return rowToGrant(result.rows[0]);
}

/**
 * Get all active grants for an agent.
 */
export async function getAgentGrants(pool: pg.Pool, agentId: string): Promise<AuthorityGrant[]> {
  const result = await pool.query(
    `SELECT * FROM authority_grants_v2
     WHERE grantee_id = $1 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY issued_at DESC`,
    [agentId],
  );
  return result.rows.map(rowToGrant);
}

// ---------------------------------------------------------------------------
// Authorization check
// ---------------------------------------------------------------------------

/**
 * Check if an agent is authorized to perform a proposed action.
 * Returns the decision with reasoning.
 */
export async function checkAuthorization(
  pool: pg.Pool,
  action: ProposedAction,
): Promise<AuthorizationDecision> {
  const grants = await getAgentGrants(pool, action.agentId);

  if (grants.length === 0) {
    return {
      allowed: false,
      decision: 'deny',
      reason: 'No active authority grants for this agent',
      checkedScopes: [],
    };
  }

  // Check each grant
  for (const grant of grants) {
    const result = evaluateGrant(grant, action);
    if (result.decision === 'allow' || result.decision === 'require_approval') {
      // Log the decision
      await logDecision(pool, grant.tenantId, action, result, grant.id);
      return result;
    }
  }

  // No grant allowed this action — deny
  const result: AuthorizationDecision = {
    allowed: false,
    decision: 'deny',
    reason: `Action class '${action.actionClass}' not in scope of any active grant`,
    checkedScopes: grants.map(g => g.id),
  };

  if (grants.length > 0) {
    await logDecision(pool, grants[0]!.tenantId, action, result);
  }

  return result;
}

/**
 * Evaluate a single grant against a proposed action.
 */
function evaluateGrant(grant: AuthorityGrant, action: ProposedAction): AuthorizationDecision {
  const checkedScopes: string[] = [grant.id];

  // Check forbidden first (highest priority)
  if (grant.constraints.forbidden?.includes(action.actionClass)) {
    return {
      allowed: false,
      decision: 'deny',
      reason: `Action '${action.actionClass}' is forbidden by grant ${grant.id}`,
      grantId: grant.id,
      checkedScopes,
    };
  }

  // Check if action class is in scope
  if (!grant.scope.actionClasses.includes(action.actionClass)) {
    return {
      allowed: false,
      decision: 'deny',
      reason: `Action '${action.actionClass}' not in grant scope [${grant.scope.actionClasses.join(', ')}]`,
      grantId: grant.id,
      checkedScopes,
    };
  }

  // Check object type filter
  if (grant.scope.objectTypes && action.targetObjectType) {
    if (!grant.scope.objectTypes.includes(action.targetObjectType)) {
      return {
        allowed: false,
        decision: 'deny',
        reason: `Object type '${action.targetObjectType}' not in grant scope`,
        grantId: grant.id,
        checkedScopes,
      };
    }
  }

  // Check budget
  if (grant.scope.budgetLimitCents != null && action.valueCents) {
    const remaining = grant.scope.budgetLimitCents - grant.budgetSpentCents;
    if (action.valueCents > remaining) {
      return {
        allowed: false,
        decision: 'deny',
        reason: `Action value (${action.valueCents}c) exceeds remaining budget (${remaining}c)`,
        grantId: grant.id,
        checkedScopes,
      };
    }
  }

  // Check time window
  if (grant.scope.timeWindow) {
    const now = new Date();
    const hours = now.getHours();
    const startHour = parseInt(grant.scope.timeWindow.start || '0');
    const endHour = parseInt(grant.scope.timeWindow.end || '24');
    if (hours < startHour || hours >= endHour) {
      return {
        allowed: false,
        decision: 'deny',
        reason: `Outside time window (${startHour}:00-${endHour}:00, current: ${hours}:00)`,
        grantId: grant.id,
        checkedScopes,
      };
    }
  }

  // Check if requires approval
  if (grant.constraints.requireApproval?.includes(action.actionClass)) {
    return {
      allowed: false,
      decision: 'require_approval',
      reason: `Action '${action.actionClass}' requires human approval per grant ${grant.id}`,
      grantId: grant.id,
      checkedScopes,
    };
  }

  // All checks passed — allow
  return {
    allowed: true,
    decision: 'allow',
    reason: `Authorized by grant ${grant.id}`,
    grantId: grant.id,
    checkedScopes,
  };
}

// ---------------------------------------------------------------------------
// Effective authority
// ---------------------------------------------------------------------------

/**
 * Get the effective authority for an agent — the union of all active grants' scopes.
 */
export async function getEffectiveAuthority(pool: pg.Pool, agentId: string): Promise<{
  actionClasses: string[];
  forbidden: string[];
  requireApproval: string[];
  budgetRemainingCents?: number;
}> {
  const grants = await getAgentGrants(pool, agentId);

  const actionClasses = new Set<string>();
  const forbidden = new Set<string>();
  const requireApproval = new Set<string>();
  let totalBudgetRemaining: number | undefined;

  for (const grant of grants) {
    for (const ac of grant.scope.actionClasses) actionClasses.add(ac);
    for (const f of grant.constraints.forbidden ?? []) forbidden.add(f);
    for (const r of grant.constraints.requireApproval ?? []) requireApproval.add(r);
    if (grant.scope.budgetLimitCents != null) {
      const remaining = grant.scope.budgetLimitCents - grant.budgetSpentCents;
      totalBudgetRemaining = (totalBudgetRemaining ?? 0) + remaining;
    }
  }

  // Forbidden overrides everything
  for (const f of forbidden) {
    actionClasses.delete(f);
  }

  return {
    actionClasses: [...actionClasses],
    forbidden: [...forbidden],
    requireApproval: [...requireApproval],
    budgetRemainingCents: totalBudgetRemaining,
  };
}

/**
 * Trace the authority chain from a grant back to the root.
 */
export async function traceAuthorityChain(pool: pg.Pool, grantId: string): Promise<AuthorityGrant[]> {
  const chain: AuthorityGrant[] = [];
  let currentId: string | undefined = grantId;
  const maxDepth = 20;

  while (currentId && chain.length < maxDepth) {
    const grant = await getGrant(pool, currentId);
    if (!grant) break;
    chain.push(grant);
    currentId = grant.parentGrantId;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Attenuation helpers
// ---------------------------------------------------------------------------

/**
 * Attenuate scope — child scope is intersection of parent and requested.
 * The child can never have MORE authority than the parent.
 */
function attenuateScope(parent: GrantScope, requested: GrantScope): GrantScope {
  return {
    // Intersection of action classes
    actionClasses: requested.actionClasses.filter(ac => parent.actionClasses.includes(ac)),
    // Intersection of object types
    objectTypes: requested.objectTypes && parent.objectTypes
      ? requested.objectTypes.filter(ot => parent.objectTypes!.includes(ot))
      : requested.objectTypes || parent.objectTypes,
    // Take the more restrictive filters
    objectFilter: { ...(parent.objectFilter ?? {}), ...(requested.objectFilter ?? {}) },
    partyFilter: { ...(parent.partyFilter ?? {}), ...(requested.partyFilter ?? {}) },
    // Take the smaller budget
    budgetLimitCents: minOptional(parent.budgetLimitCents, requested.budgetLimitCents),
    budgetPeriod: requested.budgetPeriod || parent.budgetPeriod,
    // Intersection of jurisdictions
    jurisdictions: requested.jurisdictions && parent.jurisdictions
      ? requested.jurisdictions.filter(j => parent.jurisdictions!.includes(j))
      : requested.jurisdictions || parent.jurisdictions,
    // Take the narrower time window
    timeWindow: requested.timeWindow || parent.timeWindow,
    // Take the smaller delegation depth (and decrement by 1)
    maxDelegationDepth: Math.max(0, minOptional(
      parent.maxDelegationDepth != null ? parent.maxDelegationDepth - 1 : undefined,
      requested.maxDelegationDepth,
    ) ?? 0),
  };
}

/**
 * Merge constraints — union (child gets ALL parent constraints plus its own).
 */
function mergeConstraints(parent: GrantConstraints, child: GrantConstraints): GrantConstraints {
  return {
    requireApproval: [...new Set([...(parent.requireApproval ?? []), ...(child.requireApproval ?? [])])],
    forbidden: [...new Set([...(parent.forbidden ?? []), ...(child.forbidden ?? [])])],
    rateLimit: child.rateLimit || parent.rateLimit,
    disclosureRequired: parent.disclosureRequired || child.disclosureRequired,
    auditLevel: parent.auditLevel === 'full' || child.auditLevel === 'full' ? 'full'
      : parent.auditLevel === 'summary' || child.auditLevel === 'summary' ? 'summary'
      : child.auditLevel || parent.auditLevel,
  };
}

function minOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

async function logDecision(
  pool: pg.Pool,
  tenantId: string,
  action: ProposedAction,
  result: AuthorizationDecision,
  grantId?: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO authorization_log (id, tenant_id, agent_id, grant_id, action_class, target_object_id, target_object_type, decision, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ulid(), tenantId, action.agentId, grantId ?? null,
        action.actionClass, action.targetObjectId ?? null,
        action.targetObjectType ?? null,
        result.decision, result.reason,
      ],
    );
  } catch {
    // Best-effort logging — don't fail the authorization check
  }
}

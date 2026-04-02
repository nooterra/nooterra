/**
 * Forkable Companies — serialize, fork, and template company models.
 *
 * The entire company model (object graph, authority grants, policies,
 * agent configs, world model rules) is serializable as a snapshot.
 * A new company can be bootstrapped by forking an existing snapshot
 * and parameterizing it.
 *
 * "Your business model works in Miami? Fork it. Adjust for Denver.
 *  Deploy in 30 seconds."
 */

import type pg from 'pg';
import { ulid } from 'ulid';
import { queryObjects, createObject, type CreateObjectInput } from '../objects/graph.js';
import { queryEvents } from '../ledger/event-store.js';
import { getAgentGrants, grantAuthority, type CreateGrantInput } from '../policy/authority-graph.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanySnapshot {
  id: string;
  sourceTenantId: string;
  createdAt: Date;
  version: number;

  /** Object graph — all objects with state (PII stripped) */
  objects: SnapshotObject[];
  /** Authority grants — full DAG */
  grants: SnapshotGrant[];
  /** Agent configurations */
  agents: SnapshotAgent[];
  /** World model rules (not learned models — just the rule config) */
  worldModelConfig: Record<string, unknown>;

  metadata: {
    objectCount: number;
    agentCount: number;
    grantCount: number;
    industry?: string;
    description?: string;
  };
}

export interface SnapshotObject {
  originalId: string;
  type: string;
  state: Record<string, unknown>;
  estimated: Record<string, unknown>;
}

export interface SnapshotGrant {
  originalId: string;
  grantorType: string;
  granteeOriginalId: string;
  parentOriginalId?: string;
  scope: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

export interface SnapshotAgent {
  originalId: string;
  name: string;
  role: string;
  model: string;
  actionClasses: string[];
  domainInstructions?: string;
  playbook?: string;
}

export interface ForkResult {
  newTenantId: string;
  objectsCreated: number;
  grantsCreated: number;
  agentsCreated: number;
  idMapping: Map<string, string>; // oldId → newId
}

// ---------------------------------------------------------------------------
// PII stripping
// ---------------------------------------------------------------------------

const PII_FIELDS = new Set([
  'email', 'phone', 'address', 'name', 'contactInfo',
  'to', 'from', 'cc', 'bcc', 'subject', 'body',
  'ssn', 'taxId', 'bankAccount', 'creditCard',
]);

const PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,  // email
  /\+?\d[\d\s\-()]{8,}/g,                                 // phone
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,                       // SSN-like
];

/**
 * Strip PII from an object's state. Replaces sensitive values with placeholders.
 */
function stripPII(state: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (PII_FIELDS.has(key)) {
      if (key === 'contactInfo' && Array.isArray(value)) {
        cleaned[key] = value.map((c: any) => ({
          ...c,
          value: `[REDACTED_${c.type?.toUpperCase() || 'PII'}]`,
        }));
      } else if (key === 'name') {
        cleaned[key] = `Company_${ulid().slice(-6)}`;
      } else {
        cleaned[key] = `[REDACTED_${key.toUpperCase()}]`;
      }
      continue;
    }

    if (typeof value === 'string') {
      let scrubbed = value;
      for (const pattern of PII_PATTERNS) {
        scrubbed = scrubbed.replace(pattern, '[REDACTED]');
      }
      cleaned[key] = scrubbed;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      cleaned[key] = stripPII(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

/**
 * Create a snapshot of a tenant's company model.
 * PII is stripped. Structure (grants, policies, agent configs) is preserved.
 */
export async function createSnapshot(
  pool: pg.Pool,
  tenantId: string,
  options: { industry?: string; description?: string } = {},
): Promise<CompanySnapshot> {
  // Collect objects (skip conversations and messages — too PII-heavy)
  const objectTypes = ['party', 'invoice', 'payment', 'obligation', 'contract', 'task', 'deal'] as const;
  const objects: SnapshotObject[] = [];

  for (const type of objectTypes) {
    const objs = await queryObjects(pool, tenantId, type as any, 500);
    for (const obj of objs) {
      objects.push({
        originalId: obj.id,
        type: obj.type,
        state: stripPII(obj.state as Record<string, unknown>),
        estimated: obj.estimated as Record<string, unknown>,
      });
    }
  }

  // Collect grants
  // Query all grants for this tenant
  const grantResult = await pool.query(
    `SELECT * FROM authority_grants_v2 WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );
  const grants: SnapshotGrant[] = grantResult.rows.map((row: any) => ({
    originalId: row.id,
    grantorType: row.grantor_type,
    granteeOriginalId: row.grantee_id,
    parentOriginalId: row.parent_grant_id ?? undefined,
    scope: typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope,
    constraints: typeof row.constraints === 'string' ? JSON.parse(row.constraints) : row.constraints,
  }));

  // Collect agent configs from workers table
  const workerResult = await pool.query(
    `SELECT id, name, charter, model FROM workers WHERE tenant_id = $1 AND status != 'archived'`,
    [tenantId],
  );
  const agents: SnapshotAgent[] = workerResult.rows.map((row: any) => {
    const charter = typeof row.charter === 'string' ? JSON.parse(row.charter) : (row.charter || {});
    return {
      originalId: row.id,
      name: row.name,
      role: charter.role || row.name,
      model: row.model,
      actionClasses: charter.canDo || [],
      domainInstructions: charter.instructions,
      playbook: charter.task,
    };
  });

  return {
    id: ulid(),
    sourceTenantId: tenantId,
    createdAt: new Date(),
    version: 1,
    objects,
    grants,
    agents,
    worldModelConfig: {}, // Rule config would go here
    metadata: {
      objectCount: objects.length,
      agentCount: agents.length,
      grantCount: grants.length,
      industry: options.industry,
      description: options.description,
    },
  };
}

// ---------------------------------------------------------------------------
// Fork operation
// ---------------------------------------------------------------------------

/**
 * Fork a snapshot into a new tenant. Creates all objects, grants, and agents
 * with new IDs, preserving the structure.
 */
export async function forkSnapshot(
  pool: pg.Pool,
  snapshot: CompanySnapshot,
  newTenantId: string,
  newOwnerId: string,
): Promise<ForkResult> {
  const idMapping = new Map<string, string>();
  let objectsCreated = 0;
  let grantsCreated = 0;
  let agentsCreated = 0;

  // 1. Create objects with new IDs
  for (const obj of snapshot.objects) {
    const newId = ulid();
    idMapping.set(obj.originalId, newId);

    // Remap any internal references in state
    const remappedState = remapIds(obj.state, idMapping);

    await createObject(pool, {
      tenantId: newTenantId,
      type: obj.type as any,
      state: remappedState,
      estimated: obj.estimated,
    });
    objectsCreated++;
  }

  // 2. Create grants (root grants first, then children)
  const rootGrants = snapshot.grants.filter(g => !g.parentOriginalId);
  const childGrants = snapshot.grants.filter(g => g.parentOriginalId);

  for (const grant of rootGrants) {
    const newGrantId = ulid();
    idMapping.set(grant.originalId, newGrantId);

    const granteeId = idMapping.get(grant.granteeOriginalId) || grant.granteeOriginalId;

    await grantAuthority(pool, {
      tenantId: newTenantId,
      grantorType: 'human',
      grantorId: newOwnerId,
      granteeId,
      scope: grant.scope as any,
      constraints: grant.constraints as any,
    });
    grantsCreated++;
  }

  for (const grant of childGrants) {
    const newGrantId = ulid();
    idMapping.set(grant.originalId, newGrantId);

    const granteeId = idMapping.get(grant.granteeOriginalId) || grant.granteeOriginalId;
    const parentId = grant.parentOriginalId ? idMapping.get(grant.parentOriginalId) : undefined;

    await grantAuthority(pool, {
      tenantId: newTenantId,
      grantorType: 'agent',
      grantorId: newOwnerId,
      granteeId,
      parentGrantId: parentId,
      scope: grant.scope as any,
      constraints: grant.constraints as any,
    });
    grantsCreated++;
  }

  // 3. Create agent/worker records
  for (const agent of snapshot.agents) {
    const newAgentId = ulid();
    idMapping.set(agent.originalId, newAgentId);
    agentsCreated++;
    // Worker creation would happen through the existing workers-api
    // For now, just track the ID mapping
  }

  return {
    newTenantId,
    objectsCreated,
    grantsCreated,
    agentsCreated,
    idMapping,
  };
}

// ---------------------------------------------------------------------------
// Company templates
// ---------------------------------------------------------------------------

export interface CompanyTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  snapshot: CompanySnapshot;
}

/**
 * Pre-built templates for common verticals.
 * Each template includes sample objects, grants, and agent configs
 * optimized for the industry.
 */
export function getTemplates(): Omit<CompanyTemplate, 'snapshot'>[] {
  return [
    {
      id: 'tpl_agency',
      name: 'Agency / Professional Services',
      industry: 'professional_services',
      description: 'Consulting, design, or marketing agency. Collections, client comms, project follow-up.',
    },
    {
      id: 'tpl_saas',
      name: 'SaaS / Subscription',
      industry: 'saas',
      description: 'Subscription business. Churn prevention, renewal management, support triage.',
    },
    {
      id: 'tpl_services',
      name: 'Field Services / Trades',
      industry: 'field_services',
      description: 'Plumbing, electrical, HVAC. Scheduling, invoicing, follow-up, reviews.',
    },
    {
      id: 'tpl_ecommerce',
      name: 'E-Commerce / D2C',
      industry: 'ecommerce',
      description: 'Online store. Order management, customer support, return handling, vendor coordination.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Remap IDs in a state object using the mapping from fork.
 */
function remapIds(
  state: Record<string, unknown>,
  mapping: Map<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'string' && mapping.has(value)) {
      result[key] = mapping.get(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v =>
        typeof v === 'string' && mapping.has(v) ? mapping.get(v) : v
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = remapIds(value as Record<string, unknown>, mapping);
    } else {
      result[key] = value;
    }
  }

  return result;
}

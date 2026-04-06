import { createCollectionsAgent, createCollectionsGrant } from '../agents/templates/ar-collections.js';
import { createDefaultArObjectives } from '../domains/ar/objectives.js';
import type { AgentConfig } from '../agents/runtime.js';
import type { CreateGrantInput } from '../policy/authority-graph.js';
import type { TenantObjectives } from './objectives.js';

export interface RoleMetric {
  key: string;
  label: string;
  direction: 'up' | 'down';
}

export interface RoleDefinition {
  id: string;
  name: string;
  defaultEmployeeName: string;
  description: string;
  requiredConnectors: string[];
  metrics: RoleMetric[];
  buildAgent(tenantId: string, agentId: string): AgentConfig;
  buildGrant(tenantId: string, grantorId: string, granteeId: string): CreateGrantInput;
  buildObjectives(tenantId: string): TenantObjectives;
}

const AR_COLLECTIONS: RoleDefinition = {
  id: 'ar-collections',
  name: 'Collections Specialist',
  defaultEmployeeName: 'Riley',
  description: 'Monitors overdue invoices, sends evidence-backed follow-ups, escalates when uncertain.',
  requiredConnectors: ['stripe'],
  metrics: [
    { key: 'realizedRecoveryCents', label: 'Recovered', direction: 'up' },
    { key: 'overdueCount', label: 'Overdue invoices', direction: 'down' },
    { key: 'approvalQueueDepth', label: 'Awaiting approval', direction: 'down' },
    { key: 'autonomyCoverage', label: 'Autonomy', direction: 'up' },
  ],
  buildAgent: createCollectionsAgent,
  buildGrant: createCollectionsGrant,
  buildObjectives: createDefaultArObjectives,
};

const ROLES: RoleDefinition[] = [AR_COLLECTIONS];
const ROLE_MAP = new Map(ROLES.map((r) => [r.id, r]));

export function listRoles(): RoleDefinition[] {
  return ROLES;
}

export function getRoleDefinition(id: string): RoleDefinition | null {
  return ROLE_MAP.get(id) ?? null;
}

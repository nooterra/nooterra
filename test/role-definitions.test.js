import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoleDefinition, listRoles } from '../src/core/role-definitions.ts';

test('listRoles returns ar-collections', () => {
  const roles = listRoles();
  assert.equal(roles.length, 1);
  assert.equal(roles[0].id, 'ar-collections');
  assert.equal(roles[0].name, 'Collections Specialist');
  assert.equal(roles[0].defaultEmployeeName, 'Riley');
  assert.deepStrictEqual(roles[0].requiredConnectors, ['stripe']);
});

test('getRoleDefinition returns null for unknown role', () => {
  assert.equal(getRoleDefinition('nonexistent'), null);
});

test('getRoleDefinition ar-collections has factory hooks', () => {
  const role = getRoleDefinition('ar-collections');
  assert.ok(role);
  assert.equal(typeof role.buildAgent, 'function');
  assert.equal(typeof role.buildGrant, 'function');
  assert.equal(typeof role.buildObjectives, 'function');
});

test('buildAgent produces valid AgentConfig', () => {
  const role = getRoleDefinition('ar-collections');
  const agent = role.buildAgent('tenant-1', 'agent-1');
  assert.equal(agent.id, 'agent-1');
  assert.equal(agent.tenantId, 'tenant-1');
  assert.equal(agent.role, 'Accounts Receivable Collections Specialist');
  assert.ok(agent.actionClasses.includes('communicate.email'));
});

test('buildGrant produces valid grant input', () => {
  const role = getRoleDefinition('ar-collections');
  const grant = role.buildGrant('tenant-1', 'grantor-1', 'grantee-1');
  assert.equal(grant.tenantId, 'tenant-1');
  assert.equal(grant.grantorId, 'grantor-1');
  assert.equal(grant.granteeId, 'grantee-1');
  assert.ok(grant.scope.actionClasses.includes('communicate.email'));
});

test('buildObjectives returns objectives AND constraints', () => {
  const role = getRoleDefinition('ar-collections');
  const objectives = role.buildObjectives('tenant-1');
  assert.equal(objectives.tenantId, 'tenant-1');
  assert.ok(objectives.objectives.length > 0);
  assert.ok(objectives.constraints.length > 0);
  assert.ok(objectives.constraints.includes('no_active_dispute_outreach'));
});

test('createCollectionsGrant accepts boundary overrides', async () => {
  const { createCollectionsGrant } = await import('../src/agents/templates/ar-collections.ts');
  const grant = createCollectionsGrant('tenant-1', 'grantor-1', 'grantee-1', {
    maxAutonomousAmountCents: 300000,
    maxContactsPerDay: 50,
  });

  assert.equal(grant.scope.objectFilter.amountCents.lt, 300000);
  assert.equal(grant.constraints.rateLimit.maxPerDay, 50);
});

test('createCollectionsGrant uses defaults when no overrides', async () => {
  const { createCollectionsGrant } = await import('../src/agents/templates/ar-collections.ts');
  const grant = createCollectionsGrant('tenant-1', 'grantor-1', 'grantee-1');
  assert.equal(grant.scope.objectFilter.amountCents.lt, 5000000);
  assert.equal(grant.constraints.rateLimit.maxPerDay, 100);
});

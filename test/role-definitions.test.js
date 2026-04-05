import { test } from 'node:test';
import assert from 'node:assert/strict';

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

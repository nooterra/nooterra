import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('action-registry.ts contains no AR-specific helpers', () => {
  const source = readFileSync('src/core/action-registry.ts', 'utf8');

  // These AR-specific identifiers must NOT appear in the core registry
  const arHelpers = [
    'getPrimaryEmail',
    'hasDisputeSignal',
    'requirePrimaryBillingContact',
    'blockActiveDisputes',
    'Collections email',
    'Human escalation',
    'Invoice read',
    'Strategic hold',
  ];

  for (const helper of arHelpers) {
    assert.equal(
      source.includes(helper),
      false,
      `action-registry.ts must not contain AR-specific identifier: "${helper}". AR logic belongs in src/domains/ar/actions.ts`,
    );
  }
});

test('action-registry.ts imports from domain pack', () => {
  const source = readFileSync('src/core/action-registry.ts', 'utf8');
  assert.ok(
    source.includes("from '../domains/ar/actions.js'") || source.includes("from '../domains/ar/actions.ts'"),
    'action-registry.ts must import AR_ACTION_TYPES from the domain pack',
  );
});

test('AR domain pack exports AR_ACTION_TYPES', async () => {
  const { AR_ACTION_TYPES } = await import('../src/domains/ar/actions.ts');
  assert.ok(AR_ACTION_TYPES, 'AR_ACTION_TYPES must be exported');
  assert.ok(typeof AR_ACTION_TYPES === 'object', 'must be an object');

  // Must contain all 5 AR action types
  const expectedIds = ['communicate.email', 'data.read', 'financial.invoice.read', 'strategic.hold', 'task.create'];
  const actualIds = Object.keys(AR_ACTION_TYPES).sort();
  assert.deepStrictEqual(actualIds, expectedIds);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('objectives-defaults.ts re-exports from domain pack', () => {
  const source = readFileSync('src/core/objectives-defaults.ts', 'utf8');
  assert.ok(
    source.includes("from '../domains/ar/objectives.js'") || source.includes("from '../domains/ar/objectives.ts'"),
    'objectives-defaults.ts must import from domain pack',
  );
});

test('AR domain pack exports objectives and constraints', async () => {
  const mod = await import('../src/domains/ar/objectives.ts');
  assert.ok(mod.DEFAULT_AR_OBJECTIVES, 'must export DEFAULT_AR_OBJECTIVES');
  assert.ok(mod.SUPPORTED_OBJECTIVE_CONSTRAINTS, 'must export SUPPORTED_OBJECTIVE_CONSTRAINTS');
  assert.ok(mod.createDefaultArObjectives, 'must export createDefaultArObjectives');
  assert.equal(mod.DEFAULT_AR_OBJECTIVES.length, 5);
  assert.equal(mod.SUPPORTED_OBJECTIVE_CONSTRAINTS.length, 5);
});

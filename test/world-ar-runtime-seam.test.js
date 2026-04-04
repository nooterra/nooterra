import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('world-runtime-routes.ts does not import AR collections agent directly', () => {
  const source = readFileSync('src/api/world-runtime-routes.ts', 'utf8');
  assert.equal(
    source.includes("from '../agents/templates/ar-collections"),
    false,
    'world-runtime-routes.ts must not import AR collections agent directly. Use domain pack.',
  );
});

test('AR runtime domain pack exports provisioning functions', async () => {
  const mod = await import('../src/domains/ar/runtime.ts');
  assert.equal(typeof mod.provisionArRuntime, 'function');
  assert.equal(typeof mod.getArCollectionsTools, 'function');
});

test('AR runtime domain pack re-exports collections agent creators', async () => {
  const mod = await import('../src/domains/ar/runtime.ts');
  assert.equal(typeof mod.createCollectionsAgent, 'function');
  assert.equal(typeof mod.createCollectionsGrant, 'function');
  assert.ok(mod.COLLECTIONS_TOOLS);
});

test('all 4 domain seams are clean', () => {
  const registrySource = readFileSync('src/core/action-registry.ts', 'utf8');
  const objectivesSource = readFileSync('src/core/objectives-defaults.ts', 'utf8');
  const plannerSource = readFileSync('src/planner/planner.ts', 'utf8');
  const routesSource = readFileSync('src/api/world-runtime-routes.ts', 'utf8');

  assert.ok(registrySource.includes("from '../domains/ar/actions.js'"), 'seam 1: actions');
  assert.ok(objectivesSource.includes("from '../domains/ar/objectives.js'"), 'seam 2: objectives');
  assert.ok(plannerSource.includes("from '../domains/ar/scanner.js'"), 'seam 3: scanner');
  assert.ok(
    routesSource.includes("from '../domains/ar/runtime.js'") || routesSource.includes("from '../domains/ar/runtime.ts'"),
    'seam 4: runtime',
  );
});

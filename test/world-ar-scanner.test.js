import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('planner.ts does not contain AR-specific invoice scanning logic', () => {
  const source = readFileSync('src/planner/planner.ts', 'utf8');

  const arIndicators = [
    'Friendly reminder:',
    'Formal notice:',
    'Stage 1',
    'Stage 2',
    'Stage 3',
    'email_friendly',
    'email_formal',
    'task_escalation',
    'strategic_hold',
    'disputeRisk > 0.5',
    'daysOverdue > 30',
    'daysOverdue > 14',
  ];

  for (const indicator of arIndicators) {
    assert.equal(
      source.includes(indicator),
      false,
      `planner.ts must not contain AR-specific indicator: "${indicator}". AR scanning belongs in src/domains/ar/scanner.ts`,
    );
  }
});

test('planner.ts imports scanner from domain pack', () => {
  const source = readFileSync('src/planner/planner.ts', 'utf8');
  assert.ok(
    source.includes("from '../domains/ar/scanner.js'") || source.includes("from '../domains/ar/scanner.ts'"),
    'planner.ts must import AR scanner from domain pack',
  );
});

test('AR scanner exports buildComparativeActionVariants', async () => {
  const mod = await import('../src/domains/ar/scanner.ts');
  assert.equal(typeof mod.buildComparativeActionVariants, 'function');
});

test('AR scanner exports inferCollectionsVariantId', async () => {
  const mod = await import('../src/domains/ar/scanner.ts');
  assert.equal(typeof mod.inferCollectionsVariantId, 'function');
});

test('AR scanner exports determineCollectionAction', async () => {
  const mod = await import('../src/domains/ar/scanner.ts');
  assert.equal(typeof mod.determineCollectionAction, 'function');

  const result = mod.determineCollectionAction(20, 0.1, 'INV-001', 'inv_1', 100000);
  assert.equal(result.actionClass, 'communicate.email');
  assert.equal(result.stage, 2);
  assert.ok(result.description.includes('Formal notice'));
});

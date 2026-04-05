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

// Helper: minimal ActionContext for a collections email against an invoice
function makeEmailContext(amountCents) {
  return {
    actionClass: 'communicate.email',
    targetObject: {
      state: { amountRemainingCents: amountCents },
    },
    parameters: {},
    recentEvents: [],
    relatedObjects: [
      {
        type: 'party',
        state: {
          contactInfo: [{ type: 'email', primary: true, value: 'test@example.com' }],
        },
      },
    ],
  };
}

// Helper: objectives with only the high-value constraint active
function makeObjectives(tenantId, constraintConfig) {
  return {
    tenantId,
    objectives: [
      { id: 'cash_acceleration', name: 'Cash acceleration', metric: 'projected_collection_30d', weight: 0.4, direction: 'maximize' },
      { id: 'dispute_minimization', name: 'Dispute minimization', metric: 'dispute_rate', weight: 0.2, direction: 'minimize' },
      { id: 'churn_minimization', name: 'Churn minimization', metric: 'customer_attrition_risk', weight: 0.2, direction: 'minimize' },
      { id: 'review_load_minimization', name: 'Review load minimization', metric: 'approval_queue_load', weight: 0.1, direction: 'minimize' },
      { id: 'relationship_preservation', name: 'Relationship preservation', metric: 'customer_goodwill_risk', weight: 0.1, direction: 'minimize' },
    ],
    constraints: ['high_value_escalates_to_approval'],
    constraintConfig,
  };
}

test('high_value_escalates_to_approval: default $5K threshold blocks $5K invoice', async () => {
  const { evaluateObjectiveConstraints } = await import('../src/core/objectives.ts');
  const objectives = makeObjectives('tenant-a', undefined);
  // $5,000 = 500,000 cents — exactly at threshold, should block
  const results = evaluateObjectiveConstraints(objectives, makeEmailContext(500000));
  const result = results.find((r) => r.id === 'high_value_escalates_to_approval');
  assert.ok(result, 'constraint result must be present');
  assert.equal(result.ok, false, '$5K invoice must trigger approval gate');
  assert.ok(result.reason.includes('$5000'), `reason must mention threshold amount, got: ${result.reason}`);
});

test('high_value_escalates_to_approval: default $5K threshold allows $4,999 invoice', async () => {
  const { evaluateObjectiveConstraints } = await import('../src/core/objectives.ts');
  const objectives = makeObjectives('tenant-a', undefined);
  // $4,999 = 499,900 cents — below default threshold, should pass
  const results = evaluateObjectiveConstraints(objectives, makeEmailContext(499900));
  const result = results.find((r) => r.id === 'high_value_escalates_to_approval');
  assert.ok(result, 'constraint result must be present');
  assert.equal(result.ok, true, '$4,999 invoice must not trigger approval gate at default threshold');
});

test('high_value_escalates_to_approval: custom $3K threshold blocks $4K invoice', async () => {
  const { evaluateObjectiveConstraints } = await import('../src/core/objectives.ts');
  const objectives = makeObjectives('tenant-b', {
    high_value_escalates_to_approval: { thresholdCents: 300000 },
  });
  // $4,000 = 400,000 cents — above custom $3K threshold
  const results = evaluateObjectiveConstraints(objectives, makeEmailContext(400000));
  const result = results.find((r) => r.id === 'high_value_escalates_to_approval');
  assert.ok(result, 'constraint result must be present');
  assert.equal(result.ok, false, '$4K invoice must trigger approval gate when threshold is $3K');
  assert.ok(result.reason.includes('$3000'), `reason must mention $3000 threshold, got: ${result.reason}`);
});

test('high_value_escalates_to_approval: custom $3K threshold allows $2,999 invoice', async () => {
  const { evaluateObjectiveConstraints } = await import('../src/core/objectives.ts');
  const objectives = makeObjectives('tenant-b', {
    high_value_escalates_to_approval: { thresholdCents: 300000 },
  });
  // $2,999 = 299,900 cents — below custom threshold
  const results = evaluateObjectiveConstraints(objectives, makeEmailContext(299900));
  const result = results.find((r) => r.id === 'high_value_escalates_to_approval');
  assert.ok(result, 'constraint result must be present');
  assert.equal(result.ok, true, '$2,999 invoice must not trigger approval gate when threshold is $3K');
});

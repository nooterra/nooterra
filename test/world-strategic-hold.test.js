import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActionType,
  listActionTypes,
  materializeActionEffects,
  validateActionContext,
} from '../src/core/action-registry.ts';

const invoice = {
  id: 'inv_hold_1',
  tenantId: 'tenant_world',
  type: 'invoice',
  version: 1,
  state: {
    amountCents: 250000,
    amountRemainingCents: 250000,
    status: 'overdue',
    dueAt: new Date('2026-03-20T00:00:00.000Z'),
    number: 'INV-HOLD-001',
    partyId: 'party_hold_1',
  },
  estimated: {
    paymentProbability7d: 0.62,
    urgency: 0.35,
    disputeRisk: 0.05,
  },
  confidence: 1,
  sources: [],
  createdAt: new Date('2026-04-02T10:00:00.000Z'),
  updatedAt: new Date('2026-04-02T10:00:00.000Z'),
  validFrom: new Date('2026-04-02T10:00:00.000Z'),
  tombstone: false,
};

test('strategic.hold action type is registered and has correct shape', () => {
  const actionType = getActionType('strategic.hold');
  assert.ok(actionType, 'strategic.hold must be registered');
  assert.equal(actionType.id, 'strategic.hold');
  assert.equal(actionType.externalEffect, false);
  assert.equal(actionType.blastRadius, 'low');
  assert.equal(actionType.reversible, true);
  assert.deepStrictEqual(actionType.objectTypes, ['invoice']);
  assert.ok(actionType.expectedEffects.length >= 1, 'must have at least one expected effect');
});

test('strategic.hold appears in listActionTypes', () => {
  const all = listActionTypes();
  const ids = all.map((a) => a.id);
  assert.ok(ids.includes('strategic.hold'));
});

test('strategic.hold validates with invoice target', async () => {
  const result = await validateActionContext({
    tenantId: 'tenant_world',
    actionClass: 'strategic.hold',
    parameters: { reason: 'customer has active expansion deal' },
    targetObject: invoice,
    relatedObjects: [],
    recentEvents: [],
  });
  assert.equal(result.ok, true);
});

test('strategic.hold materializes relationship preservation effect', () => {
  const actionType = getActionType('strategic.hold');
  assert.ok(actionType);
  const effects = materializeActionEffects(actionType, invoice);
  const relationshipEffect = effects.find((e) => e.field === 'relationshipPreservation');
  assert.ok(relationshipEffect, 'must have relationship preservation effect');
  assert.ok(relationshipEffect.delta > 0, 'hold should improve relationship preservation');
});

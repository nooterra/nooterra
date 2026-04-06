import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActionType,
  materializeActionEffects,
  validateActionContext,
} from '../src/core/action-registry.ts';

const invoice = {
  id: 'inv_1',
  tenantId: 'tenant_world',
  type: 'invoice',
  version: 1,
  state: {
    amountCents: 420000,
    amountRemainingCents: 420000,
    status: 'overdue',
    dueAt: new Date('2026-03-15T00:00:00.000Z'),
    partyId: 'party_1',
  },
  estimated: {
    paymentProbability7d: 0.38,
    urgency: 0.71,
    disputeRisk: 0.12,
  },
  confidence: 1,
  sources: [],
  createdAt: new Date('2026-04-02T10:00:00.000Z'),
  updatedAt: new Date('2026-04-02T10:00:00.000Z'),
  validFrom: new Date('2026-04-02T10:00:00.000Z'),
  tombstone: false,
};

const primaryParty = {
  id: 'party_1',
  tenantId: 'tenant_world',
  type: 'party',
  version: 1,
  state: {
    name: 'Acme Corp',
    type: 'customer',
    contactInfo: [{ type: 'email', value: 'billing@acme.test', primary: true }],
  },
  estimated: {},
  confidence: 1,
  sources: [],
  createdAt: new Date('2026-04-02T10:00:00.000Z'),
  updatedAt: new Date('2026-04-02T10:00:00.000Z'),
  validFrom: new Date('2026-04-02T10:00:00.000Z'),
  tombstone: false,
};

test('action registry: collections email action validates required context and materializes expected effects', async () => {
  const actionType = getActionType('communicate.email');
  assert.ok(actionType);

  const effects = materializeActionEffects(actionType, invoice);
  assert.equal(effects.length, 2);
  assert.equal(effects[0].field, 'paymentProbability7d');
  assert.equal(effects[0].predictedValue, 0.53);

  const validation = await validateActionContext({
    tenantId: 'tenant_world',
    actionClass: 'communicate.email',
    parameters: {},
    targetObject: invoice,
    relatedObjects: [primaryParty],
    recentEvents: [],
  });
  assert.equal(validation.ok, true);
});

test('action registry: collections email action fails closed on missing billing contact or dispute signal', async () => {
  const missingContact = await validateActionContext({
    tenantId: 'tenant_world',
    actionClass: 'communicate.email',
    parameters: {},
    targetObject: invoice,
    relatedObjects: [],
    recentEvents: [],
  });
  assert.equal(missingContact.ok, false);
  assert.match(missingContact.checks.map((check) => check.reason).join(' '), /billing email contact/i);

  const disputedInvoice = {
    ...invoice,
    state: { ...invoice.state, status: 'disputed' },
    estimated: { ...invoice.estimated, disputeRisk: 0.72 },
  };
  const disputed = await validateActionContext({
    tenantId: 'tenant_world',
    actionClass: 'communicate.email',
    parameters: {},
    targetObject: disputedInvoice,
    relatedObjects: [primaryParty],
    recentEvents: [],
  });
  assert.equal(disputed.ok, false);
  assert.match(disputed.checks.map((check) => check.reason).join(' '), /dispute/i);
});


import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateObjectiveConstraints,
} from '../src/core/objectives.ts';
import { createDefaultArObjectives } from '../src/core/objectives-defaults.ts';

const invoice = {
  id: 'inv_1',
  tenantId: 'tenant_world',
  type: 'invoice',
  version: 1,
  state: {
    amountCents: 420000,
    amountRemainingCents: 420000,
    status: 'overdue',
    timezone: 'America/Los_Angeles',
  },
  estimated: {
    disputeRisk: 0.12,
  },
  confidence: 1,
  sources: [],
  createdAt: new Date('2026-04-02T10:00:00.000Z'),
  updatedAt: new Date('2026-04-02T10:00:00.000Z'),
  validFrom: new Date('2026-04-02T10:00:00.000Z'),
  tombstone: false,
};

const party = {
  id: 'party_1',
  tenantId: 'tenant_world',
  type: 'party',
  version: 1,
  state: {
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

test('objective constraints: collections cooldown requires review after recent outreach', () => {
  const objectives = createDefaultArObjectives('tenant_world');
  const results = evaluateObjectiveConstraints(objectives, {
    tenantId: 'tenant_world',
    actionClass: 'communicate.email',
    parameters: {
      proposedAt: '2026-04-03T17:00:00.000Z',
    },
    targetObject: invoice,
    relatedObjects: [party],
    recentEvents: [
      {
        type: 'agent.action.executed',
        payload: { actionClass: 'communicate.email' },
        timestamp: '2026-04-02T18:00:00.000Z',
      },
    ],
  });
  const cooldown = results.find((result) => result.id === 'collections_outreach_cooldown');
  assert.equal(cooldown?.ok, false);
  assert.equal(cooldown?.enforcement, 'require_approval');
});

test('objective constraints: outside business hours requires review for customer outreach', () => {
  const objectives = createDefaultArObjectives('tenant_world');
  const results = evaluateObjectiveConstraints(objectives, {
    tenantId: 'tenant_world',
    actionClass: 'communicate.email',
    parameters: {
      proposedAt: '2026-04-03T03:00:00.000Z',
    },
    targetObject: invoice,
    relatedObjects: [party],
    recentEvents: [],
  });
  const businessHours = results.find((result) => result.id === 'outside_business_hours_requires_approval');
  assert.equal(businessHours?.ok, false);
  assert.equal(businessHours?.enforcement, 'require_approval');
});


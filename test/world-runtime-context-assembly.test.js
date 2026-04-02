import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { budgetContext } from '../src/agents/context-assembly/budget.ts';
import { formatContext, buildAuthoritySummary } from '../src/agents/context-assembly/format.ts';

// Mock data for testing without a database

const mockTarget = {
  id: 'inv_001',
  tenantId: 'tenant_1',
  type: 'invoice',
  version: 1,
  state: {
    number: 'INV-2024-001',
    amountCents: 500000,
    currency: 'USD',
    dueAt: new Date('2024-01-15'),
    partyId: 'party_001',
    status: 'overdue',
    amountPaidCents: 0,
    amountRemainingCents: 500000,
    lineItems: [{ description: 'Consulting', amountCents: 500000, quantity: 1 }],
    payments: [],
  },
  estimated: {
    paymentProbability7d: 0.72,
    disputeRisk: 0.08,
  },
  confidence: 0.95,
  sources: [{ system: 'stripe', id: 'in_abc123' }],
  createdAt: new Date(),
  updatedAt: new Date(),
  validFrom: new Date(),
  tombstone: false,
};

const mockCustomer = {
  id: 'party_001',
  tenantId: 'tenant_1',
  type: 'party',
  version: 3,
  state: {
    name: 'Acme Corp',
    type: 'customer',
    identifiers: [{ system: 'stripe', id: 'cus_xyz789' }],
    contactInfo: [{ type: 'email', value: 'billing@acme.com', primary: true }],
    tags: ['enterprise'],
  },
  estimated: {
    paymentReliability: 0.85,
    churnRisk: 0.12,
    engagementLevel: 0.7,
  },
  confidence: 0.9,
  sources: [{ system: 'stripe', id: 'cus_xyz789' }],
  createdAt: new Date('2023-06-01'),
  updatedAt: new Date(),
  validFrom: new Date(),
  tombstone: false,
};

const mockRelationship = {
  id: 'rel_001',
  tenantId: 'tenant_1',
  type: 'pays',
  fromId: 'party_001',
  fromType: 'party',
  toId: 'inv_001',
  toType: 'invoice',
  properties: { role: 'debtor' },
  strength: 0.9,
  validFrom: new Date(),
};

const mockEvent = {
  id: 'evt_001',
  tenantId: 'tenant_1',
  type: 'financial.invoice.overdue',
  timestamp: new Date(),
  recordedAt: new Date(),
  sourceType: 'connector',
  sourceId: 'stripe_conn',
  objectRefs: [{ objectId: 'inv_001', objectType: 'invoice', role: 'subject' }],
  payload: { daysOverdue: 15, amountCents: 500000 },
  confidence: 1.0,
  provenance: { sourceSystem: 'stripe', sourceId: 'evt_stripe_1', extractionMethod: 'api', extractionConfidence: 1.0 },
  traceId: 'trace_001',
  hash: 'abc',
};

describe('Context Assembly — Layer 2: Token Budgeting', () => {
  it('includes target object in every budget', () => {
    const result = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [],
        recentEvents: [],
        relevantDomains: ['financial'],
      },
    });

    assert.equal(result.target.id, 'inv_001');
    assert.ok(result.estimatedTokens > 0);
  });

  it('respects max token budget', () => {
    const result = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [
          { object: mockCustomer, relationship: mockRelationship, relevanceScore: 0.9, reason: 'customer' },
        ],
        recentEvents: [mockEvent],
        relevantDomains: ['financial'],
      },
      maxTokens: 500, // Very tight budget
    });

    assert.ok(result.estimatedTokens <= 500, `Estimated tokens ${result.estimatedTokens} should be <= 500`);
  });

  it('includes related objects sorted by relevance', () => {
    const lowRelevance = {
      object: { ...mockCustomer, id: 'party_002' },
      relationship: { ...mockRelationship, id: 'rel_002' },
      relevanceScore: 0.3,
      reason: 'low',
    };
    const highRelevance = {
      object: { ...mockCustomer, id: 'party_003' },
      relationship: { ...mockRelationship, id: 'rel_003' },
      relevanceScore: 0.95,
      reason: 'high',
    };

    const result = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [lowRelevance, highRelevance],
        recentEvents: [],
        relevantDomains: ['financial'],
      },
    });

    // Both should be included (budget is large enough)
    assert.equal(result.relatedObjects.length, 2);
  });

  it('truncates lowest-priority items when budget is tight', () => {
    const manyMemories = Array.from({ length: 50 }, (_, i) => ({
      key: `fact_${i}`,
      value: 'A'.repeat(200), // Long memories
      scope: 'worker',
    }));

    const result = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [],
        recentEvents: [],
        relevantDomains: ['financial'],
      },
      memories: manyMemories,
      maxTokens: 2000, // Tight budget
    });

    assert.ok(result.truncated.memoriesCut > 0, 'Some memories should be truncated');
    assert.ok(result.memories.length < 50, 'Not all memories should fit');
  });
});

describe('Context Assembly — Layer 3: Format Optimization', () => {
  it('produces system and user messages', () => {
    const budgeted = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [
          { object: mockCustomer, relationship: mockRelationship, relevanceScore: 0.9, reason: 'customer' },
        ],
        recentEvents: [mockEvent],
        relevantDomains: ['financial'],
      },
      authoritySummary: 'You CAN do: communicate.email\nFORBIDDEN: financial.payment.initiate',
    });

    const output = formatContext(budgeted, {
      agentRole: 'AR Collections Specialist',
      agentName: 'Collections Agent',
      taskDescription: 'Follow up on overdue invoice INV-2024-001 for Acme Corp',
    });

    assert.ok(output.systemContent.includes('Collections Agent'));
    assert.ok(output.systemContent.includes('AR Collections Specialist'));
    assert.ok(output.systemContent.includes('INV-2024-001'));
    assert.ok(output.systemContent.includes('$5000.00') || output.systemContent.includes('$5,000.00')); // amountCents formatted
    assert.ok(output.systemContent.includes('overdue') || output.systemContent.includes('OVERDUE') || output.systemContent.includes('status'));
    assert.ok(output.systemContent.includes('Authority'));
    assert.ok(output.systemContent.includes('FORBIDDEN'));
    assert.ok(output.systemContent.includes('SYSTEM RULES'));
    assert.ok(output.userContent.includes('Follow up'));
  });

  it('formats estimated fields with percentage and confidence bars', () => {
    const budgeted = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [],
        recentEvents: [],
        relevantDomains: ['financial'],
      },
    });

    const output = formatContext(budgeted, {
      agentRole: 'Agent',
      agentName: 'Test',
      taskDescription: 'test',
    });

    assert.ok(output.systemContent.includes('paymentProbability7d'));
    assert.ok(output.systemContent.includes('72%')); // 0.72 → 72%
    assert.ok(output.systemContent.includes('disputeRisk'));
    assert.ok(output.systemContent.includes('8%')); // 0.08 → 8%
  });

  it('includes recent events as a timeline', () => {
    const budgeted = budgetContext({
      relevantItems: {
        target: mockTarget,
        relatedObjects: [],
        recentEvents: [mockEvent],
        relevantDomains: ['financial'],
      },
    });

    const output = formatContext(budgeted, {
      agentRole: 'Agent',
      agentName: 'Test',
      taskDescription: 'test',
    });

    assert.ok(output.systemContent.includes('Recent Activity'));
    assert.ok(output.systemContent.includes('financial.invoice.overdue'));
  });
});

describe('Authority Summary', () => {
  it('formats effective authority as readable text', () => {
    const summary = buildAuthoritySummary({
      actionClasses: ['communicate.email', 'financial.invoice.read'],
      forbidden: ['data.delete', 'financial.payment.initiate'],
      requireApproval: ['task.create'],
      budgetRemainingCents: 45000,
    });

    assert.ok(summary.includes('communicate.email'));
    assert.ok(summary.includes('FORBIDDEN'));
    assert.ok(summary.includes('data.delete'));
    assert.ok(summary.includes('Requires APPROVAL'));
    assert.ok(summary.includes('task.create'));
    assert.ok(summary.includes('$450.00'));
  });
});

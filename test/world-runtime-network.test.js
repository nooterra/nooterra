import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentIdentity, identityFingerprint } from '../src/network/identity.ts';
import { registerAgent, discoverAgents, deregisterAgent } from '../src/network/discovery.ts';
import { postRFQ, submitQuote, evaluateQuotes, awardRFQ, settleAward, getOpenRFQs } from '../src/network/negotiation.ts';
import { optimizeModelRouting, detectBottlenecks } from '../src/agents/optimizer.ts';

// ---------------------------------------------------------------------------
// Agent Identity
// ---------------------------------------------------------------------------

describe('Agent Identity', () => {
  it('creates identity with key pair', () => {
    const { identity, privateKey } = createAgentIdentity('tenant_1', 'Collections Agent', [
      { actionClass: 'communicate.email', objectTypes: ['invoice'], autonomyLevel: 'autonomous', evidenceStrength: 0.9 },
    ]);

    assert.ok(identity.id);
    assert.equal(identity.tenantId, 'tenant_1');
    assert.equal(identity.agentName, 'Collections Agent');
    assert.ok(identity.publicKey.includes('PUBLIC KEY'));
    assert.ok(privateKey.includes('PRIVATE KEY'));
    assert.equal(identity.certificationTier, 'basic');
    assert.equal(identity.origin, 'first_party');
    assert.equal(identity.capabilities.length, 1);
  });

  it('creates unique fingerprints', () => {
    const { identity: a } = createAgentIdentity('t1', 'Agent A', []);
    const { identity: b } = createAgentIdentity('t2', 'Agent B', []);

    assert.notEqual(identityFingerprint(a), identityFingerprint(b));
  });

  it('third-party agents start as unverified', () => {
    const { identity } = createAgentIdentity('t1', 'External', [], 'third_party');
    assert.equal(identity.certificationTier, 'unverified');
    assert.equal(identity.origin, 'third_party');
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe('Agent Discovery', () => {
  it('discovers agents by capability', () => {
    const { identity } = createAgentIdentity('t1', 'Collections', [
      { actionClass: 'communicate.email', objectTypes: ['invoice'], autonomyLevel: 'autonomous', evidenceStrength: 0.9 },
      { actionClass: 'financial.invoice.read', objectTypes: ['invoice'], autonomyLevel: 'autonomous', evidenceStrength: 0.95 },
    ]);
    registerAgent(identity);

    const results = discoverAgents({ actionClasses: ['communicate.email'] });
    assert.ok(results.length > 0);
    assert.equal(results[0].agent.agentName, 'Collections');
    assert.ok(results[0].matchScore > 0);

    deregisterAgent(identity.id);
  });

  it('filters by certification tier', () => {
    const { identity: verified } = createAgentIdentity('t1', 'Verified', [
      { actionClass: 'communicate.email', objectTypes: ['invoice'], autonomyLevel: 'autonomous', evidenceStrength: 0.8 },
    ]);
    verified.certificationTier = 'verified';
    registerAgent(verified);

    const { identity: unverified } = createAgentIdentity('t2', 'Unverified', [
      { actionClass: 'communicate.email', objectTypes: ['invoice'], autonomyLevel: 'autonomous', evidenceStrength: 0.5 },
    ]);
    registerAgent(unverified);

    const results = discoverAgents({
      actionClasses: ['communicate.email'],
      minCertification: 'verified',
    });

    assert.ok(results.every(r => r.agent.certificationTier === 'verified' || r.agent.certificationTier === 'certified'));

    deregisterAgent(verified.id);
    deregisterAgent(unverified.id);
  });

  it('returns empty for no matches', () => {
    const results = discoverAgents({ actionClasses: ['nonexistent.action'] });
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

describe('Cross-Company Negotiation', () => {
  it('full RFQ → quote → award → settlement flow', () => {
    // Buyer posts RFQ
    const rfq = postRFQ('buyer_agent', 'buyer_tenant', {
      actionClass: 'communicate.email',
      objectType: 'invoice',
      description: 'Need collections help for overdue invoices',
      maxBudgetCents: 100000, // $1,000
      deadline: new Date(Date.now() + 7 * 86400000),
      constraints: {},
    });
    assert.equal(rfq.status, 'open');

    // Vendor submits quote
    const quote = submitQuote(rfq.id, 'vendor_agent', 'vendor_tenant', {
      priceCents: 50000, // $500
      estimatedDurationMs: 86400000,
      capabilities: ['communicate.email'],
      slaGuarantees: { successRate: 0.9, maxResponseMs: 5000 },
      terms: 'Per-invoice collection service',
    });
    assert.equal(quote.status, 'submitted');

    // Evaluate quotes
    const ranked = evaluateQuotes(rfq.id);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, quote.id);

    // Award to winner
    const award = awardRFQ(rfq.id, quote.id);
    assert.equal(award.status, 'active');
    assert.equal(award.agreedPriceCents, 50000);

    // Settle
    const settlement = settleAward(award.id, 'buyer_tenant', 'vendor_tenant');
    assert.equal(settlement.status, 'settled');
    assert.equal(settlement.amountCents, 50000);
  });

  it('rejects quotes over budget', () => {
    const rfq = postRFQ('buyer', 'tenant', {
      actionClass: 'task.create',
      objectType: 'task',
      description: 'test',
      maxBudgetCents: 10000,
      deadline: new Date(Date.now() + 86400000),
      constraints: {},
    });

    assert.throws(() => {
      submitQuote(rfq.id, 'vendor', 'tenant2', {
        priceCents: 20000, // Over budget
        estimatedDurationMs: 1000,
        capabilities: [],
        slaGuarantees: { successRate: 0.9, maxResponseMs: 1000 },
        terms: 'test',
      });
    }, /exceeds RFQ budget/);
  });

  it('lists open RFQs', () => {
    const open = getOpenRFQs();
    assert.ok(open.length > 0);
    assert.ok(open.every(r => r.status === 'open'));
  });
});

// ---------------------------------------------------------------------------
// Self-Optimization
// ---------------------------------------------------------------------------

describe('Model Routing Optimization', () => {
  it('recommends Haiku for high-score routine tasks', () => {
    const cells = [{
      agentId: 'agent_1', actionClass: 'communicate.email', objectType: 'invoice',
      totalExecutions: 50, successfulExecutions: 48, successRate: 0.96,
      avgProceduralScore: 0.94, avgOutcomeScore: 0.91,
      incidentCount: 0, currentLevel: 'autonomous',
      recommendedLevel: 'autonomous', evidenceStrength: 0.9, requiredForPromotion: '',
    }];

    const recs = optimizeModelRouting(cells);
    assert.ok(recs.length > 0);
    assert.ok(recs[0].recommendedModel.includes('haiku'));
    assert.ok(recs[0].estimatedSavingsPercent > 50);
  });

  it('recommends Opus for poor-outcome tasks', () => {
    const cells = [{
      agentId: 'agent_1', actionClass: 'task.create', objectType: 'invoice',
      totalExecutions: 30, successfulExecutions: 15, successRate: 0.5,
      avgProceduralScore: 0.88, avgOutcomeScore: 0.45,
      incidentCount: 0, currentLevel: 'human_approval',
      recommendedLevel: 'human_approval', evidenceStrength: 0.5, requiredForPromotion: '',
    }];

    const recs = optimizeModelRouting(cells);
    assert.ok(recs.length > 0);
    assert.ok(recs[0].recommendedModel.includes('opus'));
  });
});

describe('Bottleneck Detection', () => {
  it('detects growing approval queue', () => {
    const bottlenecks = detectBottlenecks([], new Map(), 30);
    assert.ok(bottlenecks.some(b => b.type === 'approval_queue_growing'));
    assert.ok(bottlenecks.some(b => b.severity === 'critical'));
  });

  it('detects cells stuck at human_approval with strong evidence', () => {
    const cells = [{
      agentId: 'agent_1', actionClass: 'communicate.email', objectType: 'invoice',
      totalExecutions: 40, successfulExecutions: 38, successRate: 0.95,
      avgProceduralScore: 0.92, avgOutcomeScore: 0.88,
      incidentCount: 0, currentLevel: 'human_approval',
      recommendedLevel: 'auto_with_review', evidenceStrength: 0.8, requiredForPromotion: '',
    }];

    const bottlenecks = detectBottlenecks(cells, new Map([['agent_1', ['communicate.email']]]), 0);
    assert.ok(bottlenecks.some(b => b.type === 'low_autonomy'));
  });
});

/**
 * Cross-Company Negotiation — machine-readable offers within authority envelopes.
 *
 * When agents from different companies interact, they negotiate within
 * their respective authority grants. Both sides governed, both sides audited.
 *
 * Protocol:
 * 1. Buyer agent discovers vendor agents via registry
 * 2. Buyer sends a Request for Quote (RFQ) with requirements
 * 3. Vendor agents respond with quotes (within their authority)
 * 4. Buyer evaluates quotes and selects
 * 5. Both sides commit through their respective gateways
 * 6. Settlement recorded on both sides with evidence bundles
 */

import { ulid } from 'ulid';
import type { AgentIdentity } from './identity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NegotiationRFQ {
  id: string;
  buyerAgentId: string;
  buyerTenantId: string;
  requirements: {
    actionClass: string;
    objectType: string;
    description: string;
    maxBudgetCents: number;
    deadline: Date;
    constraints: Record<string, unknown>;
  };
  status: 'open' | 'evaluating' | 'awarded' | 'cancelled';
  createdAt: Date;
  expiresAt: Date;
}

export interface NegotiationQuote {
  id: string;
  rfqId: string;
  vendorAgentId: string;
  vendorTenantId: string;
  offer: {
    priceCents: number;
    estimatedDurationMs: number;
    capabilities: string[];
    slaGuarantees: {
      successRate: number;
      maxResponseMs: number;
    };
    terms: string;
  };
  status: 'submitted' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
}

export interface NegotiationAward {
  id: string;
  rfqId: string;
  quoteId: string;
  buyerAgentId: string;
  vendorAgentId: string;
  agreedPriceCents: number;
  agreedTerms: string;
  buyerEvidence: Record<string, unknown>;
  vendorEvidence: Record<string, unknown>;
  status: 'pending' | 'active' | 'completed' | 'disputed';
  createdAt: Date;
}

export interface SettlementRecord {
  id: string;
  awardId: string;
  buyerTenantId: string;
  vendorTenantId: string;
  amountCents: number;
  status: 'pending' | 'settled' | 'disputed' | 'refunded';
  settledAt?: Date;
  buyerSignature?: string;
  vendorSignature?: string;
}

// ---------------------------------------------------------------------------
// Negotiation engine (in-memory for now)
// ---------------------------------------------------------------------------

const rfqs = new Map<string, NegotiationRFQ>();
const quotes = new Map<string, NegotiationQuote[]>();
const awards = new Map<string, NegotiationAward>();
const settlements = new Map<string, SettlementRecord>();

/**
 * Post a Request for Quote.
 */
export function postRFQ(
  buyerAgentId: string,
  buyerTenantId: string,
  requirements: NegotiationRFQ['requirements'],
  expiresInMs = 3600000,
): NegotiationRFQ {
  const rfq: NegotiationRFQ = {
    id: ulid(),
    buyerAgentId,
    buyerTenantId,
    requirements,
    status: 'open',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresInMs),
  };

  rfqs.set(rfq.id, rfq);
  quotes.set(rfq.id, []);
  return rfq;
}

/**
 * Submit a quote in response to an RFQ.
 */
export function submitQuote(
  rfqId: string,
  vendorAgentId: string,
  vendorTenantId: string,
  offer: NegotiationQuote['offer'],
): NegotiationQuote {
  const rfq = rfqs.get(rfqId);
  if (!rfq) throw new Error(`RFQ not found: ${rfqId}`);
  if (rfq.status !== 'open') throw new Error(`RFQ is not open: ${rfq.status}`);
  if (new Date() > rfq.expiresAt) throw new Error('RFQ has expired');

  // Validate offer is within RFQ budget
  if (offer.priceCents > rfq.requirements.maxBudgetCents) {
    throw new Error(`Quote price (${offer.priceCents}c) exceeds RFQ budget (${rfq.requirements.maxBudgetCents}c)`);
  }

  const quote: NegotiationQuote = {
    id: ulid(),
    rfqId,
    vendorAgentId,
    vendorTenantId,
    offer,
    status: 'submitted',
    createdAt: new Date(),
  };

  quotes.get(rfqId)!.push(quote);
  return quote;
}

/**
 * Evaluate quotes for an RFQ and select a winner.
 * Scoring: capability match (0.4) + price competitiveness (0.3) + SLA (0.3)
 */
export function evaluateQuotes(rfqId: string): NegotiationQuote[] {
  const rfq = rfqs.get(rfqId);
  if (!rfq) throw new Error(`RFQ not found: ${rfqId}`);

  const rfqQuotes = quotes.get(rfqId) || [];
  if (rfqQuotes.length === 0) return [];

  const maxPrice = Math.max(...rfqQuotes.map(q => q.offer.priceCents));

  return rfqQuotes
    .map(q => {
      const priceScore = 1 - (q.offer.priceCents / (maxPrice || 1)); // lower is better
      const slaScore = q.offer.slaGuarantees.successRate;
      const capScore = q.offer.capabilities.length > 0 ? 1 : 0;
      const totalScore = capScore * 0.4 + priceScore * 0.3 + slaScore * 0.3;
      return { quote: q, score: totalScore };
    })
    .sort((a, b) => b.score - a.score)
    .map(r => r.quote);
}

/**
 * Award an RFQ to a specific quote.
 */
export function awardRFQ(
  rfqId: string,
  quoteId: string,
  buyerEvidence: Record<string, unknown> = {},
): NegotiationAward {
  const rfq = rfqs.get(rfqId);
  if (!rfq) throw new Error(`RFQ not found: ${rfqId}`);

  const rfqQuotes = quotes.get(rfqId) || [];
  const winningQuote = rfqQuotes.find(q => q.id === quoteId);
  if (!winningQuote) throw new Error(`Quote not found: ${quoteId}`);

  // Update statuses
  rfq.status = 'awarded';
  winningQuote.status = 'accepted';
  for (const q of rfqQuotes) {
    if (q.id !== quoteId) q.status = 'rejected';
  }

  const award: NegotiationAward = {
    id: ulid(),
    rfqId,
    quoteId,
    buyerAgentId: rfq.buyerAgentId,
    vendorAgentId: winningQuote.vendorAgentId,
    agreedPriceCents: winningQuote.offer.priceCents,
    agreedTerms: winningQuote.offer.terms,
    buyerEvidence,
    vendorEvidence: {},
    status: 'active',
    createdAt: new Date(),
  };

  awards.set(award.id, award);
  return award;
}

/**
 * Record settlement for a completed award.
 */
export function settleAward(
  awardId: string,
  buyerTenantId: string,
  vendorTenantId: string,
): SettlementRecord {
  const award = awards.get(awardId);
  if (!award) throw new Error(`Award not found: ${awardId}`);

  const settlement: SettlementRecord = {
    id: ulid(),
    awardId,
    buyerTenantId,
    vendorTenantId,
    amountCents: award.agreedPriceCents,
    status: 'settled',
    settledAt: new Date(),
  };

  award.status = 'completed';
  settlements.set(settlement.id, settlement);
  return settlement;
}

/**
 * Get all open RFQs (for vendor agents to browse).
 */
export function getOpenRFQs(): NegotiationRFQ[] {
  const now = new Date();
  return [...rfqs.values()].filter(r => r.status === 'open' && r.expiresAt > now);
}

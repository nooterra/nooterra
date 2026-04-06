/**
 * AR Command Center API client.
 *
 * Wraps fetch calls to /v1/world/plan/nba/* and /v1/ar/* endpoints.
 * Uses the same worldApi pattern as world-api.js.
 */

import { worldApi } from './world-api.js';

// ---------------------------------------------------------------------------
// Priority Queue — NBA-ranked invoices
// ---------------------------------------------------------------------------

export async function getNBAPlan() {
  return worldApi('/v1/world/plan/nba');
}

export async function getInvoiceRanking(objectId) {
  return worldApi(`/v1/world/plan/nba/${objectId}`);
}

// ---------------------------------------------------------------------------
// World Objects (invoices, customers)
// ---------------------------------------------------------------------------

export async function getInvoices(params = {}) {
  const query = new URLSearchParams();
  query.set('type', 'invoice');
  if (params.limit) query.set('limit', String(params.limit));
  return worldApi(`/v1/world/objects?${query}`);
}

export async function getCustomers(params = {}) {
  const query = new URLSearchParams();
  query.set('type', 'party');
  if (params.limit) query.set('limit', String(params.limit));
  return worldApi(`/v1/world/objects?${query}`);
}

export async function getObjectDetail(objectId) {
  return worldApi(`/v1/world/objects/${objectId}`);
}

export async function getRelatedObjects(objectId) {
  return worldApi(`/v1/world/objects/${objectId}/related`);
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export async function getPredictions(objectId) {
  return worldApi(`/v1/world/predictions?objectId=${objectId}`);
}

// ---------------------------------------------------------------------------
// Performance & Stats
// ---------------------------------------------------------------------------

export async function getWorldStats() {
  return worldApi('/v1/world/stats');
}

export async function getWorldOverview() {
  return worldApi('/v1/world/overview');
}

export async function getScorecard() {
  return worldApi('/v1/world/scorecard');
}

// ---------------------------------------------------------------------------
// Epochs
// ---------------------------------------------------------------------------

export async function triggerEpochSweep() {
  return worldApi('/v1/world/epochs/backfill', { method: 'POST' });
}

export async function triggerEpochResolve() {
  return worldApi('/v1/world/epochs/resolve', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatMoney(cents) {
  const num = Number(cents || 0) / 100;
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k`;
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatMoneyFull(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDays(days) {
  const d = Math.round(Number(days || 0));
  if (d === 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

export function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

const SHAP_LABELS = {
  daysOverdue: 'overdue',
  amountCents: 'amount',
  amountRemainingCents: 'balance',
  paymentReliability: 'reliability',
  disputeRisk: 'dispute risk',
  churnRisk: 'churn risk',
  customerReliabilityPercentile: 'customer rank',
  reminderCount: 'reminders sent',
  daysToPaySlope: 'pay speed trend',
  amountVsTenantMedian: 'relative size',
  paymentFrequencyScore: 'pay regularity',
  amountPaidRatio: 'partial payment',
  overdueVsTerms: 'overdue vs terms',
  silenceAfterOutreachDays: 'response time',
  daysSinceLastContact: 'last contact',
  invoicesPaidCount: 'history',
  isDisputed: 'disputed',
  lineItemCount: 'complexity',
};

export function humanizeShapFeature(feature) {
  return SHAP_LABELS[feature] || feature.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

export function shapDirection(contribution) {
  if (contribution > 0.01) return 'positive';
  if (contribution < -0.01) return 'negative';
  return 'neutral';
}

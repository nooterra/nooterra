import crypto from 'node:crypto';

import { decryptCredential } from './crypto-utils.js';

export const DEFAULT_STRIPE_SCAN_LOOKBACK_DAYS = 30;
export const DEFAULT_INVOICE_FETCH_HORIZON_DAYS = 180;
export const ACTIVE_STRIPE_SCAN_TIMEOUT_MS = 30 * 60 * 1000;
export const STRIPE_SCAN_SCHEMA_VERSION = 'stripe.scan.result.v1';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_PAGE_LIMIT = 100;
const STRIPE_MAX_PAGES = 1000;
const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const REFUND_THRESHOLD_CENTS = 50_000;
const CREDIT_NOTE_THRESHOLD_CENTS = 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const BUCKET_CONFIG = Object.freeze({
  bkt_invoices: Object.freeze({
    label: 'Overdue Invoices (Baseline Recovery Candidates)',
    status: 'actionable',
    severity: 1,
  }),
  bkt_refunds: Object.freeze({
    label: 'Refunds & Credits (Baseline Threshold Exceeded)',
    status: 'flagged',
    severity: 2,
  }),
  bkt_disputes: Object.freeze({
    label: 'Open Disputes (Missing Evidence SLA)',
    status: 'at_risk',
    severity: 3,
  }),
});

function nowIso(nowMs) {
  return new Date(nowMs).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function coerceInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function coercePositiveCents(value) {
  const n = coerceInteger(value, 0);
  return n > 0 ? n : 0;
}

function buildStripeUrl(path, params = {}) {
  const url = new URL(`${STRIPE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (nestedValue == null) continue;
        url.searchParams.set(`${key}[${nestedKey}]`, String(nestedValue));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function readResponseTextSafe(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function fetchStripeJson({ apiKey, path, params = {}, fetchImpl = globalThis.fetch, maxAttempts = 3 }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available for Stripe scan execution');
  }

  const url = buildStripeUrl(path, params);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      await sleep(100 * attempt);
      continue;
    }

    if (res.ok) {
      return res.json();
    }

    const bodyText = await readResponseTextSafe(res);
    lastError = new Error(`Stripe API ${path} failed (${res.status}): ${bodyText.slice(0, 240) || 'no body'}`);
    if (!RETRYABLE_HTTP_STATUS.has(res.status) || attempt >= maxAttempts) break;

    const retryAfterSeconds = Number(res.headers?.get?.('retry-after'));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 5000)
      : 200 * attempt;
    await sleep(delayMs);
  }

  throw lastError instanceof Error ? lastError : new Error(`Stripe API ${path} failed`);
}

async function *listStripeObjects({ apiKey, path, params = {}, fetchImpl = globalThis.fetch }) {
  let startingAfter = null;

  for (let page = 0; page < STRIPE_MAX_PAGES; page += 1) {
    const payload = await fetchStripeJson({
      apiKey,
      path,
      params: {
        ...params,
        limit: STRIPE_PAGE_LIMIT,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      fetchImpl,
    });

    const items = Array.isArray(payload?.data) ? payload.data : [];
    for (const item of items) {
      yield item;
    }

    if (!payload?.has_more || items.length === 0) return;
    startingAfter = items[items.length - 1]?.id ?? null;
    if (!startingAfter) return;
  }

  throw new Error(`Stripe pagination exceeded ${STRIPE_MAX_PAGES} pages for ${path}`);
}

function makePriorityLabel(priorityScore) {
  if (priorityScore >= 80) return 'critical';
  if (priorityScore >= 60) return 'high';
  if (priorityScore >= 35) return 'medium';
  return 'low';
}

function makeEmptyBucket(id) {
  return {
    id,
    label: BUCKET_CONFIG[id].label,
    count: 0,
    exposure_cents: 0,
    status: BUCKET_CONFIG[id].status,
    top: null,
  };
}

function buildEntityName(options = [], fallback = 'Unknown entity') {
  for (const option of options) {
    const value = asNonEmptyString(option);
    if (value) return value;
  }
  return fallback;
}

function considerTop(currentTop, candidate) {
  if (!candidate) return currentTop;
  if (!currentTop) return candidate;
  if (candidate.amount_cents !== currentTop.amount_cents) {
    return candidate.amount_cents > currentTop.amount_cents ? candidate : currentTop;
  }
  const currentId = String(currentTop.object_id || '');
  const nextId = String(candidate.object_id || '');
  return nextId.localeCompare(currentId) < 0 ? candidate : currentTop;
}

function buildInvoiceArtifact(invoice, nowMs) {
  const amountCents = coercePositiveCents(invoice?.amount_remaining ?? invoice?.amount_due);
  if (!amountCents) return null;

  const dueDate = coerceInteger(invoice?.due_date, 0);
  if (!dueDate) return null;
  const nowSeconds = Math.floor(nowMs / 1000);
  if (dueDate > nowSeconds) return null;

  const overdueDays = Math.max(1, Math.floor((nowSeconds - dueDate) / 86400));
  const attemptCount = Math.max(0, coerceInteger(invoice?.attempt_count, 0));
  let priorityScore = 20;
  if (amountCents >= 500_000) priorityScore += 35;
  else if (amountCents >= 250_000) priorityScore += 28;
  else if (amountCents >= 100_000) priorityScore += 20;
  else priorityScore += 10;
  if (overdueDays >= 21) priorityScore += 25;
  else if (overdueDays >= 14) priorityScore += 18;
  else priorityScore += 10;
  if (invoice?.collection_method === 'charge_automatically') priorityScore += 10;
  if (attemptCount > 0 && attemptCount <= 3) priorityScore += 5;

  const evidenceLog = [
    `Invoice overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}.`,
    `Collection method: ${asNonEmptyString(invoice?.collection_method) ?? 'unknown'}.`,
  ];
  if (attemptCount > 0) evidenceLog.push(`Retry attempts recorded: ${attemptCount}.`);

  return {
    bucket_id: 'bkt_invoices',
    severity: BUCKET_CONFIG.bkt_invoices.severity,
    entity_name: buildEntityName([
      invoice?.customer_name,
      invoice?.customer_email,
      invoice?.customer,
    ], 'Stripe customer'),
    event_type: 'Invoice Overdue',
    object_id: asNonEmptyString(invoice?.id) ?? 'invoice_unknown',
    amount_cents: amountCents,
    priority_score: priorityScore,
    priority_label: makePriorityLabel(priorityScore),
    recommended_action: 'Review governed recovery workflow before outreach.',
    evidence_log: evidenceLog,
  };
}

function buildRefundArtifact(refund) {
  const amountCents = coercePositiveCents(refund?.amount);
  if (amountCents < REFUND_THRESHOLD_CENTS) return null;
  const reason = asNonEmptyString(refund?.reason);
  const evidenceLog = [
    `Refund amount exceeded baseline threshold of ${REFUND_THRESHOLD_CENTS} cents.`,
  ];
  if (reason) evidenceLog.push(`Refund reason: ${reason}.`);

  const priorityScore = amountCents >= 250_000 ? 78 : amountCents >= 100_000 ? 64 : 48;
  return {
    bucket_id: 'bkt_refunds',
    severity: BUCKET_CONFIG.bkt_refunds.severity,
    entity_name: buildEntityName([
      refund?.charge,
      refund?.payment_intent,
      refund?.id,
    ], 'Stripe refund'),
    event_type: 'Refund Issued',
    object_id: asNonEmptyString(refund?.id) ?? 'refund_unknown',
    amount_cents: amountCents,
    priority_score: priorityScore,
    priority_label: makePriorityLabel(priorityScore),
    recommended_action: 'Review refund against baseline approval policy.',
    evidence_log: evidenceLog,
  };
}

function buildCreditNoteArtifact(creditNote) {
  const amountCents = coercePositiveCents(creditNote?.amount ?? creditNote?.total);
  if (amountCents < CREDIT_NOTE_THRESHOLD_CENTS) return null;
  if (String(creditNote?.status || '').toLowerCase() === 'void') return null;

  const evidenceLog = [
    `Credit note amount exceeded baseline threshold of ${CREDIT_NOTE_THRESHOLD_CENTS} cents.`,
  ];
  if (asNonEmptyString(creditNote?.invoice)) {
    evidenceLog.push(`Linked invoice: ${creditNote.invoice}.`);
  }

  const priorityScore = amountCents >= 250_000 ? 76 : amountCents >= 100_000 ? 62 : 46;
  return {
    bucket_id: 'bkt_refunds',
    severity: BUCKET_CONFIG.bkt_refunds.severity,
    entity_name: buildEntityName([
      creditNote?.customer_name,
      creditNote?.customer,
      creditNote?.invoice,
    ], 'Stripe credit note'),
    event_type: 'Credit Note Issued',
    object_id: asNonEmptyString(creditNote?.id) ?? 'credit_note_unknown',
    amount_cents: amountCents,
    priority_score: priorityScore,
    priority_label: makePriorityLabel(priorityScore),
    recommended_action: 'Review credit note against baseline approval policy.',
    evidence_log,
  };
}

function buildDisputeArtifact(dispute) {
  const amountCents = coercePositiveCents(dispute?.amount);
  if (!amountCents) return null;
  if (String(dispute?.status || '').toLowerCase() !== 'needs_response') return null;

  const dueBy = coerceInteger(dispute?.evidence_details?.due_by, 0);
  const evidenceLog = [
    'Dispute is currently marked needs_response.',
  ];
  if (asNonEmptyString(dispute?.reason)) evidenceLog.push(`Dispute reason: ${dispute.reason}.`);
  if (dueBy) evidenceLog.push(`Evidence due by ${new Date(dueBy * 1000).toISOString()}.`);

  const priorityScore = amountCents >= 250_000 ? 90 : amountCents >= 100_000 ? 84 : 72;
  return {
    bucket_id: 'bkt_disputes',
    severity: BUCKET_CONFIG.bkt_disputes.severity,
    entity_name: buildEntityName([
      dispute?.charge,
      dispute?.payment_intent,
      dispute?.id,
    ], 'Stripe dispute'),
    event_type: 'Open Dispute',
    object_id: asNonEmptyString(dispute?.id) ?? 'dispute_unknown',
    amount_cents: amountCents,
    priority_score: priorityScore,
    priority_label: makePriorityLabel(priorityScore),
    recommended_action: 'Review dispute evidence before the response deadline.',
    evidence_log: evidenceLog,
  };
}

function pickFeaturedArtifact(bucketState) {
  const candidates = Object.values(bucketState)
    .map((bucket) => bucket.top)
    .filter(Boolean);
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    if (b.amount_cents !== a.amount_cents) return b.amount_cents - a.amount_cents;
    return String(a.object_id).localeCompare(String(b.object_id));
  });

  const { severity, bucket_id, ...artifact } = candidates[0];
  return artifact;
}

export function createStripeScanId() {
  return `scn_${crypto.randomBytes(8).toString('hex')}`;
}

export async function buildStripeScanPayload({
  apiKey,
  lookbackDays = DEFAULT_STRIPE_SCAN_LOOKBACK_DAYS,
  scanId,
  nowMs = Date.now(),
  fetchImpl = globalThis.fetch,
}) {
  const lookbackStartSeconds = Math.floor((nowMs - lookbackDays * DAY_MS) / 1000);
  const invoiceFetchStartSeconds = Math.floor((nowMs - DEFAULT_INVOICE_FETCH_HORIZON_DAYS * DAY_MS) / 1000);
  const bucketState = {
    bkt_invoices: makeEmptyBucket('bkt_invoices'),
    bkt_refunds: makeEmptyBucket('bkt_refunds'),
    bkt_disputes: makeEmptyBucket('bkt_disputes'),
  };

  for await (const invoice of listStripeObjects({
    apiKey,
    path: '/invoices',
    params: {
      status: 'open',
      created: { gte: invoiceFetchStartSeconds },
    },
    fetchImpl,
  })) {
    const dueDate = coerceInteger(invoice?.due_date, 0);
    if (!dueDate || dueDate < lookbackStartSeconds) continue;
    const artifact = buildInvoiceArtifact(invoice, nowMs);
    if (!artifact) continue;
    bucketState.bkt_invoices.count += 1;
    bucketState.bkt_invoices.exposure_cents += artifact.amount_cents;
    bucketState.bkt_invoices.top = considerTop(bucketState.bkt_invoices.top, artifact);
  }

  for await (const refund of listStripeObjects({
    apiKey,
    path: '/refunds',
    params: {
      created: { gte: lookbackStartSeconds },
    },
    fetchImpl,
  })) {
    const artifact = buildRefundArtifact(refund);
    if (!artifact) continue;
    bucketState.bkt_refunds.count += 1;
    bucketState.bkt_refunds.exposure_cents += artifact.amount_cents;
    bucketState.bkt_refunds.top = considerTop(bucketState.bkt_refunds.top, artifact);
  }

  for await (const creditNote of listStripeObjects({
    apiKey,
    path: '/credit_notes',
    params: {
      created: { gte: lookbackStartSeconds },
    },
    fetchImpl,
  })) {
    const artifact = buildCreditNoteArtifact(creditNote);
    if (!artifact) continue;
    bucketState.bkt_refunds.count += 1;
    bucketState.bkt_refunds.exposure_cents += artifact.amount_cents;
    bucketState.bkt_refunds.top = considerTop(bucketState.bkt_refunds.top, artifact);
  }

  for await (const dispute of listStripeObjects({
    apiKey,
    path: '/disputes',
    params: {
      created: { gte: lookbackStartSeconds },
    },
    fetchImpl,
  })) {
    const artifact = buildDisputeArtifact(dispute);
    if (!artifact) continue;
    bucketState.bkt_disputes.count += 1;
    bucketState.bkt_disputes.exposure_cents += artifact.amount_cents;
    bucketState.bkt_disputes.top = considerTop(bucketState.bkt_disputes.top, artifact);
  }

  const buckets = [
    bucketState.bkt_invoices,
    bucketState.bkt_refunds,
    bucketState.bkt_disputes,
  ].map(({ id, label, count, exposure_cents, status }) => ({
    id,
    label,
    count,
    exposure_cents,
    status,
  }));

  const totalExposureCents = buckets.reduce((sum, bucket) => sum + bucket.exposure_cents, 0);
  const totalFlaggedEvents = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  return {
    schema_version: STRIPE_SCAN_SCHEMA_VERSION,
    scan_id: scanId,
    timestamp: nowIso(nowMs),
    lookback_days: lookbackDays,
    metrics: {
      total_exposure_cents: totalExposureCents,
      total_flagged_events: totalFlaggedEvents,
    },
    buckets,
    featured_artifact: pickFeaturedArtifact(bucketState),
  };
}

async function markScanFailed(pool, scanId, message) {
  await pool.query(
    `UPDATE tenant_stripe_scans
     SET status = 'failed',
         error_message = $2,
         completed_at = now(),
         updated_at = now()
     WHERE scan_id = $1`,
    [scanId, message],
  );
}

export async function runStripeScan({
  pool,
  scanId,
  tenantId,
  encryptedCredential,
  log = /** @type {(level: string, msg: string) => void} */ (() => {}),
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
}) {
  try {
    await pool.query(
      `UPDATE tenant_stripe_scans
       SET status = 'processing', updated_at = now()
       WHERE scan_id = $1 AND tenant_id = $2 AND status IN ('pending', 'processing')`,
      [scanId, tenantId],
    );

    let apiKey;
    try {
      apiKey = decryptCredential(encryptedCredential);
    } catch (err) {
      throw err;
    }

    await fetchStripeJson({
      apiKey,
      path: '/balance',
      fetchImpl,
      maxAttempts: 2,
    });

    const payload = await buildStripeScanPayload({
      apiKey,
      lookbackDays: DEFAULT_STRIPE_SCAN_LOOKBACK_DAYS,
      scanId,
      nowMs,
      fetchImpl,
    });

    await pool.query(
      `UPDATE tenant_stripe_scans
       SET status = 'completed',
           completed_at = now(),
           error_message = null,
           result_payload = $2::jsonb,
           updated_at = now()
       WHERE scan_id = $1`,
      [scanId, JSON.stringify(payload)],
    );

    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? 'Stripe scan failed');
    try {
      await markScanFailed(pool, scanId, message);
    } catch (persistErr) {
      log('error', `Stripe scan failure persistence failed for ${scanId}: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`);
    }
    log('error', `Stripe scan failed for ${tenantId}: ${message}`);
    throw err;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STRIPE_SCAN_SCHEMA_VERSION,
  buildStripeScanPayload,
  runStripeScan,
} from '../services/runtime/stripe-scans.js';

test('buildStripeScanPayload is deterministic for a fixed clock and Stripe fixture set', async () => {
  const nowMs = Date.parse('2026-04-04T15:29:28Z');
  const invoiceDue = Math.floor((nowMs - 5 * 24 * 60 * 60 * 1000) / 1000);
  const disputeDue = Math.floor((nowMs + 2 * 24 * 60 * 60 * 1000) / 1000);
  const fetchMock = async (url) => {
    const href = String(url);
    if (href.startsWith('https://api.stripe.com/v1/invoices')) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                id: 'in_002',
                status: 'open',
                due_date: invoiceDue,
                amount_remaining: 840000,
                customer_name: 'Acme Manufacturing',
                customer_email: 'ap@acme.test',
                collection_method: 'charge_automatically',
                attempt_count: 1,
              },
            ],
            has_more: false,
          };
        },
      };
    }
    if (href.startsWith('https://api.stripe.com/v1/refunds')) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              { id: 're_small', amount: 1000, reason: 'duplicate', created: Math.floor(nowMs / 1000) },
              { id: 're_001', amount: 425000, reason: 'requested_by_customer', charge: 'ch_refund', created: Math.floor(nowMs / 1000) },
            ],
            has_more: false,
          };
        },
      };
    }
    if (href.startsWith('https://api.stripe.com/v1/credit_notes')) {
      return {
        ok: true,
        async json() {
          return {
            data: [],
            has_more: false,
          };
        },
      };
    }
    if (href.startsWith('https://api.stripe.com/v1/disputes')) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                id: 'dp_001',
                amount: 163500,
                status: 'needs_response',
                reason: 'fraudulent',
                charge: 'ch_dispute',
                evidence_details: { due_by: disputeDue },
                created: Math.floor(nowMs / 1000),
              },
            ],
            has_more: false,
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  const first = await buildStripeScanPayload({
    apiKey: 'sk_test_fixture',
    scanId: 'scn_fixture',
    nowMs,
    fetchImpl: fetchMock,
  });
  const second = await buildStripeScanPayload({
    apiKey: 'sk_test_fixture',
    scanId: 'scn_fixture',
    nowMs,
    fetchImpl: fetchMock,
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, STRIPE_SCAN_SCHEMA_VERSION);
  assert.equal(first.metrics.total_exposure_cents, 1_428_500);
  assert.equal(first.metrics.total_flagged_events, 3);
  assert.equal(first.buckets[0].id, 'bkt_invoices');
  assert.equal(first.buckets[0].exposure_cents, 840000);
  assert.equal(first.buckets[1].exposure_cents, 425000);
  assert.equal(first.buckets[2].exposure_cents, 163500);
  assert.equal(first.featured_artifact.object_id, 'dp_001');
  assert.equal(first.featured_artifact.amount_cents, 163500);
  assert.equal(first.featured_artifact.priority_label, 'critical');
});

test('runStripeScan marks the scan failed when the stored credential cannot be decrypted', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowInsecure = process.env.ALLOW_INSECURE_CREDENTIALS;
  const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_INSECURE_CREDENTIALS;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;

  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };

  try {
    await assert.rejects(
      runStripeScan({
        pool,
        scanId: 'scn_fail',
        tenantId: 'tenant_fail',
        encryptedCredential: '00:11:22',
        log: () => {},
      }),
      /Stored credential could not be decrypted|CREDENTIAL_ENCRYPTION_KEY/,
    );

    const failureUpdate = pool.queries.find((entry) => entry.sql.includes("SET status = 'failed'"));
    assert.ok(failureUpdate);
    assert.equal(failureUpdate.params[0], 'scn_fail');
  } finally {
    if (originalNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowInsecure == null) delete process.env.ALLOW_INSECURE_CREDENTIALS;
    else process.env.ALLOW_INSECURE_CREDENTIALS = originalAllowInsecure;
    if (originalKey == null) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});

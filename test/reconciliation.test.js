import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStripeData } from '../src/api/reconciliation.ts';

describe('Stripe reconciliation', () => {
  it('reports matching counts when all objects are imported', async () => {
    const pool = {
      query(sql) {
        if (sql.includes('world_objects') && sql.includes('GROUP BY')) {
          return {
            rows: [
              { type: 'party', count: '3' },
              { type: 'invoice', count: '5' },
              { type: 'payment', count: '2' },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const mockFetch = (url) => {
      const u = url.toString();
      if (u.includes('/v1/customers')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 3 }) };
      if (u.includes('/v1/invoices')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 5 }) };
      if (u.includes('/v1/payment_intents')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 2 }) };
      return { ok: false };
    };

    const report = await reconcileStripeData(pool, 'tenant_test', 'sk_test_fake', { fetchFn: mockFetch });

    assert.equal(report.customers.stripe, 3);
    assert.equal(report.customers.imported, 3);
    assert.equal(report.customers.match, true);
    assert.equal(report.invoices.stripe, 5);
    assert.equal(report.invoices.imported, 5);
    assert.equal(report.invoices.match, true);
    assert.equal(report.allMatch, true);
  });

  it('reports mismatches when counts differ', async () => {
    const pool = {
      query(sql) {
        if (sql.includes('world_objects') && sql.includes('GROUP BY')) {
          return { rows: [{ type: 'party', count: '2' }, { type: 'invoice', count: '3' }] };
        }
        return { rows: [] };
      },
    };

    const mockFetch = (url) => {
      const u = url.toString();
      if (u.includes('/v1/customers')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 5 }) };
      if (u.includes('/v1/invoices')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 3 }) };
      if (u.includes('/v1/payment_intents')) return { ok: true, json: () => ({ data: [], has_more: false, total_count: 0 }) };
      return { ok: false };
    };

    const report = await reconcileStripeData(pool, 'tenant_test', 'sk_test_fake', { fetchFn: mockFetch });

    assert.equal(report.customers.stripe, 5);
    assert.equal(report.customers.imported, 2);
    assert.equal(report.customers.match, false);
    assert.equal(report.allMatch, false);
  });
});

/**
 * Stripe reconciliation report.
 *
 * Compares Stripe source-of-truth counts against imported world_objects
 * to verify backfill completeness. Used by gate item 4.
 */

import type pg from 'pg';

export interface ReconciliationReport {
  tenantId: string;
  generatedAt: string;
  customers: { stripe: number; imported: number; match: boolean };
  invoices: { stripe: number; imported: number; match: boolean };
  payments: { stripe: number; imported: number; match: boolean };
  allMatch: boolean;
}

async function countStripeObjects(
  apiKey: string,
  resource: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  let count = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const url = new URL(`https://api.stripe.com/v1/${resource}`);
    url.searchParams.set('limit', '100');
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    const res = await fetchFn(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) break;
    const data = await res.json();

    if (data.total_count !== undefined && !startingAfter) {
      return data.total_count;
    }

    count += (data.data || []).length;
    hasMore = data.has_more ?? false;
    startingAfter = data.data?.[data.data.length - 1]?.id;
  }

  return count;
}

export async function reconcileStripeData(
  pool: pg.Pool,
  tenantId: string,
  apiKey: string,
  opts?: { fetchFn?: typeof fetch },
): Promise<ReconciliationReport> {
  const fetchFn = opts?.fetchFn ?? fetch;

  const importedResult = await pool.query(
    `SELECT type, COUNT(*)::int AS count
     FROM world_objects
     WHERE tenant_id = $1 AND NOT tombstone AND valid_to IS NULL
     GROUP BY type`,
    [tenantId],
  );

  const importedCounts: Record<string, number> = {};
  for (const row of importedResult.rows) {
    importedCounts[row.type] = Number(row.count);
  }

  const [stripeCustomers, stripeInvoices, stripePayments] = await Promise.all([
    countStripeObjects(apiKey, 'customers', fetchFn),
    countStripeObjects(apiKey, 'invoices', fetchFn),
    countStripeObjects(apiKey, 'payment_intents', fetchFn),
  ]);

  const customers = {
    stripe: stripeCustomers,
    imported: importedCounts['party'] ?? 0,
    match: stripeCustomers === (importedCounts['party'] ?? 0),
  };
  const invoices = {
    stripe: stripeInvoices,
    imported: importedCounts['invoice'] ?? 0,
    match: stripeInvoices === (importedCounts['invoice'] ?? 0),
  };
  const payments = {
    stripe: stripePayments,
    imported: importedCounts['payment'] ?? 0,
    match: stripePayments === (importedCounts['payment'] ?? 0),
  };

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    customers,
    invoices,
    payments,
    allMatch: customers.match && invoices.match && payments.match,
  };
}

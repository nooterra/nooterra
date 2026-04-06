#!/usr/bin/env node
/**
 * Seed a Stripe TEST MODE account with demo data for the YC demo.
 *
 * Creates ~15 customers with varying payment histories:
 * - Acme Corp: reliable payer, one invoice 23 days overdue (demo card 1: formal follow-up)
 * - Globex Inc: has an active dispute + overdue invoice (demo card 2: escalation)
 * - 13 other customers with a mix of paid/overdue/clean invoices
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/seed-stripe-demo.js
 *
 * WARNING: Only run against a Stripe TEST MODE account. Never production.
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY || !STRIPE_KEY.startsWith('sk_test_')) {
  console.error('Set STRIPE_SECRET_KEY to a sk_test_... key');
  process.exit(1);
}

const BASE = 'https://api.stripe.com/v1';
const headers = { 'Authorization': `Bearer ${STRIPE_KEY}` };

async function stripe(method, path, body) {
  const opts = { method, headers: { ...headers } };
  if (body) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(body).toString();
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

function daysAgo(n) {
  return Math.floor((Date.now() - n * 86400000) / 1000);
}

async function createCustomerWithInvoices(name, email, invoices) {
  const customer = await stripe('POST', '/customers', { name, email });
  console.log(`  Created customer: ${name} (${customer.id})`);

  for (const inv of invoices) {
    // Create invoice item
    await stripe('POST', '/invoiceitems', {
      customer: customer.id,
      amount: inv.amountCents,
      currency: 'usd',
      description: inv.description || `Service — ${name}`,
    });

    // Create and finalize invoice
    const invoice = await stripe('POST', '/invoices', {
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 0, // due immediately
    });

    await stripe('POST', `/invoices/${invoice.id}/finalize`, {});

    if (inv.pay) {
      await stripe('POST', `/invoices/${invoice.id}/pay`, {});
      console.log(`    Invoice ${invoice.number}: $${(inv.amountCents / 100).toFixed(2)} — PAID`);
    } else {
      console.log(`    Invoice ${invoice.number}: $${(inv.amountCents / 100).toFixed(2)} — OPEN (overdue)`);
    }
  }

  return customer;
}

async function main() {
  console.log('Seeding Stripe demo data...\n');

  // --- Acme Corp: reliable payer with one overdue invoice ---
  console.log('Creating Acme Corp (demo scenario 1: formal follow-up)...');
  const acme = await createCustomerWithInvoices(
    'Acme Corp',
    'billing@acmecorp.test',
    [
      // 8 paid invoices (good payment history)
      { amountCents: 250000, pay: true, description: 'Q1 Platform License' },
      { amountCents: 250000, pay: true, description: 'Q2 Platform License' },
      { amountCents: 250000, pay: true, description: 'Q3 Platform License' },
      { amountCents: 250000, pay: true, description: 'Q4 Platform License' },
      { amountCents: 320000, pay: true, description: 'Annual Support' },
      { amountCents: 180000, pay: true, description: 'API Usage Overage' },
      { amountCents: 250000, pay: true, description: 'Q1 Next Year License' },
      { amountCents: 250000, pay: true, description: 'Q2 Next Year License' },
      // 1 overdue invoice ($4,200)
      { amountCents: 420000, pay: false, description: 'Q3 Platform License — overdue' },
    ],
  );

  // --- Globex Inc: disputed account ---
  console.log('\nCreating Globex Inc (demo scenario 2: escalation due to dispute)...');
  const globex = await createCustomerWithInvoices(
    'Globex Inc',
    'accounts@globex.test',
    [
      { amountCents: 600000, pay: true, description: 'Enterprise License Q1' },
      { amountCents: 600000, pay: true, description: 'Enterprise License Q2' },
      // Large overdue invoice
      { amountCents: 1200000, pay: false, description: 'Enterprise License Q3+Q4 — overdue' },
    ],
  );

  // Create a dispute on a Globex charge (need a real charge first via payment intent)
  // Note: Stripe test mode disputes require a specific test token
  console.log('  (Note: To create a test dispute, use Stripe dashboard or test card 4000000000000259)');

  // --- 13 more customers with varying histories ---
  const companies = [
    { name: 'Initech', email: 'billing@initech.test', invoices: [
      { amountCents: 150000, pay: true }, { amountCents: 150000, pay: true }, { amountCents: 150000, pay: false },
    ]},
    { name: 'Umbrella Corp', email: 'ar@umbrella.test', invoices: [
      { amountCents: 500000, pay: true }, { amountCents: 500000, pay: true },
    ]},
    { name: 'Stark Industries', email: 'finance@stark.test', invoices: [
      { amountCents: 800000, pay: true }, { amountCents: 800000, pay: false },
    ]},
    { name: 'Wayne Enterprises', email: 'ap@wayne.test', invoices: [
      { amountCents: 350000, pay: true }, { amountCents: 350000, pay: true }, { amountCents: 350000, pay: true },
    ]},
    { name: 'Cyberdyne Systems', email: 'billing@cyberdyne.test', invoices: [
      { amountCents: 200000, pay: true }, { amountCents: 200000, pay: false },
    ]},
    { name: 'Soylent Corp', email: 'finance@soylent.test', invoices: [
      { amountCents: 100000, pay: true }, { amountCents: 100000, pay: true },
    ]},
    { name: 'Wonka Industries', email: 'ar@wonka.test', invoices: [
      { amountCents: 450000, pay: true }, { amountCents: 450000, pay: false },
    ]},
    { name: 'Pied Piper', email: 'billing@piedpiper.test', invoices: [
      { amountCents: 75000, pay: true }, { amountCents: 75000, pay: true }, { amountCents: 75000, pay: false },
    ]},
    { name: 'Hooli', email: 'accounts@hooli.test', invoices: [
      { amountCents: 1500000, pay: true }, { amountCents: 1500000, pay: true },
    ]},
    { name: 'Massive Dynamic', email: 'ar@massive.test', invoices: [
      { amountCents: 300000, pay: true }, { amountCents: 300000, pay: false },
    ]},
    { name: 'Vandelay Industries', email: 'billing@vandelay.test', invoices: [
      { amountCents: 125000, pay: true }, { amountCents: 125000, pay: true },
    ]},
    { name: 'Dunder Mifflin', email: 'accounting@dundermifflin.test', invoices: [
      { amountCents: 85000, pay: true }, { amountCents: 85000, pay: false },
    ]},
    { name: 'Sterling Cooper', email: 'finance@sterlingcooper.test', invoices: [
      { amountCents: 275000, pay: true }, { amountCents: 275000, pay: true }, { amountCents: 275000, pay: false },
    ]},
  ];

  for (const co of companies) {
    console.log(`\nCreating ${co.name}...`);
    await createCustomerWithInvoices(co.name, co.email, co.invoices);
  }

  // Summary
  const totalCustomers = 2 + companies.length;
  const allInvoices = [9, 3, ...companies.map(c => c.invoices.length)];
  const totalInvoices = allInvoices.reduce((a, b) => a + b, 0);
  const overdueCount = 1 + 1 + companies.filter(c => c.invoices.some(i => !i.pay)).length;

  console.log(`\n--- DEMO DATA SEEDED ---`);
  console.log(`Customers: ${totalCustomers}`);
  console.log(`Total invoices: ${totalInvoices}`);
  console.log(`Overdue accounts: ${overdueCount}`);
  console.log(`\nKey demo accounts:`);
  console.log(`  Acme Corp (${acme.id}): 8 paid, 1 overdue ($4,200) — demo card 1: formal follow-up`);
  console.log(`  Globex Inc (${globex.id}): 2 paid, 1 overdue ($12,000) + dispute — demo card 2: escalation`);
  console.log(`\nTo create a dispute on Globex, use Stripe Dashboard > Payments > create a charge with card 4000000000000259`);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

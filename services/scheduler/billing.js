/** Stripe Billing — subscriptions + credit top-ups via Stripe Checkout (raw fetch, no SDK). */
import crypto from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

async function stripeRequest(endpoint, body, method = 'POST') {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'Stripe API error');
    err.stripeError = data.error;
    throw err;
  }
  return data;
}

async function stripeGet(endpoint) {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` },
  });
  return res.json();
}

const PLANS = {
  pro:   { name: 'Nooterra Pro Monthly',   amount: 2900,  recurring: true },
  scale: { name: 'Nooterra Scale Monthly',  amount: 9900,  recurring: true },
};
const CREDIT_AMOUNTS = {
  5:   { name: 'Nooterra Credits $5',   amount: 500 },
  20:  { name: 'Nooterra Credits $20',  amount: 2000 },
  50:  { name: 'Nooterra Credits $50',  amount: 5000 },
  100: { name: 'Nooterra Credits $100', amount: 10000 },
};
const priceCache = {}; // key → Stripe price ID

async function ensurePrice(key, spec) {
  if (priceCache[key]) return priceCache[key];

  const existing = await stripeGet(`/prices?lookup_keys[]=${encodeURIComponent(key)}&active=true&limit=1`);
  if (existing.data?.length > 0) {
    priceCache[key] = existing.data[0].id;
    return priceCache[key];
  }

  const product = await stripeRequest('/products', {
    name: spec.name,
    'metadata[nooterra_key]': key,
  });

  const priceParams = {
    product: product.id,
    currency: 'usd',
    unit_amount: String(spec.amount),
    lookup_key: key,
  };

  if (spec.recurring) {
    priceParams['recurring[interval]'] = 'month';
  }

  const price = await stripeRequest('/prices', priceParams);
  priceCache[key] = price.id;
  return price.id;
}


async function getOrCreateCustomer(tenantId, email, pool) {
  const result = await pool.query(
    'SELECT stripe_customer_id FROM tenant_credits WHERE tenant_id = $1',
    [tenantId]
  );

  const existingId = result.rows[0]?.stripe_customer_id;
  if (existingId) return existingId;

  const customer = await stripeRequest('/customers', {
    email,
    'metadata[tenant_id]': tenantId,
  });

  try {
    await pool.query(
      `ALTER TABLE tenant_credits ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`
    );
  } catch { /* column may already exist */ }

  await pool.query(
    'UPDATE tenant_credits SET stripe_customer_id = $2 WHERE tenant_id = $1',
    [customer.id, tenantId]
  );

  return customer.id;
}

/** Create a Stripe Checkout session for a subscription. */
export async function createCheckoutSession({ tenantId, email, plan, successUrl, cancelUrl }, pool) {
  if (!PLANS[plan]) throw new Error(`Unknown plan: ${plan}`);

  const customerId = await getOrCreateCustomer(tenantId, email, pool);
  const priceId = await ensurePrice(`nooterra_${plan}_monthly`, PLANS[plan]);

  const session = await stripeRequest('/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl || 'https://nooterra.ai/dashboard?billing=success',
    cancel_url: cancelUrl || 'https://nooterra.ai/dashboard?billing=cancelled',
    'metadata[tenant_id]': tenantId,
    'metadata[type]': 'subscription',
    'metadata[plan]': plan,
  });

  return { sessionId: session.id, url: session.url };
}

/** Create a Stripe Checkout session for a one-time credit purchase. */
export async function createCreditPurchase({ tenantId, email, amount, successUrl, cancelUrl }, pool) {
  const spec = CREDIT_AMOUNTS[amount];
  if (!spec) throw new Error(`Invalid credit amount: $${amount}. Choose $5, $20, $50, or $100.`);

  const customerId = await getOrCreateCustomer(tenantId, email, pool);
  const priceId = await ensurePrice(`nooterra_credits_${amount}`, spec);

  const session = await stripeRequest('/checkout/sessions', {
    customer: customerId,
    mode: 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl || 'https://nooterra.ai/dashboard?billing=success',
    cancel_url: cancelUrl || 'https://nooterra.ai/dashboard?billing=cancelled',
    'metadata[tenant_id]': tenantId,
    'metadata[type]': 'credits',
    'metadata[amount]': String(amount),
  });

  return { sessionId: session.id, url: session.url };
}

/** Handle incoming Stripe webhook events. Needs raw body for signature verification. */
export async function handleStripeWebhook(rawBody, signatureHeader, pool, log) {
  const event = verifyWebhookSignature(rawBody, signatureHeader);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.metadata?.tenant_id;
      if (!tenantId) break;

      if (session.metadata.type === 'subscription') {
        const plan = session.metadata.plan;
        try {
          await pool.query(`ALTER TABLE tenant_credits ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free'`);
          await pool.query(`ALTER TABLE tenant_credits ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
        } catch { /* ignore */ }
        await pool.query(`
          UPDATE tenant_credits SET
            tier = $2,
            stripe_subscription_id = $3,
            updated_at = now()
          WHERE tenant_id = $1
        `, [tenantId, plan, session.subscription]);
        log('info', `Tenant ${tenantId} subscribed to ${plan}`);
      } else if (session.metadata.type === 'credits') {
        const amount = parseFloat(session.metadata.amount);
        const txnId = `txn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`
            UPDATE tenant_credits SET
              balance_usd = balance_usd + $2,
              updated_at = now()
            WHERE tenant_id = $1
          `, [tenantId, amount]);
          await client.query(`
            INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, created_at)
            VALUES ($1, $2, $3, 'purchase', $4, now())
          `, [txnId, tenantId, amount, `Credit top-up: $${amount}`]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }

        log('info', `Tenant ${tenantId} purchased $${amount} in credits`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const tenantId = subscription.metadata?.tenant_id;
      if (!tenantId) {
        const result = await pool.query(
          'SELECT tenant_id FROM tenant_credits WHERE stripe_subscription_id = $1',
          [subscription.id]
        );
        const tid = result.rows[0]?.tenant_id;
        if (tid) {
          await pool.query(`
            UPDATE tenant_credits SET tier = 'free', stripe_subscription_id = NULL, updated_at = now()
            WHERE tenant_id = $1
          `, [tid]);
          log('info', `Tenant ${tid} subscription cancelled — downgraded to free`);
        }
      } else {
        await pool.query(`
          UPDATE tenant_credits SET tier = 'free', stripe_subscription_id = NULL, updated_at = now()
          WHERE tenant_id = $1
        `, [tenantId]);
        log('info', `Tenant ${tenantId} subscription cancelled — downgraded to free`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      log('warn', `Payment failed for customer ${invoice.customer}, invoice ${invoice.id}`);
      break;
    }

    default:
      log('info', `Unhandled Stripe event: ${event.type}`);
  }

  return { received: true };
}

/** Get billing status for a tenant. */
export async function getBillingStatus(tenantId, pool) {
  const result = await pool.query(`
    SELECT balance_usd, total_spent_usd, tier, stripe_subscription_id, stripe_customer_id
    FROM tenant_credits
    WHERE tenant_id = $1
  `, [tenantId]);

  const row = result.rows[0];
  if (!row) {
    return { tier: 'free', credits: 0, totalSpent: 0, subscription: null };
  }

  return {
    tier: row.tier || 'free',
    credits: parseFloat(row.balance_usd) || 0,
    totalSpent: parseFloat(row.total_spent_usd) || 0,
    subscription: row.stripe_subscription_id || null,
    hasPaymentMethod: !!row.stripe_customer_id,
  };
}


function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return JSON.parse(rawBody); // dev mode: skip verification
  }

  const parts = (signatureHeader || '').split(',').reduce((acc, part) => {
    const [key, val] = part.split('=');
    if (key && val) acc[key.trim()] = val.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    throw new Error('Missing webhook signature components');
  }

  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > 300) {
    throw new Error('Webhook timestamp too old');
  }

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('Invalid webhook signature');
  }

  return JSON.parse(rawBody);
}

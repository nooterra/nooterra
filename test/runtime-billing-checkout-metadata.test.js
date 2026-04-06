import test from 'node:test';
import assert from 'node:assert/strict';

import { createCheckoutSession, createCreditPurchase } from '../services/runtime/billing.js';

function createPool() {
  return {
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement === 'SELECT stripe_customer_id FROM tenant_credits WHERE tenant_id = $1') {
        return { rowCount: 1, rows: [{ stripe_customer_id: null }] };
      }
      if (statement.startsWith('ALTER TABLE tenant_credits ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT')) {
        return { rowCount: 0, rows: [] };
      }
      if (statement === 'UPDATE tenant_credits SET stripe_customer_id = $2 WHERE tenant_id = $1') {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unhandled SQL in runtime billing metadata test: ${statement} :: ${JSON.stringify(params)}`);
    },
  };
}

test('billing checkout session propagates tenant metadata into subscription-created Stripe objects', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? String(options.body) : '' });
    if (String(url).endsWith('/customers')) {
      return { json: async () => ({ id: 'cus_123' }) };
    }
    if (String(url).includes('/prices?lookup_keys')) {
      return { json: async () => ({ data: [] }) };
    }
    if (String(url).endsWith('/products')) {
      return { json: async () => ({ id: 'prod_123' }) };
    }
    if (String(url).endsWith('/prices')) {
      return { json: async () => ({ id: 'price_123' }) };
    }
    if (String(url).endsWith('/checkout/sessions')) {
      return { json: async () => ({ id: 'cs_123', url: 'https://stripe.test/session' }) };
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  try {
    const result = await createCheckoutSession({
      tenantId: 'tenant_world',
      email: 'billing@acme.test',
      plan: 'starter',
      successUrl: 'https://nooterra.test/success',
      cancelUrl: 'https://nooterra.test/cancel',
    }, createPool());

    assert.equal(result.sessionId, 'cs_123');
    const sessionCall = calls.find((entry) => entry.url.endsWith('/checkout/sessions'));
    assert.ok(sessionCall, 'Expected checkout session call');
    const params = new URLSearchParams(sessionCall.body);
    assert.equal(params.get('metadata[tenant_id]'), 'tenant_world');
    assert.equal(params.get('subscription_data[metadata][tenant_id]'), 'tenant_world');
    assert.equal(params.get('subscription_data[metadata][plan]'), 'starter');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('billing checkout session canonicalizes legacy plan aliases before talking to Stripe', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? String(options.body) : '' });
    if (String(url).endsWith('/customers')) {
      return { json: async () => ({ id: 'cus_alias_123' }) };
    }
    if (String(url).includes('/prices?lookup_keys')) {
      return { json: async () => ({ data: [] }) };
    }
    if (String(url).endsWith('/products')) {
      return { json: async () => ({ id: 'prod_alias_123' }) };
    }
    if (String(url).endsWith('/prices')) {
      return { json: async () => ({ id: 'price_alias_123' }) };
    }
    if (String(url).endsWith('/checkout/sessions')) {
      return { json: async () => ({ id: 'cs_alias_123', url: 'https://stripe.test/session-alias' }) };
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  try {
    await createCheckoutSession({
      tenantId: 'tenant_alias',
      email: 'billing@acme.test',
      plan: 'builder',
      successUrl: 'https://nooterra.test/success',
      cancelUrl: 'https://nooterra.test/cancel',
    }, createPool());

    const sessionCall = calls.find((entry) => entry.url.endsWith('/checkout/sessions'));
    assert.ok(sessionCall, 'Expected checkout session call');
    const params = new URLSearchParams(sessionCall.body);
    assert.equal(params.get('metadata[plan]'), 'starter');
    assert.equal(params.get('subscription_data[metadata][plan]'), 'starter');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('billing credit purchase propagates tenant metadata into payment intent metadata', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? String(options.body) : '' });
    if (String(url).endsWith('/customers')) {
      return { json: async () => ({ id: 'cus_credits_123' }) };
    }
    if (String(url).includes('/prices?lookup_keys')) {
      return { json: async () => ({ data: [] }) };
    }
    if (String(url).endsWith('/products')) {
      return { json: async () => ({ id: 'prod_credits_123' }) };
    }
    if (String(url).endsWith('/prices')) {
      return { json: async () => ({ id: 'price_credits_123' }) };
    }
    if (String(url).endsWith('/checkout/sessions')) {
      return { json: async () => ({ id: 'cs_credits_123', url: 'https://stripe.test/credits' }) };
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  try {
    const result = await createCreditPurchase({
      tenantId: 'tenant_world',
      email: 'billing@acme.test',
      amount: 20,
      successUrl: 'https://nooterra.test/success',
      cancelUrl: 'https://nooterra.test/cancel',
    }, createPool());

    assert.equal(result.sessionId, 'cs_credits_123');
    const sessionCall = calls.find((entry) => entry.url.endsWith('/checkout/sessions'));
    assert.ok(sessionCall, 'Expected credit checkout session call');
    const params = new URLSearchParams(sessionCall.body);
    assert.equal(params.get('metadata[tenant_id]'), 'tenant_world');
    assert.equal(params.get('payment_intent_data[metadata][tenant_id]'), 'tenant_world');
    assert.equal(params.get('payment_intent_data[metadata][amount]'), '20');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

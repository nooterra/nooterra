import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { request } from "./api-test-harness.js";

function makeStripeSubscriptionUpdatedEvent({
  eventId,
  subscriptionId,
  customerId,
  priceId,
  status = "active",
  created = 1738938000
}) {
  return {
    id: eventId,
    type: "customer.subscription.updated",
    created,
    data: {
      object: {
        id: subscriptionId,
        customer: customerId,
        status,
        current_period_start: created,
        current_period_end: created + 2_419_200,
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: priceId,
                metadata: {
                  settldPlan: "growth"
                }
              }
            }
          ]
        },
        metadata: {}
      }
    }
  };
}

test("API e2e: billing subscription endpoint upserts provider state and plan", async () => {
  const api = createApi({
    now: () => "2026-02-07T00:00:00.000Z",
    opsTokens: "tok_finr:finance_read;tok_finw:finance_write"
  });

  const tenantId = "tenant_billing_subscription_manual";

  const upsert = await request(api, {
    method: "PUT",
    path: "/ops/finance/billing/subscription",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw"
    },
    body: {
      plan: "builder",
      subscription: {
        provider: "stripe",
        customerId: "cus_manual_001",
        subscriptionId: "sub_manual_001",
        status: "active",
        currentPeriodStart: "2026-02-01T00:00:00.000Z",
        currentPeriodEnd: "2026-03-01T00:00:00.000Z"
      }
    }
  });
  assert.equal(upsert.statusCode, 200);
  assert.equal(upsert.json?.subscription?.provider, "stripe");
  assert.equal(upsert.json?.subscription?.subscriptionId, "sub_manual_001");
  assert.equal(upsert.json?.resolvedPlan?.planId, "builder");

  const getPlan = await request(api, {
    method: "GET",
    path: "/ops/finance/billing/plan",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(getPlan.statusCode, 200);
  assert.equal(getPlan.json?.billing?.plan, "builder");

  const getSubscription = await request(api, {
    method: "GET",
    path: "/ops/finance/billing/subscription",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(getSubscription.statusCode, 200);
  assert.equal(getSubscription.json?.subscription?.customerId, "cus_manual_001");
  assert.equal(getSubscription.json?.subscription?.status, "active");
});

test("API e2e: stripe billing webhook is idempotent and syncs growth plan", async () => {
  const api = createApi({
    now: () => "2026-02-07T00:00:00.000Z",
    opsTokens: "tok_finr:finance_read;tok_finw:finance_write"
  });

  const tenantId = "tenant_billing_webhook_stripe";
  const payload = makeStripeSubscriptionUpdatedEvent({
    eventId: "evt_sub_updated_001",
    subscriptionId: "sub_stripe_001",
    customerId: "cus_stripe_001",
    priceId: "price_growth_monthly"
  });

  const first = await request(api, {
    method: "POST",
    path: "/ops/finance/billing/providers/stripe/webhook",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw"
    },
    body: payload
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json?.duplicate, false);
  assert.equal(first.json?.applied?.planChanged, true);
  assert.equal(first.json?.applied?.nextPlan, "growth");
  assert.equal(first.json?.subscription?.priceId, "price_growth_monthly");

  const duplicate = await request(api, {
    method: "POST",
    path: "/ops/finance/billing/providers/stripe/webhook",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finw"
    },
    body: payload
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json?.duplicate, true);

  const getPlan = await request(api, {
    method: "GET",
    path: "/ops/finance/billing/plan",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(getPlan.statusCode, 200);
  assert.equal(getPlan.json?.billing?.plan, "growth");

  const getSubscription = await request(api, {
    method: "GET",
    path: "/ops/finance/billing/subscription",
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-ops-token": "tok_finr"
    }
  });
  assert.equal(getSubscription.statusCode, 200);
  assert.equal(getSubscription.json?.subscription?.provider, "stripe");
  assert.equal(getSubscription.json?.subscription?.subscriptionId, "sub_stripe_001");
  assert.equal(getSubscription.json?.subscription?.status, "active");
});

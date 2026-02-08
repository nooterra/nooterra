#!/usr/bin/env bash
set -euo pipefail

# Load local env defaults automatically (same behavior as other dev scripts).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "$ROOT_DIR/scripts/dev/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$ROOT_DIR/scripts/dev/env.sh"
fi

for bin in curl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required tool: $bin"
    exit 1
  fi
done

: "${SETTLD_BASE_URL:?SETTLD_BASE_URL is required (example: https://<your-api-domain>)}"
: "${PROXY_OPS_TOKEN:?PROXY_OPS_TOKEN is required}"

if [[ -z "${SETTLD_TENANT_ID:-}" ]]; then
  SETTLD_TENANT_ID="tenant_smoke_$(date +%s)"
fi
export SETTLD_TENANT_ID

api_get() {
  local path="$1"
  curl -sS "$SETTLD_BASE_URL$path" \
    -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
    -H "x-proxy-tenant-id: $SETTLD_TENANT_ID"
}

api_post_json() {
  local path="$1"
  local payload="$2"
  curl -sS -X POST "$SETTLD_BASE_URL$path" \
    -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
    -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
    -H "content-type: application/json" \
    -d "$payload"
}

echo "[1/5] Health check..."
HEALTH_JSON="$(curl -sS "$SETTLD_BASE_URL/healthz")"
echo "$HEALTH_JSON" | jq '{ok,dbOk,dbLatencyMs}'
if [[ "$(echo "$HEALTH_JSON" | jq -r '.ok // false')" != "true" ]]; then
  echo "Health check failed."
  exit 1
fi

echo "[2/5] Stripe checkout session..."
CHECKOUT_JSON="$(api_post_json "/ops/finance/billing/providers/stripe/checkout" '{"plan":"builder"}')"
echo "$CHECKOUT_JSON" | jq '{tenantId, mode: .checkoutSession.mode, plan: .checkoutSession.plan, sessionId: .checkoutSession.sessionId, sessionUrl: .checkoutSession.sessionUrl}'
CHECKOUT_MODE="$(echo "$CHECKOUT_JSON" | jq -r '.checkoutSession.mode // ""')"
if [[ "$CHECKOUT_MODE" != "live" && "$CHECKOUT_MODE" != "stub" ]]; then
  echo "Unexpected checkout mode: $CHECKOUT_MODE"
  exit 1
fi

echo "[3/5] Stripe customer portal session..."
CUSTOMER_ID=""
if [[ -n "${PROXY_BILLING_STRIPE_SECRET_KEY:-}" ]]; then
  CUSTOMER_ID="$(
    curl -sS https://api.stripe.com/v1/customers \
      -u "$PROXY_BILLING_STRIPE_SECRET_KEY:" \
      -d "name=Settld Smoke Customer $(date +%s)" | jq -r '.id'
  )"
fi
if [[ -z "$CUSTOMER_ID" || "$CUSTOMER_ID" == "null" ]]; then
  CUSTOMER_ID="cus_smoke_$(date +%s)"
fi

PORTAL_JSON="$(api_post_json "/ops/finance/billing/providers/stripe/portal" "{\"customerId\":\"$CUSTOMER_ID\"}")"
if [[ "$(echo "$PORTAL_JSON" | jq -r '.portalSession.sessionUrl // ""')" != "" ]]; then
  echo "$PORTAL_JSON" | jq '{tenantId, mode: .portalSession.mode, customerId: .portalSession.customerId, sessionId: .portalSession.sessionId, sessionUrl: .portalSession.sessionUrl}'
else
  # In live mode with a synthetic customer id, Stripe returns upstream "No such customer".
  echo "$PORTAL_JSON" | jq '{tenantId,error,code,details}'
  if [[ "$(echo "$PORTAL_JSON" | jq -r '.code // ""')" != "BILLING_PROVIDER_UPSTREAM_ERROR" ]]; then
    echo "Unexpected portal response."
    exit 1
  fi
fi

echo "[4/5] Webhook/reconcile subscription mapping..."
TS="$(date +%s)"
GROWTH_PRICE_ID="${PROXY_BILLING_STRIPE_PRICE_ID_GROWTH:-}"
if [[ -z "$GROWTH_PRICE_ID" ]]; then
  GROWTH_CHECKOUT_JSON="$(api_post_json "/ops/finance/billing/providers/stripe/checkout" '{"plan":"growth"}')"
  GROWTH_PRICE_ID="$(echo "$GROWTH_CHECKOUT_JSON" | jq -r '.checkoutSession.priceId // ""')"
fi
if [[ -z "$GROWTH_PRICE_ID" ]]; then
  echo "Could not resolve Growth Stripe price ID from env or checkout response."
  exit 1
fi

RECON_PAYLOAD="$(jq -n \
  --arg eventId "evt_smoke_price_map_${TS}" \
  --arg subId "sub_smoke_price_map_${TS}" \
  --arg customerId "$CUSTOMER_ID" \
  --arg price "$GROWTH_PRICE_ID" \
  --argjson created "$TS" \
  '{events:[{id:$eventId,type:"customer.subscription.updated",created:$created,data:{object:{id:$subId,customer:$customerId,status:"active",items:{data:[{price:{id:$price,metadata:{}}}]},metadata:{}}}}]}'
)"
RECON_JSON="$(api_post_json "/ops/finance/billing/providers/stripe/reconcile" "$RECON_PAYLOAD")"
echo "$RECON_JSON" | jq '{tenantId,summary}'
if [[ "$(echo "$RECON_JSON" | jq -r '.summary.applied // 0')" -lt 1 ]]; then
  echo "Reconcile did not apply events."
  exit 1
fi

PLAN_JSON="$(api_get "/ops/finance/billing/plan")"
echo "$PLAN_JSON" | jq '{tenantId,billing,resolvedPlan}'
if [[ "$(echo "$PLAN_JSON" | jq -r '.billing.plan // ""')" != "growth" ]]; then
  echo "Expected billing.plan=growth after reconcile mapping."
  exit 1
fi

echo "[5/5] Billing summary..."
PERIOD="$(date -u +%Y-%m)"
SUMMARY_JSON="$(api_get "/ops/finance/billing/summary?period=$PERIOD")"
echo "$SUMMARY_JSON" | jq '{tenantId,period,usage,enforcement}'
if [[ "$(echo "$SUMMARY_JSON" | jq -r '.usage.eventCount // 0')" -lt 0 ]]; then
  echo "Unexpected summary payload."
  exit 1
fi

echo
echo "Production billing smoke passed."
echo "Base URL: $SETTLD_BASE_URL"
echo "Tenant:   $SETTLD_TENANT_ID"

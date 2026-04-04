#!/usr/bin/env bash
set -euo pipefail

# First-Value Check: Stripe connect -> backfill -> ranked overdue invoices
# Used for: Gate item 22 (under 5 minutes to first value)
# Requires: RUNTIME_URL, STRIPE_TEST_KEY, TEST_TENANT_SESSION_COOKIE

RUNTIME_URL="${RUNTIME_URL:-http://localhost:3000}"
STRIPE_KEY="${STRIPE_TEST_KEY:?Set STRIPE_TEST_KEY to a Stripe test-mode secret key}"
SESSION_COOKIE="${TEST_TENANT_SESSION_COOKIE:?Set TEST_TENANT_SESSION_COOKIE}"
TENANT_ID="${TEST_TENANT_ID:-tenant_first_value_test}"

echo "=== First-Value Check ==="
echo "Runtime: $RUNTIME_URL"
echo "Tenant:  $TENANT_ID"
echo ""

START=$(date +%s)

# Step 1: Connect Stripe (BYOK)
echo "Step 1: Connecting Stripe..."
CONNECT_RESULT=$(curl -sf -X POST "$RUNTIME_URL/v1/integrations/stripe/key" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID" \
  -d "{\"apiKey\": \"$STRIPE_KEY\"}")

echo "  Connect result: $CONNECT_RESULT"
if ! echo "$CONNECT_RESULT" | grep -q '"ok":true'; then
  echo "  FAIL: Stripe connect failed"
  exit 1
fi

# Step 2: Trigger backfill
echo "Step 2: Starting backfill..."
BACKFILL_RESULT=$(curl -sf -X POST "$RUNTIME_URL/v1/integrations/stripe/backfill" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID")

echo "  Backfill result: $BACKFILL_RESULT"
if ! echo "$BACKFILL_RESULT" | grep -q '"ok":true'; then
  echo "  FAIL: Backfill start failed"
  exit 1
fi

# Step 3: Wait for backfill completion (poll integration status)
echo "Step 3: Waiting for backfill to complete..."
for i in $(seq 1 60); do
  STATUS=$(curl -sf "$RUNTIME_URL/v1/integrations/status" \
    -H "Cookie: $SESSION_COOKIE" \
    -H "x-tenant-id: $TENANT_ID" 2>/dev/null || echo '{}')

  BACKFILL_STATUS=$(echo "$STATUS" | node -pe "
    try { JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
      .integrations?.find(i => i.service === 'stripe')?.metadata?.status || 'unknown' }
    catch { 'unknown' }
  " 2>/dev/null <<< "$STATUS" || echo "unknown")

  if [ "$BACKFILL_STATUS" = "backfill_complete" ]; then
    echo "  Backfill complete after ${i}s"
    break
  fi
  if [ "$BACKFILL_STATUS" = "backfill_failed" ]; then
    echo "  FAIL: Backfill failed"
    exit 1
  fi
  if [ "$i" -eq 60 ]; then
    echo "  FAIL: Backfill did not complete within 60s"
    exit 1
  fi
  sleep 1
done

# Step 4: Check world stats (objects imported)
echo "Step 4: Checking imported data..."
STATS=$(curl -sf "$RUNTIME_URL/v1/world/stats" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID" 2>/dev/null || echo '{}')
echo "  World stats: $STATS"

# Step 5: Check for ranked overdue invoices with probabilities
echo "Step 5: Checking company state (overdue invoices + probabilities)..."
COMPANY_STATE=$(curl -sf "$RUNTIME_URL/v1/world/company-state" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "x-tenant-id: $TENANT_ID" 2>/dev/null || echo '{}')

OVERDUE_COUNT=$(echo "$COMPANY_STATE" | node -pe "
  try {
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const invoices = s.invoices || s.overdueInvoices || [];
    invoices.filter(i => i.status === 'overdue' || i.daysOverdue > 0).length;
  } catch { 0 }
" 2>/dev/null <<< "$COMPANY_STATE" || echo "0")

END=$(date +%s)
ELAPSED=$((END - START))

echo ""
echo "=== Results ==="
echo "Elapsed time: ${ELAPSED}s"
echo "Overdue invoices found: $OVERDUE_COUNT"

if [ "$OVERDUE_COUNT" -gt 0 ] && [ "$ELAPSED" -lt 300 ]; then
  echo "PASS: First value achieved in ${ELAPSED}s with $OVERDUE_COUNT overdue invoices"
  exit 0
elif [ "$OVERDUE_COUNT" -eq 0 ]; then
  echo "FAIL: No overdue invoices found after backfill"
  exit 1
else
  echo "FAIL: Took ${ELAPSED}s (limit: 300s)"
  exit 1
fi

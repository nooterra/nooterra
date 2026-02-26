#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/dev/env.sh"

for bin in curl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required tool: $bin"
    exit 1
  fi
done

if ! curl -fsS "$NOOTERRA_BASE_URL/healthz" >/dev/null 2>&1; then
  cat <<EOF
API is not reachable at $NOOTERRA_BASE_URL.
Start it in another shell:
  npm run dev:start
EOF
  exit 1
fi

if [[ -z "${NOOTERRA_API_KEY:-}" ]]; then
  NOOTERRA_API_KEY="$(bash "$ROOT_DIR/scripts/dev/new-sdk-key.sh" --print-only)"
  export NOOTERRA_API_KEY
fi

API_AUTH_HEADER="authorization: Bearer $NOOTERRA_API_KEY"
PERIOD="$(date -u +%Y-%m)"

api_post_json() {
  local path="$1"
  local payload="$2"
  local response
  local body
  local status

  response="$(curl -sS -X POST "$NOOTERRA_BASE_URL$path" \
    -H "$API_AUTH_HEADER" \
    -H "x-proxy-tenant-id: $NOOTERRA_TENANT_ID" \
    -H "content-type: application/json" \
    -d "$payload" \
    -w $'\n%{http_code}')"
  body="$(printf "%s" "$response" | sed '$d')"
  status="$(printf "%s" "$response" | tail -n1)"
  if [[ ! "$status" =~ ^2 ]]; then
    echo "Request failed: POST $path (HTTP $status)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    exit 1
  fi
  printf "%s" "$body"
}

echo "[1/5] Running first verified settlement..."
RUN_JSON="$(cd "$ROOT_DIR" && NOOTERRA_SDK_DISPUTE_WINDOW_DAYS=3 npm run -s sdk:first-run)"
echo "$RUN_JSON" | jq .

RUN_ID="$(echo "$RUN_JSON" | jq -r '.runId')"
PAYER_AGENT_ID="$(echo "$RUN_JSON" | jq -r '.payerAgentId')"
if [[ -z "$RUN_ID" || "$RUN_ID" == "null" ]]; then
  echo "Could not parse runId from sdk:first-run output."
  exit 1
fi
if [[ -z "$PAYER_AGENT_ID" || "$PAYER_AGENT_ID" == "null" ]]; then
  echo "Could not parse payerAgentId from sdk:first-run output."
  exit 1
fi

SUFFIX="$(date +%s%N | cut -c1-16)"
DISPUTE_ID="dispute_doctor_${SUFFIX}"
CASE_ID="arb_case_doctor_${SUFFIX}"

echo "[2/5] Opening dispute..."
DISPUTE_JSON="$(api_post_json "/runs/$RUN_ID/dispute/open" "{\"disputeId\":\"$DISPUTE_ID\",\"reason\":\"billing doctor validation\",\"openedByAgentId\":\"$PAYER_AGENT_ID\"}")"
echo "$DISPUTE_JSON" | jq .

echo "[3/5] Opening arbitration case..."
ARBITRATION_JSON="$(api_post_json "/runs/$RUN_ID/arbitration/open" "{\"caseId\":\"$CASE_ID\",\"disputeId\":\"$DISPUTE_ID\",\"arbiterAgentId\":\"$PAYER_AGENT_ID\"}")"
echo "$ARBITRATION_JSON" | jq .

echo "[4/5] Reading billable events..."
EVENTS_JSON="$(curl -sS "$NOOTERRA_BASE_URL/ops/finance/billable-events?period=$PERIOD" \
  -H "authorization: Bearer $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $NOOTERRA_TENANT_ID")"

SCOPED_EVENTS_JSON="$(echo "$EVENTS_JSON" | jq --arg runId "$RUN_ID" --arg caseId "$CASE_ID" '
  [.events[] | select((.runId == $runId) or (.arbitrationCaseId == $caseId))]
')"
echo "$SCOPED_EVENTS_JSON" | jq --arg tenantId "$NOOTERRA_TENANT_ID" --arg runId "$RUN_ID" --arg caseId "$CASE_ID" --arg period "$PERIOD" '
{
  tenantId: $tenantId,
  period: $period,
  runId: $runId,
  arbitrationCaseId: $caseId,
  count: length,
  eventTypeCounts: (reduce .[] as $event ({verified_run: 0, settled_volume: 0, arbitration_usage: 0};
    if ($event.eventType == "verified_run") then .verified_run += 1
    elif ($event.eventType == "settled_volume") then .settled_volume += 1
    elif ($event.eventType == "arbitration_usage") then .arbitration_usage += 1
    else .
    end)),
  events: .
}'

RUN_VERIFIED_EVENTS="$(echo "$SCOPED_EVENTS_JSON" | jq --arg runId "$RUN_ID" '[.[] | select(.eventType=="verified_run" and .runId==$runId)] | length')"
RUN_SETTLED_EVENTS="$(echo "$SCOPED_EVENTS_JSON" | jq --arg runId "$RUN_ID" '[.[] | select(.eventType=="settled_volume" and .runId==$runId)] | length')"
ARBITRATION_EVENTS_FOR_CASE="$(echo "$SCOPED_EVENTS_JSON" | jq --arg caseId "$CASE_ID" '[.[] | select(.eventType=="arbitration_usage" and .arbitrationCaseId==$caseId)] | length')"

if [[ "$RUN_VERIFIED_EVENTS" -lt 1 ]]; then
  echo "Expected at least one verified_run event for run $RUN_ID, found $RUN_VERIFIED_EVENTS."
  exit 1
fi
if [[ "$RUN_SETTLED_EVENTS" -lt 1 ]]; then
  echo "Expected at least one settled_volume event for run $RUN_ID, found $RUN_SETTLED_EVENTS."
  exit 1
fi
if [[ "$ARBITRATION_EVENTS_FOR_CASE" -lt 1 ]]; then
  echo "Expected at least one arbitration_usage event for case $CASE_ID, found $ARBITRATION_EVENTS_FOR_CASE."
  exit 1
fi

echo "[5/5] Reading billing summary..."
SUMMARY_JSON="$(curl -sS "$NOOTERRA_BASE_URL/ops/finance/billing/summary?period=$PERIOD" \
  -H "authorization: Bearer $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $NOOTERRA_TENANT_ID")"
echo "$SUMMARY_JSON" | jq '{
  tenantId,
  period,
  plan: { planId: .plan.planId },
  usage: .usage,
  enforcement: .enforcement
}'

ARBITRATION_CASES="$(echo "$SUMMARY_JSON" | jq -r '.usage.arbitrationCases // 0')"
if [[ "$ARBITRATION_CASES" -lt 1 ]]; then
  echo "Expected arbitrationCases >= 1 in billing summary, got $ARBITRATION_CASES."
  exit 1
fi

echo
echo "Billing doctor passed."
echo "Run: $RUN_ID"
echo "Dispute: $DISPUTE_ID"
echo "Arbitration case: $CASE_ID"

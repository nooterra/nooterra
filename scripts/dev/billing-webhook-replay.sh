#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "$ROOT_DIR/scripts/dev/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$ROOT_DIR/scripts/dev/env.sh"
fi

for bin in curl jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required tool: $bin" >&2
    exit 1
  fi
done

: "${NOOTERRA_BASE_URL:?NOOTERRA_BASE_URL is required}"
: "${PROXY_OPS_TOKEN:?PROXY_OPS_TOKEN is required}"
: "${NOOTERRA_TENANT_ID:?NOOTERRA_TENANT_ID is required}"

LIMIT="${LIMIT:-200}"
OFFSET="${OFFSET:-0}"
REASON="${REASON:-}"
EVENT_TYPE="${EVENT_TYPE:-}"
AUDIT_IDS="${AUDIT_IDS:-}"
DRY_RUN="${DRY_RUN:-1}"

if [[ "$DRY_RUN" == "1" || "${DRY_RUN,,}" == "true" ]]; then
  DRY_RUN_JSON="true"
else
  DRY_RUN_JSON="false"
fi

urlencode() {
  local input="${1:-}"
  jq -rn --arg v "$input" '$v|@uri'
}

api_get() {
  local path="$1"
  local response body status
  response="$(curl -sS "$NOOTERRA_BASE_URL$path" \
    -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
    -H "x-proxy-tenant-id: $NOOTERRA_TENANT_ID" \
    -w $'\n%{http_code}')"
  body="$(printf "%s" "$response" | sed '$d')"
  status="$(printf "%s" "$response" | tail -n1)"
  if [[ ! "$status" =~ ^2 ]]; then
    echo "GET $path failed (HTTP $status)" >&2
    echo "$body" | jq . 2>/dev/null >&2 || echo "$body" >&2
    exit 1
  fi
  printf "%s" "$body"
}

api_post_json() {
  local path="$1"
  local payload="$2"
  local response body status
  response="$(curl -sS -X POST "$NOOTERRA_BASE_URL$path" \
    -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
    -H "x-proxy-tenant-id: $NOOTERRA_TENANT_ID" \
    -H "content-type: application/json" \
    -d "$payload" \
    -w $'\n%{http_code}')"
  body="$(printf "%s" "$response" | sed '$d')"
  status="$(printf "%s" "$response" | tail -n1)"
  if [[ ! "$status" =~ ^2 ]]; then
    echo "POST $path failed (HTTP $status)" >&2
    echo "$body" | jq . 2>/dev/null >&2 || echo "$body" >&2
    exit 1
  fi
  printf "%s" "$body"
}

echo "[1/4] Stripe reconcile report snapshot"
REPORT_JSON="$(api_get "/ops/finance/billing/providers/stripe/reconcile/report?limit=${LIMIT}&offset=${OFFSET}")"
echo "$REPORT_JSON" | jq '{
  tenantId,
  provider,
  counts,
  ingestBreakdown,
  rejectedReasonCounts,
  replayableRejectedCount
}'

echo "[2/4] Dead-letter candidate snapshot"
DEAD_LETTER_PATH="/ops/finance/billing/providers/stripe/dead-letter?limit=${LIMIT}&offset=${OFFSET}"
if [[ -n "$REASON" ]]; then
  DEAD_LETTER_PATH="${DEAD_LETTER_PATH}&reason=$(urlencode "$REASON")"
fi
if [[ -n "$EVENT_TYPE" ]]; then
  DEAD_LETTER_PATH="${DEAD_LETTER_PATH}&eventType=$(urlencode "$EVENT_TYPE")"
fi

DEAD_JSON="$(api_get "$DEAD_LETTER_PATH")"
echo "$DEAD_JSON" | jq '{
  tenantId,
  provider,
  count,
  limit,
  offset,
  sample: (.events[:5] | map({auditId, eventId, eventType, reason, source, replayable}))
}'

if [[ "$(echo "$DEAD_JSON" | jq -r '.count // 0')" == "0" ]]; then
  echo "No replayable dead-letter events found."
  exit 0
fi

echo "[3/4] Replay request"
AUDIT_IDS_JSON="[]"
if [[ -n "$AUDIT_IDS" ]]; then
  AUDIT_IDS_JSON="$(printf "%s" "$AUDIT_IDS" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | jq -Rn '[inputs | select(length>0) | tonumber]')"
fi

REPLAY_PAYLOAD="$(
  jq -n \
    --argjson dryRun "$DRY_RUN_JSON" \
    --arg reason "$REASON" \
    --arg eventType "$EVENT_TYPE" \
    --argjson limit "$LIMIT" \
    --argjson offset "$OFFSET" \
    --argjson auditIds "$AUDIT_IDS_JSON" \
    '{
      dryRun: $dryRun,
      limit: $limit,
      offset: $offset
    }
    + (if ($reason|length)>0 then {reason:$reason} else {} end)
    + (if ($eventType|length)>0 then {eventType:$eventType} else {} end)
    + (if ($auditIds|length)>0 then {auditIds:$auditIds} else {} end)'
)"

REPLAY_JSON="$(api_post_json "/ops/finance/billing/providers/stripe/dead-letter/replay" "$REPLAY_PAYLOAD")"
echo "$REPLAY_JSON" | jq '{
  tenantId,
  provider,
  dryRun,
  summary,
  sample: (.results[:10])
}'

echo "[4/4] Post-replay report snapshot"
POST_REPORT_JSON="$(api_get "/ops/finance/billing/providers/stripe/reconcile/report?limit=${LIMIT}&offset=${OFFSET}")"
echo "$POST_REPORT_JSON" | jq '{
  tenantId,
  provider,
  counts,
  ingestBreakdown,
  rejectedReasonCounts,
  replayableRejectedCount
}'

FAILED_COUNT="$(echo "$REPLAY_JSON" | jq -r '.summary.failed // 0')"
if [[ "$DRY_RUN_JSON" == "false" && "$FAILED_COUNT" != "0" ]]; then
  echo "Replay completed with failed events: $FAILED_COUNT" >&2
  exit 2
fi

echo "Billing webhook replay guardrail flow completed."

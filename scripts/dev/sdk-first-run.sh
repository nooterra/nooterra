#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/dev/env.sh"

if [[ -z "${SETTLD_API_KEY:-}" ]]; then
  SETTLD_API_KEY="$(bash "$ROOT_DIR/scripts/dev/new-sdk-key.sh" --print-only)"
  export SETTLD_API_KEY
fi

cd "$ROOT_DIR"
npm run -s sdk:first-run

echo
echo "Billable events snapshot:"
curl -sS "$SETTLD_BASE_URL/ops/finance/billable-events?period=$(date -u +%Y-%m)" \
  -H "authorization: Bearer $PROXY_OPS_TOKEN" \
  -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" | jq .


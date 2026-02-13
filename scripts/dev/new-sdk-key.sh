#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/dev/env.sh"

PRINT_ONLY=0
OPS_TOKEN_OVERRIDE=""
if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  bash scripts/dev/new-sdk-key.sh
  bash scripts/dev/new-sdk-key.sh --print-only
  bash scripts/dev/new-sdk-key.sh --ops-token <tok> [--print-only]

Behavior:
  - mints a new API key via /ops/api-keys
  - writes SETTLD_API_KEY into .env.dev.runtime
  - prints export command for current shell
EOF
  exit 0
fi

# Parse flags (source'd env files may override shell exports; we support explicit override).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --print-only)
      PRINT_ONLY=1
      shift
      ;;
    --ops-token)
      OPS_TOKEN_OVERRIDE="${2:-}"
      if [[ -z "${OPS_TOKEN_OVERRIDE:-}" ]]; then
        echo "--ops-token requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "${OPS_TOKEN_OVERRIDE:-}" ]]; then
  export PROXY_OPS_TOKEN="$OPS_TOKEN_OVERRIDE"
fi

# Prefer x-proxy-ops-token for hosted deployments that may not forward Authorization.
RESPONSE="$(
  curl -sS -X POST "$SETTLD_BASE_URL/ops/api-keys" \
    -H "x-proxy-ops-token: $PROXY_OPS_TOKEN" \
    -H "authorization: Bearer $PROXY_OPS_TOKEN" \
    -H "x-proxy-tenant-id: $SETTLD_TENANT_ID" \
    -H "content-type: application/json" \
    -d '{"scopes":["ops_read","ops_write","finance_read","finance_write","audit_read"],"description":"sdk quickstart"}'
)"

KEY_ID="$(echo "$RESPONSE" | jq -r '.keyId // empty')"
SECRET="$(echo "$RESPONSE" | jq -r '.secret // empty')"

if [[ -z "$KEY_ID" || -z "$SECRET" ]]; then
  echo "Failed to mint SDK key."
  echo "$RESPONSE" | jq .
  exit 1
fi

SETTLD_API_KEY_VALUE="${KEY_ID}.${SECRET}"

if [[ "$PRINT_ONLY" == "1" ]]; then
  echo "$SETTLD_API_KEY_VALUE"
  exit 0
fi

printf "SETTLD_API_KEY=%s\n" "$SETTLD_API_KEY_VALUE" >"$SETTLD_RUNTIME_ENV_FILE"
chmod 600 "$SETTLD_RUNTIME_ENV_FILE" || true

echo "Wrote $SETTLD_RUNTIME_ENV_FILE"
echo "export SETTLD_API_KEY='$SETTLD_API_KEY_VALUE'"

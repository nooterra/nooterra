#!/usr/bin/env bash
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "source scripts/dev/env.sh"
  echo "This file must be sourced so exports are applied to your shell."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${SETTLD_ENV_FILE:-$ROOT_DIR/.env.dev}"
RUNTIME_ENV_FILE="${SETTLD_RUNTIME_ENV_FILE:-$ROOT_DIR/.env.dev.runtime}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

if [[ -f "$RUNTIME_ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$RUNTIME_ENV_FILE"
  set +a
fi

: "${SETTLD_BASE_URL:=http://127.0.0.1:3000}"
: "${SETTLD_TENANT_ID:=tenant_default}"
: "${PROXY_OPS_TOKEN:=dev_ops_token}"

export SETTLD_BASE_URL
export SETTLD_TENANT_ID
export PROXY_OPS_TOKEN
export SETTLD_ENV_FILE="$ENV_FILE"
export SETTLD_RUNTIME_ENV_FILE="$RUNTIME_ENV_FILE"


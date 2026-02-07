#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/dev/env.sh"

if [[ -z "${DATABASE_URL:-}" ]]; then
  cat <<'EOF'
DATABASE_URL is not set.

Set it in .env.dev:
  DATABASE_URL=postgresql://...
EOF
  exit 1
fi

: "${STORE:=pg}"
: "${PROXY_PG_SCHEMA:=public}"
: "${PROXY_MIGRATE_ON_STARTUP:=1}"

cd "$ROOT_DIR"
exec npm run dev:api


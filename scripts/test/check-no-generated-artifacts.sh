#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

bad="$(git ls-files -z -- '*.pyc' '**/__pycache__/**' '.venv/**' | tr '\0' '\n' | sed '/^$/d' || true)"
if [[ -n "$bad" ]]; then
  echo "generated artifacts are tracked in git (must be removed):" >&2
  echo "$bad" >&2
  exit 1
fi


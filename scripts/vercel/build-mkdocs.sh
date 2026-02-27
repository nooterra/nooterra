#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

if ! python3 -m mkdocs --version >/dev/null 2>&1; then
  echo "MkDocs not found; running install step first..."
  bash "${REPO_ROOT}/scripts/vercel/install-mkdocs.sh"
fi

python3 -m mkdocs build --strict --config-file mkdocs.yml

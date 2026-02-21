#!/usr/bin/env bash
set -euo pipefail

if [ ! -x ".vercel-venv/bin/mkdocs" ]; then
  echo "MkDocs venv not found; running install step first..."
  bash scripts/vercel/install-mkdocs.sh
fi

.vercel-venv/bin/mkdocs build --strict --config-file mkdocs.yml
